"""Export-time patches that make DETRPose's decoder traceable *with eager semantics*.

Why this exists
---------------
`DeformableTransformerDecoderLayer.with_pos_embed` adds the query position embedding
**in place** (`tensor[:, :, -np:] += pos`) and the code relies on that mutation being
visible through other names that alias the same storage:

  1. inside the layer, the mutated `tgt_pose` is reused as the self-attention *value*,
     as the residual, and (for the second call, on a transposed view of
     `across_norm`'s output) as the gateway input;
  2. in `TransformerDecoder.forward`, `output_pose_detach` is a *view* of the previous
     layer's output, so layer L+1's in-place add also changes it before it is used in
     the FDR refinement `pose_head[L+1](output_pose + output_pose_detach)`.

PyTorch eager (and therefore training and the published COCO AP) sees all of these
mutations. The TorchScript ONNX exporter turns the in-place slice add into ScatterND
and does not propagate it to aliases created earlier, so the stock export silently
computes a slightly different network (we measured ~1-2 px keypoint drift and up to
0.01 score drift vs. PyTorch on the repo's example images).

The patched forwards below are copies of upstream (commit d56a050) with the in-place
ops replaced by out-of-place ones that reproduce the eager values exactly. They
change nothing numerically in PyTorch (verified: max |diff| ~1e-6), but make the ONNX
graph match PyTorch to ~1e-4.

Usage: `import onnx_patches; onnx_patches.apply()` before building/exporting the model.
"""
import torch
import torch.nn.functional as F


def _add_pos(t, pos):
    """Out-of-place equivalent of `t[:, :, -n:] += pos` (returns the mutated value)."""
    if pos is None:
        return t
    n = pos.shape[2]
    return torch.cat([t[:, :, :-n], t[:, :, -n:] + pos], dim=2)


def layer_forward(self, tgt_pose, tgt_pose_query_pos, tgt_pose_reference_points,
                  attn_mask=None, memory=None, memory_spatial_shapes=None):
    bs, nq, num_kpt, d_model = tgt_pose.shape

    # within-instance self-attention (eager: with_pos_embed mutated tgt_pose itself)
    tgt_pose = _add_pos(tgt_pose, tgt_pose_query_pos)
    q = k = tgt_pose.flatten(0, 1)
    tgt2 = self.within_attn(q, k, tgt_pose.flatten(0, 1))[0].reshape(bs, nq, num_kpt, d_model)
    tgt_pose = tgt_pose + self.within_dropout(tgt2)
    tgt_pose = self.within_norm(tgt_pose)

    # across-instance self-attention
    tgt_pose = tgt_pose.transpose(1, 2).flatten(0, 1)
    q_pose = k_pose = tgt_pose
    tgt2_pose = self.across_attn(q_pose, k_pose, tgt_pose, attn_mask=attn_mask)[0].reshape(bs * num_kpt, nq, d_model)
    tgt_pose = tgt_pose + self.across_dropout(tgt2_pose)
    tgt_pose = self.across_norm(tgt_pose).reshape(bs, num_kpt, nq, d_model).transpose(1, 2)

    # deformable cross-attention (eager: with_pos_embed mutated tgt_pose, which the gate then reads)
    tgt_pose = _add_pos(tgt_pose, tgt_pose_query_pos)
    tgt2_pose = self.cross_attn(tgt_pose.flatten(1, 2), tgt_pose_reference_points, memory,
                                memory_spatial_shapes).reshape(bs, nq, num_kpt, d_model)
    tgt_pose = self.gateway(tgt_pose, self.dropout1(tgt2_pose))
    return self.forward_FFN(tgt_pose)


def decoder_forward(self, tgt, memory, refpoints_sigmoid, pre_pose_head, pose_head, class_head, lqe_head,
                    feat_lqe, integral, up, reg_scale, reg_max, project, attn_mask=None, spatial_shapes=None):
    from src.models.detrpose.transformer import distance2pose
    from src.models.detrpose.utils import inverse_sigmoid

    output = tgt
    refpoint_pose = refpoints_sigmoid
    output_pose_detach = pred_corners_undetach = 0

    dec_out_poses, dec_out_logits, dec_out_refs, dec_out_pred_corners = [], [], [], []

    for layer_id, layer in enumerate(self.layers):
        refpoint_pose_input = refpoint_pose[:, :, None]
        refpoint_only_pose = refpoint_pose[:, :, 1:]
        pose_query_sine_embed = self.sine_embedding(refpoint_only_pose)
        pose_query_pos = self.half_pose_ref_point_head(pose_query_sine_embed)

        # eager: `layer` adds pose_query_pos in place to output[:, :, -17:]; output_pose_detach is
        # the view output[:, :, 1:] of the previous layer, so it sees the same add.
        if layer_id > 0:
            assert output.shape[2] - 1 == pose_query_pos.shape[2]
            output_pose_detach = output_pose_detach + pose_query_pos

        output = layer(
            tgt_pose=output,
            tgt_pose_query_pos=pose_query_pos,
            tgt_pose_reference_points=refpoint_pose_input,
            attn_mask=attn_mask,
            memory=memory,
            memory_spatial_shapes=spatial_shapes,
        )

        output_pose = output[:, :, 1:]
        output_instance = output[:, :, 0]

        if layer_id == 0:
            pre_poses = F.sigmoid(pre_pose_head(output_pose) + inverse_sigmoid(refpoint_only_pose))
            pre_scores = class_head[0](output_instance)
            ref_pose_initial = pre_poses.detach()

        pred_corners = pose_head[layer_id](output_pose + output_pose_detach) + pred_corners_undetach
        refpoint_pose_without_center = distance2pose(ref_pose_initial, integral(pred_corners, project), reg_scale)

        refpoint_center_pose = torch.mean(refpoint_pose_without_center, dim=2, keepdim=True)
        refpoint_pose = torch.cat([refpoint_center_pose, refpoint_pose_without_center], dim=2)

        if self.training or layer_id == self.eval_idx:
            score = class_head[layer_id](output_instance)
            logit = lqe_head[layer_id](score, refpoint_pose_without_center, feat_lqe)
            dec_out_logits.append(logit)
            dec_out_poses.append(refpoint_pose_without_center)
            dec_out_pred_corners.append(pred_corners)
            dec_out_refs.append(ref_pose_initial)
            if not self.training:
                break

        pred_corners_undetach = pred_corners
        output_pose_detach = output_pose  # (eval) a view of `output`; see the alias fix above

    return (torch.stack(dec_out_poses), torch.stack(dec_out_logits), torch.stack(dec_out_pred_corners),
            torch.stack(dec_out_refs), pre_poses, pre_scores)


def apply():
    """Monkeypatch the upstream classes (eval/export only; do not use for training)."""
    from src.models.detrpose import transformer as T
    T.DeformableTransformerDecoderLayer.forward = layer_forward
    T.TransformerDecoder.forward = decoder_forward
