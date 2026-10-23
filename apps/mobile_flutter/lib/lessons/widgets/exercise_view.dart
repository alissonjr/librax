import 'package:flutter/material.dart';

import '../exercise.dart';
import 'watch_choose_word_view.dart';
import 'word_choose_video_view.dart';
import 'match_pairs_view.dart';
import 'order_sequence_view.dart';

/// Renderiza a view do tipo de exercicio. Todas seguem o mesmo contrato:
/// avaliam internamente e chamam `onAnswered(bool)` uma vez.
Widget exerciseView(Exercise exercise, {Key? key, required ValueChanged<bool> onAnswered}) {
  if (exercise is WatchChooseWord) {
    return WatchChooseWordView(key: key, exercise: exercise, onAnswered: onAnswered);
  }
  if (exercise is WordChooseVideo) {
    return WordChooseVideoView(key: key, exercise: exercise, onAnswered: onAnswered);
  }
  if (exercise is MatchPairs) {
    return MatchPairsView(key: key, exercise: exercise, onAnswered: onAnswered);
  }
  if (exercise is OrderSequence) {
    return OrderSequenceView(key: key, exercise: exercise, onAnswered: onAnswered);
  }
  throw UnimplementedError('exercicio nao suportado: ${exercise.runtimeType}');
}

/// Rotulo da resposta certa para o banner de feedback ("A resposta certa e ...").
/// Exercicios interativos (match/order) so concluem quando corretos, entao nao
/// precisam revelar resposta: retornam null.
String? correctLabelOf(Exercise exercise) {
  if (exercise is WatchChooseWord) return exercise.correct;
  if (exercise is WordChooseVideo) return exercise.correctSignId;
  return null;
}
