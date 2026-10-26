"""
Renderiza a mao 3D do Librax fazendo joinha (punho fechado, polegar para cima), a imagem-mestra do
icone do app (tools/pwa/icone-joinha.png). Em Libras e o "joia/legal" e tambem o numero 1 cardinal
do curso (signs.json, numero-1).

A mao e a mesma do app (apps/web-poc/src/mao3d/mao-3d.glb): este script abre o .blend que o
gerar.py salva com --blend, dobra os ossos no joinha, aplica a pele no tom escolhido (pardo, da
paleta SKIN_TONES do app, token brand.icon.skin) e renderiza no Cycles (2048 px, fundo
transparente). O fundo da marca e os tamanhos de cada icone saem depois, do tools/pwa/build-icons.mjs,
que recorta e reduz o render para a imagem-mestra guardada no repositorio. Em apps/landing:

    blender -b --factory-startup -t 4 --python scripts/mao3d/gerar.py -- --out /tmp/mao/mao.glb --blend /tmp/mao/mao.blend
    blender -b --factory-startup -t 6 --python scripts/mao3d/joinha.py -- --blend /tmp/mao/mao.blend --out /tmp/mao/joinha.png
    cd ../web-poc && npm run pwa-icons -- --mestre /tmp/mao/joinha.png

--rapido renderiza pequeno e com poucas amostras (para ajustar pose e enquadramento). Leva uns 3
minutos com 6 threads na resolucao cheia.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# Tom da pele: pardo, o token brand.icon.skin (o 4o da paleta SKIN_TONES em
# apps/web-poc/src/mao3d/disponivel.ts)
TOKENS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../docs/design-tokens.json')
with open(TOKENS, encoding='utf-8') as _f:
    PELE = json.load(_f)['brand']['icon']['skin']['$value']
# Unha: o mesmo tom, clareado e rosado (como no cena.ts)
UNHA_TINTA = '#F2D4CC'

# Dobra dos dedos (MCP, PIP, DIP), em radianos: punho bem fechado, com as pontas na palma
PUNHO = {
    'index': (1.42, 1.62, 0.95),
    'middle': (1.50, 1.62, 0.95),
    'ring': (1.56, 1.60, 0.95),
    'pinky': (1.62, 1.55, 0.95),
}
# Concha da palma: anelar e minimo fecham um pouco mais (metacarpos)
CONCHA = {'index': 0.0, 'middle': 0.02, 'ring': 0.08, 'pinky': 0.16}
# Dedos juntos (sem o leque da mao aberta)
JUNTA = {'index': -0.07, 'middle': 0.0, 'ring': 0.07, 'pinky': 0.14}


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--blend', required=True, help='.blend salvo pelo gerar.py (--blend)')
    p.add_argument('--out', required=True)
    p.add_argument('--size', type=int, default=2048)
    p.add_argument('--samples', type=int, default=160)
    p.add_argument('--rapido', action='store_true')
    p.add_argument('--yaw', type=float, default=-45, help='giro em volta do eixo vertical (graus)')
    p.add_argument('--pitch', type=float, default=-12, help='inclinacao para quem olha (graus)')
    p.add_argument('--roll', type=float, default=0, help='inclinacao lateral do polegar (graus)')
    p.add_argument('--giro', type=float, default=6, help='giro na tela: positivo inclina o polegar para a direita (graus)')
    p.add_argument('--exposicao', type=float, default=-1.05, help='exposicao do filme (stops)')
    p.add_argument('--polegar', type=float, default=1.25, help='grossura do polegar (estilizacao para o icone)')
    p.add_argument('--salvar', default='', help='salva o .blend posado (inspecao)')
    return p.parse_args(argv)


def hex_linear(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


# --------------------------------------------------------------------------- #
# Pose
# --------------------------------------------------------------------------- #
def aim_bone(arm, name, direction):
    """Gira o osso (no espaco do esqueleto) para apontar na direcao dada, pelo menor giro."""
    pb = arm.pose.bones[name]
    bpy.context.view_layer.update()
    cur = pb.matrix.copy()
    d0 = cur.col[1].xyz.normalized()
    d1 = Vector(direction).normalized()
    q = d0.rotation_difference(d1)
    head = cur.translation.copy()
    rot = cur.to_3x3()
    new = (q.to_matrix() @ rot).to_4x4()
    new.translation = head
    pb.matrix = new
    bpy.context.view_layer.update()


def pose_joinha(arm, grossura):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
    for f, (mcp, pip, dip) in PUNHO.items():
        pb = arm.pose.bones
        # +X local dobra para as costas da mao; a dobra para a palma e negativa
        pb[f + '_meta'].rotation_euler = (-CONCHA[f], 0, 0)
        pb[f + '_mcp'].rotation_euler = (-mcp, 0, JUNTA[f])
        pb[f + '_pip'].rotation_euler = (-pip, 0, 0)
        pb[f + '_dip'].rotation_euler = (-dip, 0, 0)
    # Polegar: o metacarpo vai do pulso para a base do indicador, por fora do punho; a falange
    # aponta para o lado do polegar (para cima no joinha), com a ponta um pouco para tras. Pelo
    # menor giro, sem torcer o dedo: a unha fica virada para o lado do pulso, como na mao de
    # verdade (torcer para mostrar a unha de frente deixa o polegar torcido para a frente)
    aim_bone(arm, 'thumb_cmc', (0.62, -0.20, 0.76))
    aim_bone(arm, 'thumb_mcp', (1.0, -0.10, 0.10))
    arm.pose.bones['thumb_ip'].rotation_euler = (0.38, 0, 0)
    # Um pouco mais grosso que o natural: no icone pequeno o polegar e o que se le
    arm.pose.bones['thumb_mcp'].scale = (grossura, 1.0, grossura)
    bpy.context.view_layer.update()


# --------------------------------------------------------------------------- #
# Materiais
# --------------------------------------------------------------------------- #
def skin_material(mat, tone):
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = tone
    bsdf.inputs['Roughness'].default_value = 0.5
    bsdf.inputs['Specular IOR Level'].default_value = 0.45
    bsdf.inputs['Subsurface Weight'].default_value = 0.15
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)
    bsdf.inputs['Subsurface Scale'].default_value = 0.02
    bsdf.inputs['Sheen Weight'].default_value = 0.15
    bsdf.inputs['Sheen Tint'].default_value = hex_linear('#FF9F87')
    for n in nt.nodes:
        if n.type == 'NORMAL_MAP':
            n.inputs['Strength'].default_value = 0.7


def nail_material(mat, tone):
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    vc = next(n for n in nt.nodes if n.type == 'VERTEX_COLOR')
    tint = [min(1.0, (a * 0.9 + b * 0.1) * 1.1) for a, b in zip(tone[:3], hex_linear(UNHA_TINTA)[:3])]
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(vc.outputs['Color'], mix.inputs['A'])
    mix.inputs['B'].default_value = (*tint, 1.0)
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Coat Weight'].default_value = 0.15


# --------------------------------------------------------------------------- #
# Cena
# --------------------------------------------------------------------------- #
def area_light(name, loc, target, energy, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.size = size
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def world_points(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        pts.extend(mw @ v.co for v in me.vertices)
        ev.to_mesh_clear()
    return pts


def main():
    a = args()
    bpy.ops.wm.open_mainfile(filepath=a.blend)
    sc = bpy.context.scene
    arm = next(o for o in sc.objects if o.type == 'ARMATURE')
    skin = next(o for o in sc.objects if o.type == 'MESH' and o.data.materials and o.data.materials[0].name == 'pele')
    nails = next(o for o in sc.objects if o.type == 'MESH' and o.data.materials and o.data.materials[0].name == 'unha')

    pose_joinha(arm, a.polegar)

    # Mao no mundo: polegar (X da mao) para cima, dedos (Z da mao) para quem olha, costas (Y) para
    # a esquerda; depois o giro de 3/4 e as inclinacoes
    base = Matrix(((0, -1, 0), (0, 0, -1), (1, 0, 0)))
    rot = (Matrix.Rotation(math.radians(a.giro), 3, 'Y') @ Matrix.Rotation(math.radians(a.yaw), 3, 'Z') @ Matrix.Rotation(math.radians(a.pitch), 3, 'X')
           @ Matrix.Rotation(math.radians(a.roll), 3, 'Y') @ base)
    arm.matrix_world = rot.to_4x4()
    bpy.context.view_layer.update()

    tone = hex_linear(PELE)
    skin_material(skin.data.materials[0], tone)
    nail_material(nails.data.materials[0], tone)

    # Centro e tamanho da mao posada
    pts = world_points([skin, nails])
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = (lo + hi) / 2
    radius = max((p - center).length for p in pts)
    arm.location = -center
    bpy.context.view_layer.update()

    # Camera de frente (olhando para +Y), lente longa
    cam_d = bpy.data.cameras.new('camera')
    cam_d.lens = 85
    cam_d.sensor_width = 36
    cam = bpy.data.objects.new('camera', cam_d)
    sc.collection.objects.link(cam)
    half_fov = math.atan(18 / 85)
    dist = radius * 1.08 / math.sin(half_fov)
    cam.location = (0, -dist, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    # Estudio: principal suave do alto a esquerda, preenchimento quente a direita e contorno por tras
    s = radius
    area_light('principal', (-2.6 * s, -3.2 * s, 3.0 * s), (0, 0, 0), 1100 * s * s, 3.0 * s, (1.0, 0.96, 0.92))
    area_light('preenchimento', (3.2 * s, -2.4 * s, 0.4 * s), (0, 0, 0), 170 * s * s, 4.0 * s, (1.0, 0.93, 0.88))
    area_light('contorno', (1.8 * s, 3.0 * s, 2.4 * s), (0, 0, 0), 1300 * s * s, 1.6 * s, (1.0, 0.86, 0.74))
    area_light('contorno2', (1.4 * s, 3.4 * s, -1.0 * s), (0, 0, 0), 900 * s * s, 1.4 * s, (1.0, 0.9, 0.82))
    world = bpy.data.worlds.new('mundo')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.42, 0.36, 0.32, 1)
    bg.inputs['Strength'].default_value = 0.35
    sc.world = world

    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24 if a.rapido else a.samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.film_transparent = True
    size = 512 if a.rapido else a.size
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = a.exposicao
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.image_settings.compression = 90
    sc.render.filepath = a.out
    if a.salvar:
        bpy.ops.wm.save_as_mainfile(filepath=a.salvar)
    bpy.ops.render.render(write_still=True)
    print('joinha:', a.out, size, 'px')


main()
