"""
Gera a mao 3D do prototipo da abertura (src/mao-3d.glb), com o Blender em modo headless.

    blender --background --factory-startup --python scripts/mao3d/gerar.py -- --out /tmp/mao-bruta.glb
    npx gltfpack -i /tmp/mao-bruta.glb -o src/mao-3d.glb -cc -kn -km

O modelo e nosso (feito por este script), sem asset de terceiros. Etapas:
1. Forma: funcao de distancia da mao em repouso (anatomia.py), virada em malha por surface nets.
2. Malha detalhada (subdividida e projetada na superficie) com os vincos da pele e o sulco das
   unhas; malha leve (a que vai para o site) projetada na mesma superficie.
3. Mapa de normais: os detalhes da malha detalhada assados na malha leve (Cycles).
4. Unhas: placas finas assentadas na superficie de cada ponta de dedo, com cor por vertice
   (lunula e borda livre mais claras).
5. Esqueleto: um osso por segmento do MediaPipe (pulso, metacarpos, polegar CMC/MCP/IP e
   MCP/PIP/DIP de cada dedo, mais as pontas), com +Y ao longo do osso e +Z para o lado da unha.
   Pesos calculados por regiao (palma, polegar e cada dedo), com transicao suave nas juntas.
6. Exporta GLB (Y para cima). A cor da pele fica branca: o tom vem do site, na hora.
"""
import argparse
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anatomia as A  # noqa: E402

T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True)
    p.add_argument('--high', type=float, default=0.0115, help='grade da malha detalhada')
    p.add_argument('--low', type=float, default=0.021, help='grade da malha leve')
    p.add_argument('--tris', type=int, default=11000, help='triangulos da pele (malha leve)')
    p.add_argument('--tex', type=int, default=1024, help='lado do mapa de normais')
    p.add_argument('--quality', type=int, default=88, help='qualidade JPEG do mapa de normais')
    p.add_argument('--blend', default='', help='salva tambem o .blend (para inspecao)')
    return p.parse_args(argv)


# --------------------------------------------------------------------------- #
# Utilitarios de malha
# --------------------------------------------------------------------------- #
def new_mesh(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(verts).tolist(), [], np.asarray(faces).tolist())
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def get_co(me):
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def set_co(me, co):
    me.vertices.foreach_set('co', np.ascontiguousarray(co, dtype=np.float64).ravel())
    me.update()


def vertex_normals(me):
    n = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3)


