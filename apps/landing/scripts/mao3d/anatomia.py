"""
Anatomia da mao direita do prototipo da abertura em 3D (so numpy, sem bpy).

Unidade: o comprimento da palma (pulso ate a base do dedo medio, landmarks 0 e 9 do MediaPipe)
vale 1. Eixos do Blender: X para o lado do polegar, Y para as costas da mao (unhas), Z do pulso
para os dedos. A palma olha para -Y (no glTF, com Y para cima, isso vira +Z: a palma olha para
quem ve a cena, como nas poses do maos.json).

As medidas vem da media das poses do maos.json (B, mao aberta, para os comprimentos) e de
proporcoes de mao adulta (larguras). A forma e uma funcao de distancia (SDF): dedos como tubos
de raio variavel, palma como uma placa arredondada com almofadas, polegar com a eminencia tenar.
Os vincos (dobras da pele) sao deslocamentos pequenos aplicados depois, so na malha detalhada,
e chegam a malha leve como mapa de normais.
"""
import numpy as np

# --------------------------------------------------------------------------- #
# Esqueleto em repouso
# --------------------------------------------------------------------------- #
FINGERS = ('index', 'middle', 'ring', 'pinky')

# Base de cada dedo (MCP, landmarks 5, 9, 13, 17) e inclinacao no plano da palma (radianos,
# positivo para o lado do polegar): os dedos abrem um pouco em leque, como na mao relaxada.
MCP = {
    'index': (0.262, -0.012, 1.012),
    'middle': (0.0, 0.0, 1.0),
    'ring': (-0.222, -0.012, 0.935),
    'pinky': (-0.418, -0.04, 0.80),
}
FAN = {'index': 0.07, 'middle': 0.0, 'ring': -0.07, 'pinky': -0.16}
# Falanges proximal, media e distal (MCP->PIP, PIP->DIP, DIP->ponta). Proporcoes anatomicas: o
# dedo medio inteiro mede 0,88 da palma; indicador e anelar um pouco menos; minimo 0,75 do medio.
# (Os landmarks do MediaPipe dao dedos mais longos, ~1,0 da palma, porque a ponta e o pulso
# ficam alem da pele; na mao 3D vale a proporcao natural.)
LENGTHS = {
    'index': (0.355, 0.235, 0.21),
    'middle': (0.39, 0.265, 0.225),
    'ring': (0.37, 0.25, 0.215),
    'pinky': (0.29, 0.185, 0.185),
}
# Meia largura do dedo na base, na PIP, na DIP e na ponta
RADII = {
    'index': (0.097, 0.087, 0.077, 0.067),
    'middle': (0.100, 0.090, 0.079, 0.069),
    'ring': (0.093, 0.083, 0.073, 0.064),
    'pinky': (0.082, 0.072, 0.064, 0.057),
}

# Polegar em repouso: reto, aberto para o lado e um pouco para a frente da palma
THUMB_CMC = np.array((0.175, -0.055, 0.205))
THUMB_DIR = np.array((0.62, -0.30, 0.72))
THUMB_DIR = THUMB_DIR / np.linalg.norm(THUMB_DIR)
THUMB_LENGTHS = (0.43, 0.31, 0.26)
THUMB_RADII = (0.118, 0.106, 0.096, 0.08)  # CMC, MCP, IP, ponta


def _unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def thumb_nail_normal():
    """Unha do polegar: virada para o lado de fora (de lado para quem ve a palma)."""
    n0 = np.array((1.0, 0.12, 0.0))
    n = n0 - n0.dot(THUMB_DIR) * THUMB_DIR
    return _unit(n)


def finger_dir(f):
    a = FAN[f]
    return np.array((np.sin(a), 0.0, np.cos(a)))


