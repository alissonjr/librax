import 'package:flutter/material.dart';

import '../../ui/app_theme.dart';
import '../lesson.dart';
import '../lesson_session.dart';
import '../widgets/exercise_view.dart';

/// Container do game loop de uma licao (SPEC 03 secao 4; DS secoes 10.1 e 11.3):
/// responde -> banner de feedback -> Continuar -> proximo -> conclusao.
/// Sem vidas: errar nunca encerra a licao (SPEC 02 secao 5.3).
class LessonScreen extends StatefulWidget {
  const LessonScreen({
    super.key,
    required this.lesson,
    required this.onCompleted,
    this.onExit,
  });

  final Lesson lesson;
  final ValueChanged<LessonResult> onCompleted;

  /// Acionado quando o usuario confirma sair no meio. Default: pop da rota.
  final VoidCallback? onExit;

  @override
  State<LessonScreen> createState() => _LessonScreenState();
}

class _LessonScreenState extends State<LessonScreen> {
  late final LessonSession _session = LessonSession(widget.lesson.exercises);
  bool _answered = false;
  bool _lastCorrect = false;

  void _onAnswered(bool correct) {
    if (_answered) return;
    _session.record(correct);
    setState(() {
      _answered = true;
      _lastCorrect = correct;
    });
  }

  void _continue() {
    if (_session.isComplete) {
      widget.onCompleted(LessonResult(correct: _session.correctCount, total: _session.total));
      return;
    }
    setState(() {
      _session.advance();
      _answered = false;
    });
  }

  Future<void> _confirmExit() async {
    final leave = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sair da licao?'),
        content: const Text('Seu progresso desta sessao sera perdido.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: LibraxColors.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sair'),
          ),
        ],
      ),
    );
    if (leave == true) {
      (widget.onExit ?? () => Navigator.of(context).maybePop()).call();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _TopBar(progress: _session.progress, onClose: _confirmExit),
            Expanded(
              child: KeyedSubtree(
                key: ValueKey(_session.index),
                child: exerciseView(_session.current, onAnswered: _onAnswered),
              ),
            ),
            _Footer(
              visible: _answered,
              correct: _lastCorrect,
              correctLabel: correctLabelOf(_session.current),
              isLast: _session.isComplete,
              onContinue: _continue,
            ),
          ],
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.progress, required this.onClose});

  final double progress;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(Gap.sm, Gap.sm, Gap.screenH, Gap.sm),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.close_rounded),
            color: LibraxColors.muted,
            onPressed: onClose,
            tooltip: 'Sair da licao',
          ),
          Expanded(
            child: TweenAnimationBuilder<double>(
              duration: LibraxDuration.normal,
              curve: Curves.easeInOut,
              tween: Tween(begin: 0, end: progress),
              builder: (_, value, __) => ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: LinearProgressIndicator(
                  value: value,
                  minHeight: 12,
                  backgroundColor: LibraxColors.line,
                  valueColor: const AlwaysStoppedAnimation(LibraxColors.success),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({
    required this.visible,
    required this.correct,
    required this.correctLabel,
    required this.isLast,
    required this.onContinue,
  });

  final bool visible;
  final bool correct;
  final String? correctLabel;
  final bool isLast;
  final VoidCallback onContinue;

  // Variacoes de elogio (DS secao 9.2), escolhidas de forma estavel.
  static const _praise = ['Isso ai!', 'Muito bem!', 'Perfeito!', 'Excelente!'];

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return AnimatedSwitcher(
      duration: LibraxDuration.fast,
      transitionBuilder: (child, anim) => SizeTransition(
        sizeFactor: anim,
        alignment: Alignment.topCenter,
        child: FadeTransition(opacity: anim, child: child),
      ),
      child: !visible
          ? const SizedBox(width: double.infinity)
          : Container(
              key: const ValueKey('feedback'),
              width: double.infinity,
              color: correct ? LibraxColors.successSoft : LibraxColors.errorSoft,
              padding: const EdgeInsets.fromLTRB(Gap.screenH, Gap.md, Gap.screenH, Gap.lg),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(
                        correct ? Icons.check_circle_rounded : Icons.cancel_rounded,
                        color: correct ? LibraxColors.success : LibraxColors.error,
                        size: 28,
                      ),
                      const SizedBox(width: Gap.sm),
                      Expanded(
                        child: Text(
                          correct
                              ? _praise[correctLabel.hashCode.abs() % _praise.length]
                              : (correctLabel != null
                                  ? 'A resposta certa e $correctLabel. Vamos continuar!'
                                  : 'Nao foi dessa vez. Vamos continuar!'),
                          style: text.titleMedium?.copyWith(
                            color: correct ? LibraxColors.successDark : LibraxColors.errorDark,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: Gap.md),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: correct ? LibraxColors.success : LibraxColors.brand,
                    ),
                    onPressed: onContinue,
                    child: Text(isLast ? 'Concluir' : 'Continuar'),
                  ),
                ],
              ),
            ),
    );
  }
}