def apply_all_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def select_only(*obs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def neighbors(me):
    """Pares de vertices vizinhos (arestas) como arrays."""
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', e)
    return e.reshape(-1, 2)


def laplacian(values, edges, n, iters=1, lam=0.5):
    v = values.copy()
    for _ in range(iters):
        acc = np.zeros_like(v)
        cnt = np.zeros(n)
        np.add.at(acc, edges[:, 0], v[edges[:, 1]])
        np.add.at(acc, edges[:, 1], v[edges[:, 0]])
        np.add.at(cnt, edges[:, 0], 1)
        np.add.at(cnt, edges[:, 1], 1)
        avg = acc / np.maximum(cnt, 1).reshape((-1,) + (1,) * (v.ndim - 1))
        v = v + lam * (avg - v)
    return v


# --------------------------------------------------------------------------- #
# Unhas
# --------------------------------------------------------------------------- #
DIGITS = ('thumb',) + A.FINGERS


def nail_outline(name):
    """Contorno da unha no referencial da falange distal: (v_prox(s), v_dist(s), meia largura(v))."""
    o, ax, dors, l3, rd, rt = A.nail_frame(name)
    w = 0.80 * (rd + rt) / 2

    def v_prox(s):
        return 0.38 * l3 + 0.30 * w * s * s

    def v_dist(s):
        return l3 - 0.30 * rt - 0.45 * rt * s * s

    def half_w(v):
        r = np.interp(v, (0, l3), (rd, rt))
        return 0.80 * r

    return v_prox, v_dist, half_w


def nail_local(name, p):
    o, ax, dors, l3, rd, rt = A.nail_frame(name)
    lat = np.cross(dors, ax)
    q = p - o
    return q @ lat, q @ ax, q @ dors


def nail_groove(p, n):
    """Sulco em volta da unha (cuticula e dobras laterais) para a malha detalhada."""
    off = np.zeros(len(p))
    for name in DIGITS:
        o, ax, dors, l3, rd, rt = A.nail_frame(name)
        u, v, y = nail_local(name, p)
        v_prox, v_dist, half_w = nail_outline(name)
        hw = half_w(v)
        # coordenada s aproximada (lado) e distancia ate a borda (cuticula + laterais)
        s = np.clip(u / np.maximum(hw, 1e-6), -1, 1)
        d_side = np.abs(u) - hw
        d_prox = v_prox(s) - v
        dn = np.maximum(d_side, d_prox)
        up = A.smoothstep(0.2, 0.6, n @ dors) * (y > 0)
        before_tip = v < v_dist(s) - 0.004
        g = np.exp(-(dn / 0.0042) ** 2) * up * before_tip * (v > 0.1 * l3)
        off -= 0.0032 * g
        # Dentro da unha a pele afunda um pouco (a placa fica por cima)
        inside = (dn < 0) & before_tip & (up > 0)
        off -= 0.0025 * inside * A.smoothstep(0.0, 0.006, -dn)
    return off


def build_nails(fn):
    """Placa de cada unha: topo, fundo e borda, assentada na superficie da funcao de distancia."""
    verts, faces, colors, owner = [], [], [], []
    ns, nv = 9, 9
    for name in DIGITS:
        o, ax, dors, l3, rd, rt = A.nail_frame(name)
        lat = np.cross(dors, ax)
        v_prox, v_dist, half_w = nail_outline(name)
        S = np.linspace(-1, 1, ns)
        Tt = np.linspace(0, 1, nv)
        grid = []
        for t in Tt:
            for s in S:
                v = v_prox(s) + t * (v_dist(s) - v_prox(s))
                u = s * half_w(v)
                grid.append(o + ax * v + lat * u + dors * 0.25)
        grid = np.array(grid)
        # Desce ao longo de -costas ate a superficie (bissecao)
        lo = np.zeros(len(grid))
        hi = np.full(len(grid), 0.3)
        for _ in range(40):
            mid = (lo + hi) / 2
            d = fn(grid - dors * mid[:, None])
            outside = d > 0
            lo = np.where(outside, mid, lo)
            hi = np.where(outside, hi, mid)
        surf = grid - dors * ((lo + hi) / 2)[:, None]
        g = A.sdf_grad(fn, surf)
        g /= np.linalg.norm(g, axis=1, keepdims=True)
        sg, tg = np.meshgrid(S, Tt)
        sg, tg = sg.ravel(), tg.ravel()
        edge = 1 - np.abs(sg) ** 4
        top_off = 0.0008 + 0.0022 * edge * A.smoothstep(0.0, 0.25, tg)
        top = surf + g * top_off[:, None]
        bot = surf - g * 0.003
        base = len(verts)
        verts.extend(top.tolist())
        verts.extend(bot.tolist())
        # Cor: lunula clara perto da cuticula, borda livre mais clara, resto rosado
        for s, t in zip(sg, tg):
            lun = math.exp(-((t - 0.06) / 0.09) ** 2) * (1 - s * s) * 0.6
            free = A.smoothstep(0.82, 1.0, t)
            c = 0.74 + 0.16 * max(lun, free)
            colors.append((c, c * 0.95, c * 0.94, 1.0))
        colors.extend([(0.6, 0.55, 0.54, 1.0)] * len(bot))
        owner.extend([name] * (2 * len(top)))
        idx = lambda i, j: i * ns + j  # noqa: E731
        n_top = ns * nv
        for i in range(nv - 1):
            for j in range(ns - 1):
                a, b, c_, d_ = idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)
                # topo virado para as costas (normal para fora): ordem conforme lat x ax = -dors
                faces.append([base + a, base + d_, base + c_, base + b])
                faces.append([base + n_top + a, base + n_top + b, base + n_top + c_, base + n_top + d_])
        ring = [idx(0, j) for j in range(ns)] + [idx(i, ns - 1) for i in range(1, nv)] + \
               [idx(nv - 1, j) for j in range(ns - 2, -1, -1)] + [idx(i, 0) for i in range(nv - 2, 0, -1)]
        for k in range(len(ring)):
            a, b = ring[k], ring[(k + 1) % len(ring)]
            faces.append([base + a, base + b, base + n_top + b, base + n_top + a])
    return np.array(verts), faces, colors, owner


