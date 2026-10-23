import '../lessons/exercise.dart';
import '../lessons/lesson.dart';

/// Conteudo estatico das licoes para o MVP / demo.
/// Em producao isso vira do backend (S3/CDN) via spec-03.
class LessonContent {
  LessonContent._();

  /// Retorna a [Lesson] de [unitId] licao [lessonIndex].
  /// Retorna null se nao houver conteudo definido.
  static Lesson? getLesson(int unitId, int lessonIndex) {
    final unit = _units[unitId];
    return unit?[lessonIndex];
  }

  static final Map<int, Map<int, Lesson>> _units = {
    // -- Unidade 1: Alfabeto --
    1: {
      0: Lesson(
        id: 'u1-l1-abcd',
        title: 'A, B, C, D',
        exercises: [
          WatchChooseWord(signId: 'letra-A', options: ['A', 'B', 'C', 'D'], correct: 'A'),
          WatchChooseWord(signId: 'letra-B', options: ['A', 'B', 'C', 'D'], correct: 'B'),
          WatchChooseWord(signId: 'letra-C', options: ['A', 'B', 'C', 'D'], correct: 'C'),
          WordChooseVideo(word: 'D', videoOptions: ['A', 'B', 'C', 'D'], correctSignId: 'D'),
          WatchChooseWord(signId: 'letra-A', options: ['A', 'B', 'C', 'D'], correct: 'A'),
          WordChooseVideo(word: 'B', videoOptions: ['A', 'B', 'C', 'D'], correctSignId: 'B'),
          WatchChooseWord(signId: 'letra-D', options: ['A', 'B', 'C', 'D'], correct: 'D'),
          MatchPairs(pairs: const [Pair('letra-A', 'A'), Pair('letra-B', 'B'), Pair('letra-C', 'C')]),
          OrderSequence(steps: const ['C', 'A', 'B'], correctOrder: const ['A', 'B', 'C']),
        ],
      ),
      1: Lesson(
        id: 'u1-l2-efgh',
        title: 'E, F, G, H',
        exercises: [
          WatchChooseWord(signId: 'letra-E', options: ['E', 'F', 'G', 'H'], correct: 'E'),
          WatchChooseWord(signId: 'letra-F', options: ['E', 'F', 'G', 'H'], correct: 'F'),
          WordChooseVideo(word: 'G', videoOptions: ['E', 'F', 'G', 'H'], correctSignId: 'G'),
          WatchChooseWord(signId: 'letra-H', options: ['E', 'F', 'G', 'H'], correct: 'H'),
          WordChooseVideo(word: 'E', videoOptions: ['E', 'F', 'G', 'H'], correctSignId: 'E'),
        ],
      ),
      2: Lesson(
        id: 'u1-l3-ijkl',
        title: 'I, J, K, L',
        exercises: [
          WatchChooseWord(signId: 'letra-I', options: ['I', 'J', 'K', 'L'], correct: 'I'),
          WatchChooseWord(signId: 'letra-J', options: ['I', 'J', 'K', 'L'], correct: 'J'),
          WordChooseVideo(word: 'K', videoOptions: ['I', 'J', 'K', 'L'], correctSignId: 'K'),
          WatchChooseWord(signId: 'letra-L', options: ['I', 'J', 'K', 'L'], correct: 'L'),
        ],
      ),
      3: Lesson(
        id: 'u1-l4-revisao',
        title: 'Revisao - Parte 1',
        exercises: [
          WatchChooseWord(signId: 'letra-A', options: ['A', 'E', 'I', 'O'], correct: 'A'),
          WatchChooseWord(signId: 'letra-B', options: ['B', 'C', 'D', 'F'], correct: 'B'),
          WordChooseVideo(word: 'C', videoOptions: ['A', 'B', 'C', 'D'], correctSignId: 'C'),
          WatchChooseWord(signId: 'letra-H', options: ['E', 'F', 'G', 'H'], correct: 'H'),
          WordChooseVideo(word: 'L', videoOptions: ['I', 'J', 'K', 'L'], correctSignId: 'L'),
        ],
      ),
    },
    // -- Unidade 2: Numeros --
    2: {
      0: Lesson(
        id: 'u2-l1-0a10',
        title: '0 a 10',
        exercises: [
          WatchChooseWord(signId: 'numero-0', options: ['0', '1', '2', '3'], correct: '0'),
          WatchChooseWord(signId: 'numero-1', options: ['0', '1', '2', '3'], correct: '1'),
          WordChooseVideo(word: '2', videoOptions: ['0', '1', '2', '3'], correctSignId: '2'),
          WatchChooseWord(signId: 'numero-5', options: ['4', '5', '6', '7'], correct: '5'),
          WatchChooseWord(signId: 'numero-10', options: ['8', '9', '10', '11'], correct: '10'),
        ],
      ),
      1: Lesson(
        id: 'u2-l2-11a100',
        title: '11 a 100',
        exercises: [
          WatchChooseWord(signId: 'numero-11', options: ['11', '12', '13', '14'], correct: '11'),
          WatchChooseWord(signId: 'numero-20', options: ['20', '30', '40', '50'], correct: '20'),
          WordChooseVideo(word: '100', videoOptions: ['50', '60', '80', '100'], correctSignId: '100'),
        ],
      ),
    },
  };
}
