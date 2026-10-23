import 'exercise.dart';

/// Estado de uma sessao de licao (SPEC 03 secao 4).
/// Caminha pelos exercicios, registra acertos e calcula score.
/// Sem vidas (decisao SPEC 02 secao 5.3): errar nao encerra a licao.
class LessonSession {
  LessonSession(this.exercises)
      : assert(exercises.isNotEmpty),
        _results = List<bool?>.filled(exercises.length, null);

  final List<Exercise> exercises;
  final List<bool?> _results;
  int _index = 0;

  int get index => _index;
  int get total => exercises.length;
  Exercise get current => exercises[_index];

  bool get answeredCurrent => _results[_index] != null;
  bool get isComplete => _results.every((r) => r != null);
  bool get isLast => _index == total - 1;

  /// Fracao de exercicios ja respondidos (0..1), para a barra de progresso.
  double get progress => _results.where((r) => r != null).length / total;

  int get correctCount => _results.where((r) => r == true).length;

  /// Score da licao (0..1): acertos sobre o total. Vira `bestScore` no backend.
  double get score => correctCount / total;

  /// Registra a resposta do exercicio atual e devolve se acertou.
  /// Nao avanca sozinho: a UI decide quando chamar [advance].
  bool submit(Object? answer) {
    final correct = current.check(answer);
    _results[_index] = correct;
    return correct;
  }

  /// Registra diretamente o resultado quando a propria view ja avaliou a
  /// resposta (views receptivas chamam `onAnswered(bool)`). Idempotente por
  /// exercicio: a UI so chama uma vez por exercicio.
  void record(bool correct) {
    _results[_index] = correct;
  }

  /// Avanca para o proximo exercicio, se houver.
  void advance() {
    if (!isLast) _index++;
  }
}