# --------------------------------------------------------------------------- #
# Esqueleto e pesos
# --------------------------------------------------------------------------- #
TIP_BONES = {'thumb': 'thumb_ip'} | {f: f + '_dip' for f in A.FINGERS}


def build_armature():
    arm = bpy.data.armatures.new('esqueleto')
    ob = bpy.data.objects.new('esqueleto', arm)
    bpy.context.scene.collection.objects.link(ob)
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    J = A.joints()
    eb = {}
    for name in A.BONES:
        head, tail, zaxis = J[name]
        b = arm.edit_bones.new(name)
        b.head = head.tolist()
        b.tail = tail.tolist()
        b.align_roll(zaxis.tolist())
        eb[name] = b
    for name in A.BONES:
        par = A.PARENTS[name]
        if par:
            eb[name].parent = eb[par]
            eb[name].use_connect = bool(np.allclose(J[par][1], J[name][0]))
    # Pontas (sem peso): servem para o enquadramento e para conferir o comprimento do dedo
    for digit, par in TIP_BONES.items():
        head, tail, zaxis = J[par]
        d = tail - head
        b = arm.edit_bones.new(digit + '_tip')
        b.head = tail.tolist()
        b.tail = (tail + d / np.linalg.norm(d) * 0.05).tolist()
        b.align_roll(zaxis.tolist())
        b.parent = eb[par]
        b.use_connect = True
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def seg_param(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1), t


def skin_weights(p):
    """Pesos (N, n_ossos) por regiao, com transicao suave nas juntas."""
    S = A.smoothstep
    bi = {b: i for i, b in enumerate(A.BONES)}
    W = np.zeros((len(p), len(A.BONES)))
    reg = A.hand_regions(p)
    names = ['palm', 'thumb'] + list(A.FINGERS)
    D = np.stack([reg[n] for n in names], 1)
    D[:, 1:] -= 0.004  # nas dobras entre dedo e palma, o dedo ganha
    owner = np.argmin(D, 1)
    J = A.joints()
    x, y, z = p[:, 0], p[:, 1], p[:, 2]

    # Palma: pulso embaixo, metacarpos por proximidade lateral
    palm_w = np.zeros((len(p), len(A.BONES)))
    md = []
    for f in A.FINGERS:
        base, mcp, _ = J[f + '_meta']
        a2 = np.array((base[0], base[2]))
        b2 = np.array((mcp[0], mcp[2]))
        q = np.stack([x, z], 1)
        ab = b2 - a2
        t = np.clip(((q - a2) @ ab) / (ab @ ab), 0, 1)
        d2 = np.linalg.norm(q - (a2 + t[:, None] * ab), axis=1)
        md.append(1.0 / (d2 + 0.035) ** 3)
    md = np.stack(md, 1)
    md /= md.sum(1, keepdims=True)
    w_wrist = 1 - S(0.04, 0.42, z)
    palm_w[:, bi['wrist']] = w_wrist
    for k, f in enumerate(A.FINGERS):
        palm_w[:, bi[f + '_meta']] = (1 - w_wrist) * md[:, k]
    # Eminencia tenar acompanha o metacarpo do polegar
    c0, c1, _ = J['thumb_cmc']
    dth, tth = seg_param(p, c0, c1)
    th = np.clip(1.25 - dth / 0.13, 0, 1) * 0.8 * S(-0.02, 0.25, tth * np.linalg.norm(c1 - c0))
    palm_w *= (1 - th)[:, None]
    palm_w[:, bi['thumb_cmc']] += th

    # Perto das bases dos dedos, a pele da palma acompanha um pouco a falange proximal
    for f in A.FINGERS:
        m = np.array(A.MCP[f])
        u, v, w = A.frame(A.finger_dir(f), (0, 1, 0))
        q = p - m
        fx, ft = q @ u, q @ w
        r = A.RADII[f][0]
        near = 1 - S(0.75 * r, 1.25 * r, np.abs(fx))
        s = S(-0.06, 0.05, ft) * near * 0.55
        palm_w *= (1 - s)[:, None]
        palm_w[:, bi[f + '_mcp']] += s
    W = np.where((owner == 0)[:, None], palm_w, W)

    # Dedos
    for k, f in enumerate(A.FINGERS):
        sel = owner == 2 + k
        m = np.array(A.MCP[f])
        u, v, w = A.frame(A.finger_dir(f), (0, 1, 0))
        ft = (p - m) @ w
        l1, l2, l3 = A.LENGTHS[f]
        s1 = S(-0.07, 0.045, ft)
        s2 = S(l1 - 0.035, l1 + 0.03, ft)
        s3 = S(l1 + l2 - 0.03, l1 + l2 + 0.025, ft)
        fw = np.zeros((len(p), len(A.BONES)))
        fw[:, bi[f + '_meta']] = (1 - s1)
        fw[:, bi[f + '_mcp']] = s1 * (1 - s2)
        fw[:, bi[f + '_pip']] = s2 * (1 - s3)
        fw[:, bi[f + '_dip']] = s3
        W = np.where(sel[:, None], fw, W)

    # Polegar
    sel = owner == 1
    ft = (p - A.THUMB_CMC) @ A.THUMB_DIR
    l0, l1, l2 = A.THUMB_LENGTHS
    s0 = S(-0.02, 0.12, ft)
    s1 = S(l0 - 0.045, l0 + 0.035, ft)
    s2 = S(l0 + l1 - 0.035, l0 + l1 + 0.03, ft)
    tw = np.zeros((len(p), len(A.BONES)))
    tw[:, bi['wrist']] = (1 - s0) * 0.5
    tw[:, bi['index_meta']] = (1 - s0) * 0.5
    tw[:, bi['thumb_cmc']] = s0 * (1 - s1)
    tw[:, bi['thumb_mcp']] = s1 * (1 - s2)
    tw[:, bi['thumb_ip']] = s2
    W = np.where(sel[:, None], tw, W)
    return W


