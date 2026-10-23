import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../exercise.dart';
import '../../ui/app_theme.dart';

/// Exercicio receptivo `watch_choose_word` (SPEC 03 secao 11.3):
/// ve o video do sinal e escolhe a glosa. Sem punicao por erro (SPEC 02 secao 5.3):
/// ao errar, revela a opcao certa e marca a escolhida; ao acertar, marca a certa.
/// A logica de avanco (auto apos acerto / aguardar apos erro) fica no container
/// da licao, que reage ao [onAnswered].
class WatchChooseWordView extends StatefulWidget {
  const WatchChooseWordView({
    super.key,
    required this.exercise,
    required this.onAnswered,
  });

  final WatchChooseWord exercise;
  final ValueChanged<bool> onAnswered;

  @override
  State<WatchChooseWordView> createState() => _WatchChooseWordViewState();
}

class _WatchChooseWordViewState extends State<WatchChooseWordView> {
  String? _selected;

  bool get _answered => _selected != null;

  void _choose(String option) {
    if (_answered) return;
    HapticFeedback.selectionClick();
    setState(() => _selected = option);
    final correct = option == widget.exercise.correct;
    correct
        ? HapticFeedback.heavyImpact()
        : HapticFeedback.mediumImpact();
    widget.onAnswered(correct);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final ex = widget.exercise;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: Gap.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // -- Instrucao --
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.screenH),
            child: Text(
              'Qual e este sinal?',
              style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: Gap.md),

          // -- Placeholder do player de video --
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.screenH),
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF1A1A2E),
                  borderRadius: Radii.cardAll,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        color: Colors.white.withAlpha(26),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.play_arrow_rounded,
                        size: 36,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: Gap.sm),
                    Text(
                      'Toque para assistir',
                      style: text.bodySmall
                          ?.copyWith(color: Colors.white.withAlpha(153)),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: Gap.lg),

          // -- Opcoes de resposta --
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.screenH),
            child: Column(
              children: ex.options
                  .map((option) => Padding(
                        padding: const EdgeInsets.only(bottom: Gap.sm),
                        child: _OptionTile(
                          label: option,
                          state: _stateFor(option),
                          onTap: () => _choose(option),
                        ),
                      ))
                  .toList(),
            ),
          ),

          const SizedBox(height: Gap.md),
        ],
      ),
    );
  }

  _OptionState _stateFor(String option) {
    if (!_answered) return _OptionState.idle;
    if (option == widget.exercise.correct) return _OptionState.correct;
    if (option == _selected) return _OptionState.wrong;
    return _OptionState.dimmed;
  }
}

enum _OptionState { idle, correct, wrong, dimmed }

class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.label,
    required this.state,
    required this.onTap,
  });

  final String label;
  final _OptionState state;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    final (Color bg, Color border, Widget? trailing) = switch (state) {
      _OptionState.correct => (
          LibraxColors.successSoft,
          LibraxColors.success,
          const Icon(Icons.check_circle_rounded,
              color: LibraxColors.success, size: 22),
        ),
      _OptionState.wrong => (
          LibraxColors.errorSoft,
          LibraxColors.error,
          const Icon(Icons.cancel_rounded,
              color: LibraxColors.error, size: 22),
        ),
      _OptionState.dimmed => (
          LibraxColors.surface,
          LibraxColors.line,
          null,
        ),
      _OptionState.idle => (
          LibraxColors.card,
          LibraxColors.line,
          null,
        ),
    };

    final labelColor = switch (state) {
      _OptionState.correct => LibraxColors.successDark,
      _OptionState.wrong   => LibraxColors.errorDark,
      _OptionState.dimmed  => LibraxColors.muted,
      _OptionState.idle    => LibraxColors.ink,
    };

    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: bg,
        borderRadius: Radii.cardAll,
        child: InkWell(
          onTap: state == _OptionState.idle ? onTap : null,
          borderRadius: Radii.cardAll,
          child: Container(
            padding: const EdgeInsets.symmetric(
                horizontal: Gap.md, vertical: Gap.md),
            decoration: BoxDecoration(
              border: Border.all(color: border, width: 2),
              borderRadius: Radii.cardAll,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: text.bodyLarge?.copyWith(
                      color: labelColor,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (trailing != null) ...[
                  const SizedBox(width: Gap.sm),
                  trailing,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