def joints():
    """Posicoes das articulacoes em repouso: dict nome -> (cabeca, cauda, eixo Z do osso)."""
    out = {}
    up = np.array((0.0, 1.0, 0.0))
    out['wrist'] = (np.zeros(3), np.array((0.0, 0.0, 0.32)), up)
    for f in FINGERS:
        m = np.array(MCP[f])
        d = finger_dir(f)
        l1, l2, l3 = LENGTHS[f]
        pip = m + d * l1
        dip = pip + d * l2
        tip = dip + d * l3
        # Metacarpo: do carpo (perto do pulso) ate a base do dedo; gira para a palma fechar em concha
        base = np.array((m[0] * 0.42, 0.0, 0.16))
        out[f + '_meta'] = (base, m, up)
        out[f + '_mcp'] = (m, pip, up)
        out[f + '_pip'] = (pip, dip, up)
        out[f + '_dip'] = (dip, tip, up)
    nn = thumb_nail_normal()
    c = THUMB_CMC
    mcp = c + THUMB_DIR * THUMB_LENGTHS[0]
    ip = mcp + THUMB_DIR * THUMB_LENGTHS[1]
    tip = ip + THUMB_DIR * THUMB_LENGTHS[2]
    out['thumb_cmc'] = (c, mcp, nn)
    out['thumb_mcp'] = (mcp, ip, nn)
    out['thumb_ip'] = (ip, tip, nn)
    return out


PARENTS = {'wrist': None, 'thumb_cmc': 'wrist', 'thumb_mcp': 'thumb_cmc', 'thumb_ip': 'thumb_mcp'}
for _f in FINGERS:
    PARENTS[_f + '_meta'] = 'wrist'
    PARENTS[_f + '_mcp'] = _f + '_meta'
    PARENTS[_f + '_pip'] = _f + '_mcp'
    PARENTS[_f + '_dip'] = _f + '_pip'
BONES = ['wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip'] + [
    f + s for f in FINGERS for s in ('_meta', '_mcp', '_pip', '_dip')
]


# --------------------------------------------------------------------------- #
# Primitivas de distancia (vetorizadas: p e (N, 3))
# --------------------------------------------------------------------------- #
def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def frame(along, up):
    """Base ortonormal (lado, costas, comprimento) para um eixo e um 'para cima' aproximado."""
    w = _unit(along)
    v = np.asarray(up, float) - np.dot(up, w) * w
    v = _unit(v)
    u = np.cross(v, w)
    return u, v, w


def tube(p, origin, axis, up, t0, t1, radius_fn, back_fn, front_fn):
    """
    Tubo reto de raio variavel ao longo do eixo, com secao eliptica assimetrica: meia largura
    r(t), meia espessura para as costas r(t)*back(t) e para a palma r(t)*front(t). Pontas
    arredondadas. Distancia aproximada (boa enquanto o raio varia devagar).
    """
    u, v, w = frame(axis, up)
    q = p - origin
    x = q @ u
    y = q @ v
    t = q @ w
    tc = np.clip(t, t0, t1)
    r = radius_fn(tc)
    sy = np.where(y > 0, back_fn(tc), front_fn(tc))
    rad = np.sqrt(x * x + (y / sy) ** 2)
    dt = t - tc
    return np.sqrt(rad * rad + dt * dt) - r, (x, y, t)