def limit_weights(W, k=4):
    idx = np.argsort(-W, 1)[:, :k]
    out = np.zeros_like(W)
    rows = np.arange(len(W))[:, None]
    out[rows, idx] = W[rows, idx]
    out[out < 0.01] = 0
    return out / np.maximum(out.sum(1, keepdims=True), 1e-9)


def assign_weights(ob, W, arm_ob):
    groups = [ob.vertex_groups.new(name=b) for b in A.BONES]
    for j, g in enumerate(groups):
        col = W[:, j]
        nz = np.nonzero(col > 0)[0]
        for i in nz:
            g.add([int(i)], float(col[i]), 'REPLACE')
    mod = ob.modifiers.new('esqueleto', 'ARMATURE')
    mod.object = arm_ob
    ob.parent = arm_ob


# --------------------------------------------------------------------------- #
# Materiais
# --------------------------------------------------------------------------- #
def skin_material(normal_img):
    mat = bpy.data.materials.new('pele')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    if normal_img is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = normal_img
        tex.image.colorspace_settings.name = 'Non-Color'
        nt.nodes.active = tex
    return mat


def connect_normal_map(mat):
    """Liga o mapa ao Principled depois de assar (antes disso seria uma dependencia circular)."""
    nt = mat.node_tree
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], nt.nodes['Principled BSDF'].inputs['Normal'])


def nail_material():
    mat = bpy.data.materials.new('unha')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.32
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'cor'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


