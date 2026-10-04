"""Post-process a DETRPose fp32 ONNX export into browser-ready variants.

    python make_web_models.py detrpose_n_fp32.onnx --out-dir out/ --prefix detrpose_n

Writes (all keep fp32 `images` / int64 `orig_target_sizes` inputs and fp32/int64 outputs):
  <prefix>_fp32.web.onnx   value_info stripped (see below), otherwise the export as-is
  <prefix>_fp16w.web.onnx  fp16 *weights*, fp32 compute: every float initializer is stored as fp16
                           and immediately Cast to fp32. ORT constant-folds the casts at session
                           creation, so runtime == fp32 on every EP; download size is halved.
  <prefix>_fp16.web.onnx   convert_float_to_float16(keep_io_types=True) (onnxruntime.transformers copy):
                           fp16 activations where the EP has fp16 kernels (WebGPU), ORT inserts
                           casts elsewhere (WASM/CPU).
  <prefix>_int8w.web.onnx  int8 *weights* (per-row scale) + fp16 small tensors, fp32 compute; ORT
                           constant-folds the Cast*scale at load. ~4x smaller than fp32.
  <prefix>_int8.web.onnx   onnxruntime.quantization.quantize_dynamic (MatMul/Gemm, int8 activations).
                           Not recommended: large accuracy loss on this model (see README).

Web fixes applied to every variant: MaxPool ceil_mode (see fix_maxpool_ceil_mode) and value_info.

Why strip value_info: the TorchScript export + onnxsim leave one Gemm output annotated with a
rank-0 shape although it is [400,128]. Python onnxruntime only warns ("Falling back to lenient
merge") but onnxruntime-web refuses to create the session:
  [ShapeInferenceError] Mismatch between number of inferred and declared dimensions.
ORT re-infers every shape itself, so the annotations are pure metadata.
"""
import argparse
import os

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper, shape_inference


def fix_maxpool_ceil_mode(m):
    """onnxruntime-web's WebGPU MaxPool throws at *run* time for ceil_mode=1 ("ceil_mode kernel
    execution (padding) is not yet implemented"), and because session creation succeeds the app's
    ['webgpu', 'wasm'] provider list never falls back to wasm. HGNetv2's stem uses
    MaxPool2d(k=2, s=1, ceil_mode=True); with stride 1 ceil and floor give the same output size,
    so ceil_mode=0 is exactly equivalent. Only rewrite when that is provably true."""
    for n in m.graph.node:
        if n.op_type != 'MaxPool':
            continue
        at = {a.name: a for a in n.attribute}
        if 'ceil_mode' not in at or at['ceil_mode'].i == 0:
            continue
        strides = list(at['strides'].ints) if 'strides' in at else []
        if strides and any(st != 1 for st in strides):
            raise SystemExit(f'{n.name}: ceil_mode=1 with stride {strides} is not a no-op; handle explicitly')
        at['ceil_mode'].i = 0
        print(f'  {n.name}: ceil_mode 1 -> 0 (stride 1, equivalent)')
    return m


def strip_value_info(m):
    del m.graph.value_info[:]
    # make sure the graph is still consistent under strict shape inference, then drop the result
    inferred = shape_inference.infer_shapes(m, strict_mode=True, data_prop=True)
    rank0 = [vi.name for vi in inferred.graph.value_info if len(vi.type.tensor_type.shape.dim) == 0]
    assert not rank0, f'unexpected rank-0 tensors after inference: {rank0[:5]}'
    onnx.checker.check_model(m, full_check=True)
    return m