def ellipsoid(p, c, radii, axes=None):
    q = p - np.asarray(c)
    if axes is not None:
        q = q @ np.asarray(axes).T
    r = np.asarray(radii)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def polygon2d(px, pz, pts):
    """Distancia com sinal ate um poligono (pontos em ordem), no plano XZ."""
    pts = np.asarray(pts, float)
    n = len(pts)
    d = np.full(px.shape, np.inf)
    s = np.ones(px.shape)
    for i in range(n):
        a = pts[i - 1]
        b = pts[i]
        ex, ez = b - a
        wx, wz = px - a[0], pz - a[1]
        h = np.clip((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1)
        dx, dz = wx - ex * h, wz - ez * h
        d = np.minimum(d, dx * dx + dz * dz)
        c1 = pz >= a[1]
        c2 = pz < b[1]
        c3 = ex * wz > ez * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


def polyline_dist2d(px, pz, pts):
    pts = np.asarray(pts, float)
    d = np.full(px.shape, np.inf)
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        ex, ez = b - a
        wx, wz = px - a[0], pz - a[1]
        h = np.clip((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1)
        d = np.minimum(d, np.hypot(wx - ex * h, wz - ez * h))
    return d


# --------------------------------------------------------------------------- #
# Forma
# --------------------------------------------------------------------------- #
def _bump(t, c, w):
    return np.exp(-((t - c) / w) ** 2)


def finger_sdf(p, f):
    m = np.array(MCP[f])
    d = finger_dir(f)
    l1, l2, l3 = LENGTHS[f]
    r0, r1, r2, r3 = RADII[f]
    L = l1 + l2 + l3
    knots_t = np.array((-0.06, 0.0, l1, l1 + l2, L - 0.6 * r3, L))
    knots_r = np.array((r0 * 1.04, r0, r1, r2, r3, r3 * 0.94))

    def radius(t):
        r = np.interp(t, knots_t, knots_r)
        # Articulacoes um pouco mais largas que o meio das falanges
        r = r * (1.0 + 0.045 * _bump(t, l1, 0.035) + 0.035 * _bump(t, l1 + l2, 0.03)
                 - 0.03 * _bump(t, l1 * 0.55, l1 * 0.22) - 0.025 * _bump(t, l1 + l2 * 0.5, l2 * 0.25))
        return r

    def back(t):
        # Costas do dedo: achatadas sobre a unha
        nail = smoothstep(l1 + l2 + 0.02, l1 + l2 + 0.08, t)
        return 0.86 - 0.12 * nail + 0.06 * _bump(t, l1, 0.03)

    def front(t):
        # Almofadas na palma do dedo; mais fundas nas dobras; polpa na ponta
        pads = (0.06 * _bump(t, l1 * 0.5, l1 * 0.28) + 0.05 * _bump(t, l1 + l2 * 0.5, l2 * 0.3)
                + 0.12 * _bump(t, l1 + l2 + l3 * 0.62, l3 * 0.28))
        return 0.86 + pads

    t1 = L - r3 * 0.94
    dist, (x, y, t) = tube(p, m, d, (0, 1, 0), -0.06, t1, radius, back, front)
    return dist


def thumb_sdf(p):
    nn = thumb_nail_normal()
    l0, l1, l2 = THUMB_LENGTHS
    r0, r1, r2, r3 = THUMB_RADII
    L = l0 + l1 + l2
    kt = np.array((0.0, l0, l0 + l1, L - 0.6 * r3, L))
    kr = np.array((r0, r1, r2, r3, r3 * 0.94))

    def radius(t):
        r = np.interp(t, kt, kr)
        return r * (1.0 + 0.05 * _bump(t, l0, 0.04) + 0.04 * _bump(t, l0 + l1, 0.03)
                    - 0.03 * _bump(t, l0 + l1 * 0.5, l1 * 0.25))

    def back(t):
        nail = smoothstep(l0 + l1 + 0.02, l0 + l1 + 0.08, t)
        return 0.84 - 0.12 * nail

    def front(t):
        return 0.86 + 0.06 * _bump(t, l0 + l1 * 0.5, l1 * 0.3) + 0.13 * _bump(t, l0 + l1 + l2 * 0.6, l2 * 0.3)

    t1 = L - r3 * 0.94
    dist, _ = tube(p, THUMB_CMC, THUMB_DIR, nn, 0.06, t1, radius, back, front)
    return dist


PALM_OUTLINE = [
    (-0.22, 0.0), (0.21, 0.01), (0.27, 0.16), (0.31, 0.44), (0.315, 0.80), (0.28, 0.99),
    (0.12, 1.0), (-0.11, 0.96), (-0.32, 0.86), (-0.43, 0.76), (-0.44, 0.55), (-0.37, 0.2),
]


def palm_sdf(p):
    """Placa arredondada com o contorno da palma (contorno recuado 0,05 e depois expandido)."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    d2 = polygon2d(x, z, PALM_OUTLINE) - 0.05
    # Meia espessura: mais grossa no calcanhar da mao, mais fina no meio da palma
    h = 0.106 + 0.02 * smoothstep(0.5, 0.05, z) - 0.01 * _bump(z, 0.6, 0.2)
    yc = -0.008 + 0.012 * smoothstep(0.4, 1.0, z)
    # Arco transversal: as costas da mao sao convexas
    yc = yc - 0.05 * (x / 0.5) ** 2 * smoothstep(0.1, 0.8, z)
    a = np.maximum(d2 + h, 0)
    b = np.abs(y - yc)
    return np.sqrt(a * a + b * b) + np.minimum(np.maximum(d2 + h, b), 0) - h


def hand_regions(p):
    """Distancias por regiao (antes da uniao): palma, polegar e cada dedo."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    palm = palm_sdf(p)
    # Almofadas da palma (lado de -Y)
    tdir = THUMB_DIR
    u, v, w = frame(tdir, (0, 1, 0))
    thenar = ellipsoid(p, (0.205, -0.1, 0.34), (0.15, 0.11, 0.28), axes=(u, v, w))
    hypo = ellipsoid(p, (-0.31, -0.07, 0.38), (0.15, 0.09, 0.33))
    distal_pad = ellipsoid(p, (-0.07, -0.08, 0.875), (0.40, 0.045, 0.09),
                           axes=((0.97, 0, 0.24), (0, 1, 0), (-0.24, 0, 0.97)))
    heel = ellipsoid(p, (0.0, -0.05, 0.12), (0.26, 0.08, 0.14))
    palm = smin(palm, thenar, 0.06)
    palm = smin(palm, hypo, 0.06)
    palm = smin(palm, distal_pad, 0.04)
    palm = smin(palm, heel, 0.06)
    # Pulso e antebraco: secao eliptica, mais larga que alta
    zc = np.clip(z, -0.62, 0.14)
    wx = 0.262 + 0.03 * smoothstep(0.0, -0.5, zc) - 0.01 * smoothstep(0.14, 0.0, zc)
    wy = 0.165 + 0.025 * smoothstep(0.0, -0.5, zc)
    arm = np.sqrt((x / wx) ** 2 + ((y - 0.005) / wy) ** 2 + ((z - zc) / 0.2) ** 2) - 1.0
    arm = arm * np.minimum(wx, wy)
    palm = smin(palm, arm, 0.1)
    # Saliencias dos nos dos dedos nas costas da mao
    for f in FINGERS:
        m = np.array(MCP[f])
        kn = ellipsoid(p, m + np.array((0, 0.035, -0.03)), (0.07, 0.06, 0.075))
        palm = smin(palm, kn, 0.035)
    regions = {'palm': palm, 'thumb': thumb_sdf(p)}
    for f in FINGERS:
        regions[f] = finger_sdf(p, f)
    return regions


def hand_sdf(p):
    r = hand_regions(p)
    d = r['palm']
    d = smin(d, r['thumb'], 0.075)
    for f in FINGERS:
        k = 0.05 if f != 'pinky' else 0.045
        d = smin(d, r[f], k)
    # Corte reto no antebraco
    d = np.maximum(d, -(p[:, 2] + 0.55))
    return d


def sdf_grad(fn, p, eps=1e-3):
    g = np.zeros_like(p)
    for i in range(3):
        e = np.zeros(3)
        e[i] = eps
        g[:, i] = (fn(p + e) - fn(p - e)) / (2 * eps)
    return g


def project(fn, p, iters=3):
    for _ in range(iters):
        d = fn(p)
        g = sdf_grad(fn, p)
        gg = np.maximum((g * g).sum(1), 1e-6)
        p = p - (d / gg)[:, None] * g
    return p


# --------------------------------------------------------------------------- #
# Malha: surface nets
# --------------------------------------------------------------------------- #
BOUNDS = ((-0.62, 1.12), (-0.62, 0.34), (-0.58, 2.18))


def surface_nets(fn, h, bounds=BOUNDS, chunk=400_000):
    xs = np.arange(bounds[0][0], bounds[0][1] + h, h)
    ys = np.arange(bounds[1][0], bounds[1][1] + h, h)
    zs = np.arange(bounds[2][0], bounds[2][1] + h, h)
    nx, ny, nz = len(xs), len(ys), len(zs)
    G = np.stack(np.meshgrid(xs, ys, zs, indexing='ij'), -1).reshape(-1, 3)
    F = np.empty(len(G))
    for i in range(0, len(G), chunk):
        F[i:i + chunk] = fn(G[i:i + chunk])
    F = F.reshape(nx, ny, nz)
    F[F == 0] = 1e-9
    inside = F < 0
    # Cubos ativos (troca de sinal entre os 8 cantos)
    c = [inside[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz] for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)]
    anyin = np.zeros_like(c[0])
    allin = np.ones_like(c[0])
    for a in c:
        anyin |= a
        allin &= a
    active = anyin & ~allin
    idx = np.argwhere(active)
    vid = -np.ones(active.shape, dtype=np.int64)
    vid[active] = np.arange(len(idx))
    corners = np.array([(dx, dy, dz) for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)])
    vals = np.stack([F[idx[:, 0] + o[0], idx[:, 1] + o[1], idx[:, 2] + o[2]] for o in corners], 1)
    edges = [(a, b) for a in range(8) for b in range(a + 1, 8) if np.abs(corners[a] - corners[b]).sum() == 1]
    acc = np.zeros((len(idx), 3))
    cnt = np.zeros(len(idx))
    for a, b in edges:
        fa, fb = vals[:, a], vals[:, b]
        m = (fa < 0) != (fb < 0)
        t = np.where(m, fa / np.where(m, fa - fb, 1), 0)
        pt = corners[a] + (corners[b] - corners[a]) * t[:, None]
        acc += np.where(m[:, None], pt, 0)
        cnt += m
    local = acc / cnt[:, None]
    verts = (idx + local) * h + np.array((xs[0], ys[0], zs[0]))
    faces = []
    # Arestas da grade com troca de sinal -> um quad com os 4 cubos em volta
    for axis in range(3):
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, -1)
        sl1[axis] = slice(1, None)
        a = inside[tuple(sl0)]
        b = inside[tuple(sl1)]
        e = np.argwhere(a != b)
        out_pos = a[tuple(e.T)]  # dentro em i, fora em i+1 -> normal no sentido +eixo
        o1, o2 = [(1, 2), (2, 0), (0, 1)][axis]
        ok = (e[:, o1] >= 1) & (e[:, o2] >= 1) & (e[:, o1] < [nx, ny, nz][o1] - 1) & (e[:, o2] < [nx, ny, nz][o2] - 1)
        e = e[ok]
        out_pos = out_pos[ok]
        cyc = [(-1, -1), (0, -1), (0, 0), (-1, 0)]
        quads = []
        for d1, d2 in cyc:
            cc = e.copy()
            cc[:, o1] += d1
            cc[:, o2] += d2
            quads.append(vid[cc[:, 0], cc[:, 1], cc[:, 2]])
        q = np.stack(quads, 1)
        q = np.where(out_pos[:, None], q, q[:, ::-1])
        faces.append(q)
    faces = np.concatenate(faces)
    faces = faces[(faces >= 0).all(1)]
    return verts, faces


