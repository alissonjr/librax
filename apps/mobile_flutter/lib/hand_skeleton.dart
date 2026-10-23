import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:hand_landmarker/hand_landmarker.dart';

/// Pares de landmarks que formam o esqueleto da mao do MediaPipe (21 pontos).
///  0 WRIST | 1-4 polegar | 5-8 indicador | 9-12 medio | 13-16 anelar | 17-20 mindinho
const List<List<int>> kHandConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4], // polegar
  [0, 5], [5, 6], [6, 7], [7, 8], // indicador
  [9, 10], [10, 11], [11, 12], // medio
  [13, 14], [14, 15], [15, 16], // anelar
  [0, 17], [17, 18], [18, 19], [19, 20], // mindinho
  [5, 9], [9, 13], [13, 17], // palma
];

/// Desenha o esqueleto sobre o preview da camera.
///
/// Os landmarks vem normalizados [0,1] em relacao a imagem. Mapeamos para o
/// tamanho do canvas e espelhamos no eixo X (camera frontal). Alinhamento fino
/// (rotacao/aspect) e calibracao da etapa seguinte; aqui so confirmamos que os
/// pontos seguem a mao em tempo real (tarefa S1 da SPEC 01).
class HandSkeletonPainter extends CustomPainter {
  HandSkeletonPainter(this.hands);

  final List<Hand> hands;

  @override
  void paint(Canvas canvas, Size size) {
    final linePaint = Paint()
      ..color = const Color(0xFF00E5FF)
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;
    final dotPaint = Paint()..color = const Color(0xFFFF2D95);

    double mapX(double x) => (1 - x) * size.width; // espelhado (frontal)
    double mapY(double y) => y * size.height;

    for (final hand in hands) {
      final lm = hand.landmarks;
      if (lm.length < 21) continue;
      for (final c in kHandConnections) {
        canvas.drawLine(
          Offset(mapX(lm[c[0]].x), mapY(lm[c[0]].y)),
          Offset(mapX(lm[c[1]].x), mapY(lm[c[1]].y)),
          linePaint,
        );
      }
      for (final p in lm) {
        canvas.drawCircle(Offset(mapX(p.x), mapY(p.y)), 5, dotPaint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant HandSkeletonPainter old) => old.hands != hands;
}

/// Normalizacao da SPEC 01 (pronta para o classificador da etapa S4):
/// 1) translada o pulso (landmark 0) para a origem;
/// 2) escala pela distancia pulso -> base do dedo medio (landmark 9).
/// Retorna vetor de 63 doubles (21 x 3), invariante a posicao, distancia e tamanho.
List<double> normalizeHand(List<Landmark> lm) {
  if (lm.length < 21) return const [];
  final wrist = lm[0];
  final mid = lm[9];
  final scale = math.sqrt(
    math.pow(mid.x - wrist.x, 2) +
        math.pow(mid.y - wrist.y, 2) +
        math.pow(mid.z - wrist.z, 2),
  );
  final f = scale == 0 ? 1e6 : 1.0 / scale;
  final out = <double>[];
  for (final p in lm) {
    out
      ..add((p.x - wrist.x) * f)
      ..add((p.y - wrist.y) * f)
      ..add((p.z - wrist.z) * f);
  }
  return out;
}
