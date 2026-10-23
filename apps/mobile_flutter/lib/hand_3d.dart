import 'package:flutter/material.dart';
import 'package:hand_landmarker/hand_landmarker.dart';

import 'hand_skeleton.dart' show kHandConnections;

/// Renderiza uma mao 3D estilizada dirigida pelos 21 landmarks do MediaPipe.
///
/// Diferente do [HandSkeletonPainter] (linhas finas sobre o preview da camera),
/// aqui NAO ha imagem da camera: a mao detectada vira um avatar volumetrico
/// (juntas como esferas sombreadas, ossos como capsulas afuniladas, palma
/// preenchida) que imita em tempo real a posicao, rotacao e flexao dos dedos.
///
/// Mapeamento:
///  - x,y normalizados [0,1] vao direto pra tela (espelhados no X, camera
///    frontal), entao mover/girar a mao move/gira o avatar fielmente;
///  - z (profundidade relativa ao pulso) modula raio e brilho (mais perto =
///    maior e mais claro) e ordena o desenho (painter's algorithm).
class Hand3DPainter extends CustomPainter {
  Hand3DPainter(this.hands, {this.light = const Offset(-0.5, -0.8)});

  final List<Hand> hands;

  /// Direcao da luz em coords de tela (x: esquerda<-, y: cima<-).
  final Offset light;

  // Extremos de sombreamento do "barro" da mao (tons da marca).
  static const _skinLight = Color(0xFFEDEAFF);
  static const _skinDark = Color(0xFF5546D6);

  // Peso de espessura por landmark (pulso grosso, ponta dos dedos fina).
  static const List<double> _jointWeight = [
    1.55, // 0 wrist
    1.05, 0.95, 0.82, 0.66, // polegar 1-4
    1.10, 0.92, 0.80, 0.64, // indicador 5-8
    1.12, 0.92, 0.80, 0.64, // medio 9-12
    1.08, 0.90, 0.78, 0.62, // anelar 13-16
    1.00, 0.84, 0.74, 0.60, // mindinho 17-20
  ];

  @override
  void paint(Canvas canvas, Size size) {
    for (final hand in hands) {
      final lm = hand.landmarks;
      if (lm.length < 21) continue;
      _paintHand(canvas, size, lm);
    }
  }

  void _paintHand(Canvas canvas, Size size, List<Landmark> lm) {
    // Projecao tela (espelhada no X p/ camera frontal).
    final pts = <Offset>[];
    final zs = <double>[];
    double zMin = double.infinity, zMax = -double.infinity;
    for (final p in lm) {
      pts.add(Offset((1 - p.x) * size.width, p.y * size.height));
      zs.add(p.z);
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
    }
    final zRange = (zMax - zMin).abs() < 1e-6 ? 1.0 : (zMax - zMin);

    // Escala da mao em px (pulso -> base do dedo medio) define o tamanho geral.
    final handScale = (pts[0] - pts[9]).distance.clamp(1.0, size.longestSide);
    final baseR = handScale * 0.16;

    // 0 = perto (z minimo) .. 1 = longe (z maximo).
    double depth01(int i) => ((zs[i] - zMin) / zRange).clamp(0.0, 1.0);
    // Raio do landmark: peso * base, aumentado quando esta mais perto.
    double radius(int i) =>
        baseR * _jointWeight[i] * (1.18 - 0.36 * depth01(i));

    final lightDir = light.distance == 0 ? const Offset(-0.5, -0.8) : light / light.distance;

    // Monta primitivas (ossos + juntas) com profundidade representativa,
    // ordena de tras pra frente e desenha.
    final prims = <_Prim>[];

    // Palma preenchida (da corpo a mao). Pulso + bases dos 4 dedos longos.
    final palmIdx = [0, 5, 9, 13, 17];
    final palmZ = palmIdx.map(depth01).reduce((a, b) => a + b) / palmIdx.length;
    prims.add(_Prim.palm(palmIdx, palmZ));

    for (final c in kHandConnections) {
      final a = c[0], b = c[1];
      prims.add(_Prim.bone(a, b, (depth01(a) + depth01(b)) / 2));
    }
    for (var i = 0; i < pts.length; i++) {
      prims.add(_Prim.joint(i, depth01(i)));
    }

    prims.sort((x, y) => y.z.compareTo(x.z)); // longe primeiro

    for (final pr in prims) {
      switch (pr.kind) {
        case _Kind.palm:
          _drawPalm(canvas, pr.idx!, pts, pr.z);
          break;
        case _Kind.bone:
          _drawBone(canvas, pts[pr.a!], pts[pr.b!], radius(pr.a!), radius(pr.b!),
              pr.z, lightDir);
          break;
        case _Kind.joint:
          _drawJoint(canvas, pts[pr.a!], radius(pr.a!), pr.z, lightDir);
          break;
      }
    }
  }