# --------------------------------------------------------------------------- #
def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fn = A.hand_sdf

    # ---------- malha leve ----------
    v, f = A.surface_nets(fn, a.low)
    v = A.project(fn, v, 3)
    low = new_mesh('pele', v, f)
    me = low.data
    # Um pouco de suavizacao + projecao de volta: triangulos mais regulares
    E = neighbors(me)
    for _ in range(3):
        co = laplacian(get_co(me), E, len(me.vertices), iters=2, lam=0.5)
        set_co(me, A.project(fn, co, 2))
    me.calc_loop_triangles()
    log('malha leve (surface nets):', len(me.vertices), 'vertices,', len(me.loop_triangles), 'triangulos')
    if len(me.loop_triangles) > a.tris:
        mod = low.modifiers.new('reduz', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = a.tris / len(me.loop_triangles)
        mod.use_collapse_triangulate = True
        apply_all_modifiers(low)
        me = low.data
        set_co(me, A.project(fn, get_co(me), 2))
    # triangulos de vez (o GLB sai triangulado de qualquer forma)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.update()
    me.calc_loop_triangles()
    log('malha leve final:', len(me.vertices), 'vertices,', len(me.loop_triangles), 'triangulos')

    # UV (projecao inteligente)
    select_only(low)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.006, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    log('UV ok')

    # ---------- malha detalhada ----------
    v, f = A.surface_nets(fn, a.high)
    v = A.project(fn, v, 3)
    high = new_mesh('pele_detalhe', v, f)
    sub = high.modifiers.new('sub', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    apply_all_modifiers(high)
    hm = high.data
    set_co(hm, A.project(fn, get_co(hm), 2))
    hm.update()
    co = get_co(hm)
    nrm = vertex_normals(hm)
    off = A.crease_offsets(co, nrm) + nail_groove(co, nrm)
    set_co(hm, co + nrm * off[:, None])
    log('malha detalhada:', len(hm.vertices), 'vertices')

    # ---------- mapa de normais ----------
    img = bpy.data.images.new('pele_normal', a.tex, a.tex, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0.5, 0.5, 1.0, 1.0)
    mat = skin_material(img)
    low.data.materials.append(mat)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    bk = sc.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = 0.012
    bk.max_ray_distance = 0.03
    bk.margin = 6
    bk.normal_space = 'TANGENT'
    select_only(high, low, active=low)
    bpy.ops.object.bake(type='NORMAL')
    out_dir = os.path.dirname(os.path.abspath(a.out))
    tex_path = os.path.join(out_dir, 'pele_normal.jpg')
    img.filepath_raw = tex_path
    img.file_format = 'JPEG'
    sc.render.image_settings.quality = a.quality
    img.save(filepath=tex_path, quality=a.quality)
    img.source = 'FILE'
    img.filepath = tex_path
    img.reload()
    connect_normal_map(mat)
    log('mapa de normais:', tex_path, os.path.getsize(tex_path), 'bytes')
    bpy.data.objects.remove(high)

    # ---------- unhas ----------
    nv, nf, ncol, nown = build_nails(fn)
    nails = new_mesh('unhas', nv, nf)
    attr = nails.data.color_attributes.new('cor', 'BYTE_COLOR', 'POINT')
    attr.data.foreach_set('color', np.array(ncol, dtype=np.float32).ravel())
    nails.data.color_attributes.active_color = attr
    nails.data.materials.append(nail_material())
    log('unhas:', len(nails.data.vertices), 'vertices')

    # ---------- esqueleto e pesos ----------
    arm_ob = build_armature()
    W = skin_weights(get_co(low.data))
    E = neighbors(low.data)
    W = laplacian(W, E, len(low.data.vertices), iters=2, lam=0.5)
    # Na base do polegar (eminencia tenar e a dobra entre polegar e indicador) a pele estica
    # muito: pesos bem mais suaves ali, para nao vincar quando o polegar cruza a palma
    bi0 = {b: i for i, b in enumerate(A.BONES)}
    thumb_cols = [bi0['thumb_cmc'], bi0['thumb_mcp']]
    mask = W[:, thumb_cols].sum(1) > 0.01
    for _ in range(2):
        grow = mask.copy()
        grow[E[:, 0]] |= mask[E[:, 1]]
        grow[E[:, 1]] |= mask[E[:, 0]]
        mask = grow
    for _ in range(8):
        Ws = laplacian(W, E, len(low.data.vertices), iters=1, lam=0.5)
        W[mask] = Ws[mask]
    assign_weights(low, limit_weights(W), arm_ob)
    bi = {b: i for i, b in enumerate(A.BONES)}
    NW = np.zeros((len(nv), len(A.BONES)))
    for i, o in enumerate(nown):
        NW[i, bi[TIP_BONES[o]]] = 1.0
    assign_weights(nails, NW, arm_ob)
    log('pesos ok')

    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.blend))

    select_only(arm_ob, low, nails, active=arm_ob)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(a.out),
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_vertex_color='ACTIVE',
        export_skins=True,
        export_all_influences=False,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_animations=False,
        export_morph=False,
        export_extras=False,
    )
    log('GLB:', a.out, os.path.getsize(a.out), 'bytes')


main()
