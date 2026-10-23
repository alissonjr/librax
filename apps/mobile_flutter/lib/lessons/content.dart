import 'exercise.dart';
import 'lesson.dart';

/// Conteudo de amostra do Curso A1 "Libras do Zero" (SPEC 03 secao 2).
/// So exercicios receptivos por enquanto (sem camera); os expressivos entram
/// com a camada de reconhecimento da SPEC 01.
///
/// No app real isto vem do bundle JSON versionado em S3/CloudFront (SPEC 02
/// secao 4); aqui e hard-coded para tornar a experiencia jogavel ponta a ponta.

final Lesson vogaisLesson = Lesson(
  id: 'u1-l1',
  title: 'Vogais',
  exercises: [
    WatchChooseWord(
      signId: 'letra-A',
      options: ['A', 'E', 'O', 'U'],
      correct: 'A',
    ),
    WordChooseVideo(
      word: 'E',
      videoOptions: ['letra-A', 'letra-E', 'letra-I', 'letra-O'],
      correctSignId: 'letra-E',
    ),
    MatchPairs(
      pairs: const [
        Pair('letra-A', 'A'),
        Pair('letra-I', 'I'),
        Pair('letra-U', 'U'),
      ],
    ),
    OrderSequence(
      steps: ['I', 'A', 'E'],
      correctOrder: ['A', 'E', 'I'],
    ),
    WatchChooseWord(
      signId: 'letra-O',
      options: ['A', 'E', 'I', 'O'],
      correct: 'O',
    ),
  ],
);

/// Licoes disponiveis na demo jogavel.
final List<Lesson> demoLessons = [vogaisLesson];