  // Cor base sombreada pela profundidade (perto mais claro, longe mais escuro).
  Color _shade(double z) =>
      Color.lerp(_skinLight, _skinDark, 0.15 + 0.7 * z)!;

  void _drawPalm(Canvas canvas, List<int> idx, List<Offset> pts, double z) {
    final path = Path()..moveTo(pts[idx[0]].dx, pts[idx[0]].dy);
    for (var i = 1; i < idx.length; i++) {
      path.lineTo(pts[idx[i]].dx, pts[idx[i]].dy);
    }
    path.close();
    final paint = Paint()
      ..style = PaintingStyle.fill
      ..color = _shade(z).withAlpha(235)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 1.5);
    canvas.drawPath(path, paint);
  }

  void _drawBone(Canvas canvas, Offset c0, Offset c1, double r0, double r1,
      double z, Offset lightDir) {
    final d = c1 - c0;
    final len = d.distance;
    if (len < 0.5) return;
    final u = d / len;
    final n = Offset(-u.dy, u.dx); // perpendicular

    // Capsula afunilada: hull de dois circulos.
    final p0a = c0 + n * r0, p0b = c0 - n * r0;
    final p1a = c1 + n * r1, p1b = c1 - n * r1;
    final path = Path()
      ..moveTo(p0a.dx, p0a.dy)
      ..lineTo(p1a.dx, p1a.dy)
      ..lineTo(p1b.dx, p1b.dy)
      ..lineTo(p0b.dx, p0b.dy)
      ..close();

    // Sombreado de cilindro: lado virado pra luz claro, oposto escuro.
    final lit = (n.dx * lightDir.dx + n.dy * lightDir.dy); // -1..1
    final base = _shade(z);
    final mid = (c0 + c1) / 2;
    final hi = Color.lerp(base, _skinLight, 0.55)!;
    final lo = Color.lerp(base, _skinDark, 0.55)!;
    final gradStart = lit >= 0 ? mid + n * r1 : mid - n * r1;
    final gradEnd = lit >= 0 ? mid - n * r1 : mid + n * r1;
    final paint = Paint()
      ..style = PaintingStyle.fill
      ..shader = LinearGradient(
        colors: [hi, base, lo],
        stops: const [0.0, 0.5, 1.0],
      ).createShader(Rect.fromPoints(gradStart, gradEnd));
    canvas.drawPath(path, paint);
  }

  void _drawJoint(Canvas canvas, Offset c, double r, double z, Offset lightDir) {
    final base = _shade(z);
    // Highlight deslocado na direcao da luz -> aparencia de esfera.
    final hl = c - lightDir * (r * 0.45);
    final paint = Paint()
      ..shader = RadialGradient(
        center: Alignment(
          (hl.dx - c.dx) / r,
          (hl.dy - c.dy) / r,
        ),
        radius: 1.05,
        colors: [
          Color.lerp(base, _skinLight, 0.85)!,
          base,
          Color.lerp(base, _skinDark, 0.5)!,
        ],
        stops: const [0.0, 0.55, 1.0],
      ).createShader(Rect.fromCircle(center: c, radius: r));
    canvas.drawCircle(c, r, paint);
  }

  @override
  bool shouldRepaint(covariant Hand3DPainter old) => old.hands != hands;
}

enum _Kind { palm, bone, joint }

/// Primitiva desenhavel com profundidade representativa para ordenacao.
class _Prim {
  _Prim._(this.kind, this.z, {this.a, this.b, this.idx});
  final _Kind kind;
  final double z;
  final int? a;
  final int? b;
  final List<int>? idx;

  factory _Prim.palm(List<int> idx, double z) =>
      _Prim._(_Kind.palm, z, idx: idx);
  factory _Prim.bone(int a, int b, double z) => _Prim._(_Kind.bone, z, a: a, b: b);
  factory _Prim.joint(int a, double z) => _Prim._(_Kind.joint, z, a: a);
}