def fp16_weights(m, min_elems=16):
    """Store float32 initializers as fp16 + Cast(to=float). Small tensors (shapes, scalars) stay fp32."""
    g = m.graph
    new_inits, casts = [], []
    for init in list(g.initializer):
        if init.data_type != TensorProto.FLOAT:
            new_inits.append(init)
            continue
        arr = numpy_helper.to_array(init)
        if arr.size < min_elems:
            new_inits.append(init)
            continue
        if np.abs(arr).max() > 65504:
            print(f'  keep fp32 (out of fp16 range): {init.name}')
            new_inits.append(init)
            continue
        h = numpy_helper.from_array(arr.astype(np.float16), init.name + '__fp16')
        new_inits.append(h)
        casts.append(helper.make_node('Cast', [h.name], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
    del g.initializer[:]
    g.initializer.extend(new_inits)
    nodes = casts + list(g.node)
    del g.node[:]
    g.node.extend(nodes)
    onnx.checker.check_model(m)
    return m


def fp16_full(m):
    # onnxruntime's copy of the onnxconverter-common converter: the onnxconverter-common 1.16 one
    # leaves fp32/fp16 type clashes in this graph (Div in the postprocessor, Mul in cross_attn).
    from onnxruntime.transformers.float16 import convert_float_to_float16
    # The postprocessor does index math in float (topk_index.float() // C) - keep it fp32.
    block = [n.name for n in m.graph.node if n.name.startswith('/postprocessor/')]
    return convert_float_to_float16(m, keep_io_types=True, node_block_list=block,
                                    op_block_list=['TopK', 'Range', 'Resize'], force_fp16_initializers=False)


def _out_axis(name, consumers):
    """Output-channel axis of a weight, from how it is consumed (per-output-channel scales)."""
    for n in consumers.get(name, []):
        if n.op_type == 'Conv' and n.input[1] == name:
            return 0
        if n.op_type == 'Gemm' and n.input[1] == name:
            tb = next((a.i for a in n.attribute if a.name == 'transB'), 0)
            return 0 if tb else 1
        if n.op_type == 'MatMul' and n.input[1] == name:
            return -1
    return 0


def int8_weights(m, min_elems=1024, keep_fp16=()):
    """Weight-only int8: every float initializer with >= min_elems elements and rank >= 2 is stored as
    int8 with a per-output-channel fp32 scale and rebuilt as Cast(int8->float) * scale. Both nodes have
    only constant inputs, so ORT constant-folds them at session creation: compute stays fp32, only
    the download shrinks ~4x. Remaining float initializers (biases, norms) - and any initializer
    consumed by a node whose name starts with one of `keep_fp16` - are stored as fp16."""
    import collections
    g = m.graph
    consumers = collections.defaultdict(list)
    for n in g.node:
        for i in n.input:
            consumers[i].append(n)
    new_inits, nodes = [], []
    for init in list(g.initializer):
        if init.data_type != TensorProto.FLOAT:
            new_inits.append(init)
            continue
        arr = numpy_helper.to_array(init)
        sensitive = any(n.name.startswith(keep_fp16) for n in consumers.get(init.name, [])) if keep_fp16 else False
        if arr.ndim >= 2 and arr.size >= min_elems and not sensitive:
            ax = _out_axis(init.name, consumers) % arr.ndim
            moved = np.moveaxis(arr, ax, 0)
            rows = moved.reshape(moved.shape[0], -1)
            scale = np.abs(rows).max(1) / 127.0
            scale[scale == 0] = 1.0
            q = np.clip(np.round(rows / scale[:, None]), -127, 127).astype(np.int8).reshape(moved.shape)
            q = np.ascontiguousarray(np.moveaxis(q, 0, ax))
            shape = [1] * arr.ndim
            shape[ax] = arr.shape[ax]
            sc = scale.astype(np.float32).reshape(shape)
            qi = numpy_helper.from_array(q, init.name + '__i8')
            si = numpy_helper.from_array(sc, init.name + '__scale')
            new_inits += [qi, si]
            nodes.append(helper.make_node('Cast', [qi.name], [init.name + '__f'], to=TensorProto.FLOAT, name=init.name + '__cast'))
            nodes.append(helper.make_node('Mul', [init.name + '__f', si.name], [init.name], name=init.name + '__dq'))
        elif arr.size >= 16 and np.abs(arr).max() <= 65504:
            h = numpy_helper.from_array(arr.astype(np.float16), init.name + '__fp16')
            new_inits.append(h)
            nodes.append(helper.make_node('Cast', [h.name], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
        else:
            new_inits.append(init)
    del g.initializer[:]
    g.initializer.extend(new_inits)
    allnodes = nodes + list(g.node)
    del g.node[:]
    g.node.extend(allnodes)
    onnx.checker.check_model(m)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--prefix', required=True)
    ap.add_argument('--only', nargs='*', default=['fp32', 'fp16w', 'int8w', 'fp16', 'int8'])
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    out = lambda tag: os.path.join(a.out_dir, f'{a.prefix}_{tag}.web.onnx')

    base = strip_value_info(fix_maxpool_ceil_mode(onnx.load(a.model)))
    if 'fp32' in a.only:
        onnx.save(base, out('fp32'))
    if 'fp16w' in a.only:
        m = fp16_weights(onnx.load_from_string(base.SerializeToString()))
        onnx.save(m, out('fp16w'))
    if 'int8w' in a.only:
        m = int8_weights(onnx.load_from_string(base.SerializeToString()))
        onnx.save(m, out('int8w'))
    if 'fp16' in a.only:
        m = fp16_full(onnx.load_from_string(base.SerializeToString()))
        del m.graph.value_info[:]
        onnx.save(m, out('fp16'))
    if 'int8' in a.only:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        tmp = out('fp32') if os.path.exists(out('fp32')) else out('tmp')
        if not os.path.exists(tmp):
            onnx.save(base, tmp)
        # Conv is left in fp32: ConvInteger is slow/unsupported on several EPs and hurts accuracy most.
        quantize_dynamic(tmp, out('int8'), weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul', 'Gemm'])
        q = onnx.load(out('int8'))
        del q.graph.value_info[:]  # quantize_dynamic re-adds shape annotations; see strip_value_info
        onnx.save(q, out('int8'))
        if tmp.endswith('_tmp.web.onnx'):
            os.remove(tmp)
    for tag in a.only:
        if os.path.exists(out(tag)):
            print(f'{out(tag)}: {os.path.getsize(out(tag)) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
