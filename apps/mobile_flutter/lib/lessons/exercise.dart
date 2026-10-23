import 'package:flutter/foundation.dart';

/// Exercicios da licao (SPEC 03 secao 3). Cada tipo sabe avaliar a propria
/// resposta. Comeca pelos receptivos (sem camera); os expressivos
/// (perform_sign, fingerspell) entram com a camada de reconhecimento.
abstract class Exercise {
  /// Avalia a resposta do aluno. O formato de [answer] depende do tipo.
  bool check(Object? answer);
}

/// `watch_choose_word`: ve o video do sinal e escolhe a glosa.
/// payload: { sign_id, options[], correct }. answer = glosa escolhida.
class WatchChooseWord extends Exercise {
  WatchChooseWord({required this.signId, required this.options, required this.correct});

  final String signId;
  final List<String> options;
  final String correct;

  @override
  bool check(Object? answer) => answer == correct;
}

/// `word_choose_video`: le a palavra e escolhe entre videos.
/// payload: { word, video_options[], correct_sign_id }. answer = sign_id escolhido.
class WordChooseVideo extends Exercise {
  WordChooseVideo({required this.word, required this.videoOptions, required this.correctSignId});

  final String word;
  final List<String> videoOptions;
  final String correctSignId;

  @override
  bool check(Object? answer) => answer == correctSignId;
}

/// Par (sinal, glosa) do match_pairs.
class Pair {
  const Pair(this.signId, this.gloss);
  final String signId;
  final String gloss;
}

/// `match_pairs`: parear sinais e glosas.
/// payload: { pairs: [{sign_id, gloss}] }. answer = Map sign_id -> glosa.
class MatchPairs extends Exercise {
  MatchPairs({required this.pairs});

  final List<Pair> pairs;

  @override
  bool check(Object? answer) {
    if (answer is! Map) return false;
    if (answer.length != pairs.length) return false;
    for (final p in pairs) {
      if (answer[p.signId] != p.gloss) return false;
    }
    return true;
  }
}

/// `order_sequence`: ordenar passos de um sinal.
/// payload: { steps[], correct_order[] }. answer = lista ordenada pelo aluno.
class OrderSequence extends Exercise {
  OrderSequence({required this.steps, required this.correctOrder});

  final List<String> steps;
  final List<String> correctOrder;

  @override
  bool check(Object? answer) {
    if (answer is! List) return false;
    return listEquals(answer.cast<String>(), correctOrder);
  }
}
