import 'package:flutter/material.dart';

import 'lesson.dart';
import 'screens/lesson_complete_screen.dart';
import 'screens/lesson_screen.dart';

/// Orquestra o fluxo de uma licao: toca os exercicios e, ao concluir, mostra a
/// tela de conclusao. Ao tocar Continuar, devolve o [LessonResult] (pop) ou
/// chama [onDone] se fornecido.
/// Autocontido para ser facil de plugar em qualquer rota.
class PlayLesson extends StatefulWidget {
  const PlayLesson({
    super.key,
    required this.lesson,
    this.streakAfter = 1,
    this.onDone,
    this.onExit,
  });

  final Lesson lesson;

  /// Sequencia (dias) a exibir na conclusao. No app real vem do backend
  /// (SPEC 02 secao 5.1) apos `completeLesson`.
  final int streakAfter;

  /// Chamado quando o aluno toca "Continuar" na tela de conclusao.
  /// Se nulo, faz pop do navigator com o [LessonResult].
  final VoidCallback? onDone;

  /// Chamado quando o aluno toca o X no topo da licao.
  /// Se nulo, faz pop sem resultado.
  final VoidCallback? onExit;

  @override
  State<PlayLesson> createState() => _PlayLessonState();
}

class _PlayLessonState extends State<PlayLesson> {
  LessonResult? _result;

  /// XP de exibicao. No app real o servidor calcula (SPEC 02 secao 5.2);
  /// aqui: base 10 + bonus por acerto.
  int get _xp => 10 + 2 * (_result?.correct ?? 0);

  @override
  Widget build(BuildContext context) {
    final result = _result;
    if (result == null) {
      return LessonScreen(
        lesson: widget.lesson,
        onCompleted: (r) => setState(() => _result = r),
        onExit: widget.onExit ?? () => Navigator.of(context).maybePop(),
      );
    }
    return LessonCompleteScreen(
      result: result,
      xp: _xp,
      streak: widget.streakAfter,
      onContinue: widget.onDone ?? () => Navigator.of(context).maybePop(result),
    );
  }
}
