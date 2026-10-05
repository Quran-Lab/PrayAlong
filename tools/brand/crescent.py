"""The PrayAlong mark: a crescent with rounded tips, as one SVG path of four arcs.

The moon is the rug's (src/components/stage/rug-texture.ts `crescent`): a circle less a circle
0.86 its size, moved right by 0.42 and up by 0.22 of the radius. Each tip is rounded by a small
circle that touches both edges, as round as the ends of the Quran Lab bars.

    python3 tools/brand/crescent.py      # prints CRESCENT and CRESCENT_BOX for src/lib/brand.ts
"""
import math

BOX = 48
R, K, OX, OY, TIP = 22, 0.86, 0.42, -0.22, 2.2
# Optical centre: the thick side carries the weight, so the crescent sits a little left of its
# bounding box's centre.
CX, CY = 27, 23.4


def sub(a, b): return (a[0] - b[0], a[1] - b[1])
def add(a, b): return (a[0] + b[0], a[1] + b[1])
def mul(a, s): return (a[0] * s, a[1] * s)
def unit(a): n = math.hypot(*a); return (a[0] / n, a[1] / n)
def angle(c, p): return math.atan2(p[1] - c[1], p[0] - c[0])


def arc(c, p0, p1, through):
    """SVG arc flags and sampled points for the arc of circle `c` from p0 to p1 passing `through`."""
    two_pi = 2 * math.pi
    a0, a1, am = angle(c, p0), angle(c, p1), angle(c, through)
    d, m = (a1 - a0) % two_pi, (am - a0) % two_pi
    sweep, span = (1, d) if m < d else (0, two_pi - d)
    r = math.dist(c, p0)
    step = span / 64 * (1 if sweep else -1)
    pts = [(c[0] + r * math.cos(a0 + step * i), c[1] + r * math.sin(a0 + step * i)) for i in range(65)]
    return int(span > math.pi), sweep, pts


def meet(c0, r0, c1, r1):
    """The two points at distance r0 from c0 and r1 from c1."""
    d = math.dist(c0, c1)
    a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
    h = math.sqrt(r0 * r0 - a * a)
    u = unit(sub(c1, c0))
    p, n = add(c0, mul(u, a)), (-u[1], u[0])
    return add(p, mul(n, h)), add(p, mul(n, -h))


def crescent(cx=CX, cy=CY):
    o, i, ri = (cx, cy), (cx + OX * R, cy + OY * R), K * R
    t1, t2 = meet(o, R - TIP, i, ri + TIP)  # tip circles: inside the moon, outside the bite
    on_outer = lambda t: add(o, mul(unit(sub(t, o)), R))
    on_inner = lambda t: add(i, mul(unit(sub(t, i)), ri))
    far = add(o, mul(unit(sub(o, i)), R))  # the back of the moon
    near = add(i, mul(unit(sub(o, i)), ri))  # the deepest point of the bite
    body = mul(add(far, near), 0.5)
    tip = lambda t: add(t, mul(unit(sub(t, body)), TIP))
    p1o, p1i, p2o, p2i = on_outer(t1), on_inner(t1), on_outer(t2), on_inner(t2)
    segments = [
        (R, o, p1o, p2o, far),
        (TIP, t2, p2o, p2i, tip(t2)),
        (ri, i, p2i, p1i, near),
        (TIP, t1, p1i, p1o, tip(t1)),
    ]
    f = lambda p: f'{p[0]:.2f} {p[1]:.2f}'
    g = lambda v: f'{v:.2f}'.rstrip('0').rstrip('.')
    path, pts = f'M{f(p1o)}', []
    for r, c, a, b, via in segments:
        large, sweep, sampled = arc(c, a, b, via)
        path += f'A{g(r)} {g(r)} 0 {large} {sweep} {f(b)}'
        pts += sampled
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    box = (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
    return path + 'Z', box


if __name__ == '__main__':
    path, (x, y, w, h) = crescent()
    print(f"CRESCENT = '{path}'")
    print(f'CRESCENT_BOX = {{ x: {x:.2f}, y: {y:.2f}, w: {w:.2f}, h: {h:.2f} }}')