# --------------------------------------------------------------------------- #
# Vincos (deslocamento ao longo da normal, so na malha detalhada)
# --------------------------------------------------------------------------- #
PALM_CREASES = [
    # (pontos no plano XZ, profundidade)
    ([(-0.49, 0.70), (-0.32, 0.735), (-0.14, 0.79), (0.02, 0.86), (0.10, 0.93), (0.13, 0.98)], 0.0085),  # distal
    ([(0.37, 0.735), (0.22, 0.70), (0.04, 0.64), (-0.15, 0.565), (-0.30, 0.50)], 0.0085),  # proximal
    ([(0.33, 0.715), (0.22, 0.60), (0.14, 0.46), (0.105, 0.31), (0.11, 0.17), (0.13, 0.05)], 0.009),  # tenar
    ([(-0.24, 0.01), (-0.08, 0.035), (0.08, 0.035), (0.24, 0.02)], 0.006),  # pulso
    ([(-0.22, -0.065), (0.0, -0.05), (0.22, -0.06)], 0.0045),
]


def crease_offsets(p, n):
    """Deslocamento (negativo = para dentro) dos vincos para pontos p com normais n."""
    off = np.zeros(len(p))
    sig = 0.0055
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    palmar = smoothstep(0.15, 0.7, -n[:, 1])
    in_palm = (z < 1.06)
    for pts, depth in PALM_CREASES:
        d = polyline_dist2d(x, z, pts)
        off -= depth * np.exp(-(d / sig) ** 2) * palmar * in_palm
    for f in FINGERS:
        m = np.array(MCP[f])
        u, v, w = frame(finger_dir(f), (0, 1, 0))
        q = p - m
        fx, fy, ft = q @ u, q @ v, q @ w
        l1, l2, l3 = LENGTHS[f]
        r = RADII[f][1]
        near = np.abs(fx) < r * 1.6
        fn = n @ v  # normal para as costas (+) ou para a palma (-)
        pal = smoothstep(0.05, 0.6, -fn) * (fy < 0.02) * near
        side = 1.0 - smoothstep(0.55 * r, 0.95 * r, np.abs(fx))
        for t0, depth in ((0.15, 0.004), (l1 - 0.01, 0.0045), (l1 + 0.01, 0.0035), (l1 + l2 - 0.004, 0.0042)):
            # vinco levemente curvo (mais baixo no meio do dedo)
            tc = t0 + 0.012 * (fx / r) ** 2
            off -= depth * np.exp(-((ft - tc) / 0.0045) ** 2) * pal * side
        dors = smoothstep(0.25, 0.7, fn) * (fy > 0) * near
        side_d = 1.0 - smoothstep(0.35 * r, 0.75 * r, np.abs(fx))
        for t0, depth in ((l1 - 0.03, 0.0026), (l1 - 0.008, 0.0032), (l1 + 0.014, 0.0028), (l1 + 0.034, 0.002),
                          (l1 + l2 - 0.012, 0.0022), (l1 + l2 + 0.008, 0.0018)):
            tc = t0 - 0.02 * (fx / r) ** 2
            off -= depth * np.exp(-((ft - tc) / 0.004) ** 2) * dors * side_d
    # Polegar: dobras na palma do polegar (MCP e IP) e rugas nas costas da IP
    u, v, w = frame(THUMB_DIR, thumb_nail_normal())
    q = p - THUMB_CMC
    fx, fy, ft = q @ u, q @ v, q @ w
    l0, l1, l2 = THUMB_LENGTHS
    r = THUMB_RADII[2]
    near = (np.abs(fx) < r * 1.6) & (ft > l0 - 0.05)
    fn = n @ v
    pal = smoothstep(0.05, 0.6, -fn) * (fy < 0.02) * near
    side = 1.0 - smoothstep(0.55 * r, 0.95 * r, np.abs(fx))
    for t0, depth in ((l0 + 0.02, 0.0065), (l0 + l1, 0.007)):
        tc = t0 + 0.012 * (fx / r) ** 2
        off -= depth * np.exp(-((ft - tc) / 0.005) ** 2) * pal * side
    dors = smoothstep(0.25, 0.7, fn) * (fy > 0) * near
    side_d = 1.0 - smoothstep(0.35 * r, 0.75 * r, np.abs(fx))
    for t0, depth in ((l0 + l1 - 0.02, 0.0025), (l0 + l1, 0.003), (l0 + l1 + 0.02, 0.0022)):
        tc = t0 - 0.02 * (fx / r) ** 2
        off -= depth * np.exp(-((ft - tc) / 0.004) ** 2) * dors * side_d
    return off


def nail_frame(name):
    """(origem da DIP, eixo do dedo, eixo das costas, comprimento distal, raio na DIP, raio na ponta)."""
    if name == 'thumb':
        l0, l1, l2 = THUMB_LENGTHS
        o = THUMB_CMC + THUMB_DIR * (l0 + l1)
        return o, THUMB_DIR, thumb_nail_normal(), l2, THUMB_RADII[2], THUMB_RADII[3]
    m = np.array(MCP[name])
    d = finger_dir(name)
    l1, l2, l3 = LENGTHS[name]
    return m + d * (l1 + l2), d, np.array((0.0, 1.0, 0.0)), l3, RADII[name][2], RADII[name][3]
