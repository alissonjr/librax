import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../exercise.dart';
import '../../ui/app_theme.dart';

/// Exercicio receptivo `match_pairs` (SPEC 03 secao 11.5 / DS 9.3):
/// relaciona cada sinal (esquerda) com seu significado (direita).
/// Toca um sinal, depois a glosa: par certo trava em verde; par errado apenas
/// libera para tentar de novo (sem punir). Conclui quando todos parearem.
class MatchPairsView extends StatefulWidget {
  const MatchPairsView({
    super.key,
    required this.exercise,
    required this.onAnswered,
  });

  final MatchPairs exercise;
  final ValueChanged<bool> onAnswered;

  @override
  State<MatchPairsView> createState() => _MatchPairsViewState();
}

class _MatchPairsViewState extends State<MatchPairsView> {
  String? _selectedSign;
  final Set<String> _matchedSigns = {};
  final Set<String> _matchedGlosses = {};
  String? _wrongGloss; // glosa marcada de vermelho momentaneamente

  List<Pair> get _pairs => widget.exercise.pairs;

  void _tapSign(String signId) {
    if (_matchedSigns.contains(signId)) return;
    HapticFeedback.selectionClick();
    setState(() {
      _selectedSign = signId;
      _wrongGloss = null;
    });
  }

  void _tapGloss(String gloss) {
    if (_matchedGlosses.contains(gloss)) return;
    final sign = _selectedSign;
    if (sign == null) return;

    final pair = _pairs.firstWhere((p) => p.signId == sign);
    if (pair.gloss == gloss) {
      HapticFeedback.mediumImpact();
      setState(() {
        _matchedSigns.add(sign);
        _matchedGlosses.add(gloss);
        _selectedSign = null;
        _wrongGloss = null;
      });
      if (_matchedSigns.length == _pairs.length) widget.onAnswered(true);
    } else {
      HapticFeedback.heavyImpact();
      setState(() {
        _wrongGloss = gloss;
        _selectedSign = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: Gap.md, horizontal: Gap.screenH),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Relacione os sinais com os significados.',
            style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Gap.lg),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Coluna de sinais (videos)
              Expanded(
                child: Column(
                  children: _pairs
                      .map((p) => Padding(
                            padding: const EdgeInsets.only(bottom: Gap.base),
                            child: _SignTile(
                              signId: p.signId,
                              matched: _matchedSigns.contains(p.signId),
                              selected: _selectedSign == p.signId,
                              onTap: () => _tapSign(p.signId),
                            ),
                          ))
                      .toList(),
                ),
              ),
              const SizedBox(width: Gap.base),
              // Coluna de glosas
              Expanded(
                child: Column(
                  children: _pairs
                      .map((p) => Padding(
                            padding: const EdgeInsets.only(bottom: Gap.base),
                            child: _GlossTile(
                              gloss: p.gloss,
                              matched: _matchedGlosses.contains(p.gloss),
                              wrong: _wrongGloss == p.gloss,
                              onTap: () => _tapGloss(p.gloss),
                            ),
                          ))
                      .toList(),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SignTile extends StatelessWidget {
  const _SignTile({
    required this.signId,
    required this.matched,
    required this.selected,
    required this.onTap,
  });

  final String signId;
  final bool matched;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color border = matched
        ? LibraxColors.success
        : selected
            ? LibraxColors.brand
            : LibraxColors.line;

    return Semantics(
      button: true,
      label: signId,
      child: Material(
        color: matched ? LibraxColors.successSoft : LibraxColors.card,
        borderRadius: Radii.cardAll,
        child: InkWell(
          onTap: matched ? null : onTap,
          borderRadius: Radii.cardAll,
          child: Container(
            height: 72,
            decoration: BoxDecoration(
              border: Border.all(color: border, width: 2),
              borderRadius: Radii.cardAll,
            ),
            child: Center(
              child: matched
                  ? const Icon(Icons.check_circle_rounded, color: LibraxColors.success, size: 26)
                  : Container(
                      width: 44,
                      height: 44,
                      decoration: const BoxDecoration(color: Color(0xFF1A1A2E), shape: BoxShape.circle),
                      child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 26),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _GlossTile extends StatelessWidget {
  const _GlossTile({
    required this.gloss,
    required this.matched,
    required this.wrong,
    required this.onTap,
  });

  final String gloss;
  final bool matched;
  final bool wrong;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final Color border = matched
        ? LibraxColors.success
        : wrong
            ? LibraxColors.error
            : LibraxColors.line;
    final Color bg = matched
        ? LibraxColors.successSoft
        : wrong
            ? LibraxColors.errorSoft
            : LibraxColors.card;

    return Material(
      color: bg,
      borderRadius: Radii.cardAll,
      child: InkWell(
        onTap: matched ? null : onTap,
        borderRadius: Radii.cardAll,
        child: Container(
          height: 72,
          padding: const EdgeInsets.symmetric(horizontal: Gap.base),
          decoration: BoxDecoration(
            border: Border.all(color: border, width: 2),
            borderRadius: Radii.cardAll,
          ),
          child: Center(
            child: Text(
              gloss,
              textAlign: TextAlign.center,
              style: text.bodyLarge?.copyWith(
                fontWeight: FontWeight.w600,
                color: matched ? LibraxColors.successDark : LibraxColors.ink,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
