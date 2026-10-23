import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../exercise.dart';
import '../../ui/app_theme.dart';

/// Exercicio receptivo `word_choose_video` (SPEC 03 secao 11.4 / DS 9.3):
/// le a palavra e escolhe, entre 4 videos, qual mostra aquele sinal.
/// Mesmo contrato e tom do `watch_choose_word`: julga ao tocar, revela a opcao
/// certa quando erra e nunca pune (SPEC 02 secao 5.3).
class WordChooseVideoView extends StatefulWidget {
  const WordChooseVideoView({
    super.key,
    required this.exercise,
    required this.onAnswered,
  });

  final WordChooseVideo exercise;
  final ValueChanged<bool> onAnswered;

  @override
  State<WordChooseVideoView> createState() => _WordChooseVideoViewState();
}

class _WordChooseVideoViewState extends State<WordChooseVideoView> {
  String? _selected;

  bool get _answered => _selected != null;

  void _choose(String signId) {
    if (_answered) return;
    HapticFeedback.selectionClick();
    setState(() => _selected = signId);
    final correct = signId == widget.exercise.correctSignId;
    correct ? HapticFeedback.mediumImpact() : HapticFeedback.heavyImpact();
    widget.onAnswered(correct);
  }

  _OptionState _stateFor(String signId) {
    if (!_answered) return _OptionState.idle;
    if (signId == widget.exercise.correctSignId) return _OptionState.correct;
    if (signId == _selected) return _OptionState.wrong;
    return _OptionState.dimmed;
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
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.screenH),
            child: Text(
              'Qual video mostra o sinal de ${ex.word}?',
              style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: Gap.lg),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.screenH),
            child: GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: Gap.base,
              crossAxisSpacing: Gap.base,
              childAspectRatio: 0.92,
              children: ex.videoOptions
                  .map((signId) => _VideoOption(
                        signId: signId,
                        state: _stateFor(signId),
                        onTap: () => _choose(signId),
                      ))
                  .toList(),
            ),
          ),
          const SizedBox(height: Gap.md),
        ],
      ),
    );
  }
}

enum _OptionState { idle, correct, wrong, dimmed }

class _VideoOption extends StatelessWidget {
  const _VideoOption({required this.signId, required this.state, required this.onTap});

  final String signId;
  final _OptionState state;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (Color border, Widget? badge) = switch (state) {
      _OptionState.correct => (
          LibraxColors.success,
          const Icon(Icons.check_circle_rounded, color: LibraxColors.success, size: 26),
        ),
      _OptionState.wrong => (
          LibraxColors.error,
          const Icon(Icons.cancel_rounded, color: LibraxColors.error, size: 26),
        ),
      _OptionState.dimmed => (LibraxColors.line, null),
      _OptionState.idle => (LibraxColors.line, null),
    };
    final dimmed = state == _OptionState.dimmed;

    return Semantics(
      button: true,
      label: signId,
      child: Material(
        color: LibraxColors.card,
        borderRadius: Radii.cardAll,
        child: InkWell(
          onTap: state == _OptionState.idle ? onTap : null,
          borderRadius: Radii.cardAll,
          child: Opacity(
            opacity: dimmed ? 0.5 : 1,
            child: Container(
              decoration: BoxDecoration(
                border: Border.all(color: border, width: 2),
                borderRadius: Radii.cardAll,
              ),
              child: Stack(
                children: [
                  // Area de "video" (placeholder ate haver o player real)
                  Center(
                    child: Container(
                      width: 52,
                      height: 52,
                      decoration: const BoxDecoration(
                        color: Color(0xFF1A1A2E),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 30),
                    ),
                  ),
                  if (badge != null)
                    Positioned(top: Gap.sm, right: Gap.sm, child: badge),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
