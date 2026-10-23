import 'exercise.dart';

/// Uma licao: sequencia de exercicios (SPEC 03 secao 4).
class Lesson {
  const Lesson({required this.id, required this.title, required this.exercises});

  final String id;
  final String title;
  final List<Exercise> exercises;
}

/// Resultado de uma licao concluida, consumido pela tela de conclusao e,
/// no app real, enviado ao backend como `lesson_completed{score}` (SPEC 02).
class LessonResult {
  const LessonResult({required this.correct, required this.total});

  final int correct;
  final int total;

  double get score => total == 0 ? 0 : correct / total;
  int get accuracyPct => (score * 100).round();
}
