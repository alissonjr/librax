import 'package:flutter/material.dart';

import '../../ui/app_theme.dart';
import '../lesson.dart';

/// Tela de conclusao de licao (SPEC 03 secao 11.10; DS secao 10.5).
/// Celebratoria: gradiente verde, check animado, grade de stats (XP, precisao,
/// sequencia) e botao Continuar. XP sobe com contagem animada.
class LessonCompleteScreen extends StatelessWidget {
  const LessonCompleteScreen({
    super.key,
    required this.result,
    required this.xp,
    required this.streak,
    required this.onContinue,
  });

  final LessonResult result;
  final int xp;
  final int streak;
  final VoidCallback onContinue;

  // Gradiente de celebracao (DS secao 2.4).
  static const _gradient = LinearGradient(
    colors: [Color(0xFF10B981), Color(0xFF059669)],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: _gradient),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.xxl, Gap.xl, Gap.lg),
            child: Column(
              children: [
                const Spacer(),
                // Check animado (escala com leve overshoot)
                TweenAnimationBuilder<double>(
                  duration: LibraxDuration.slow,
                  curve: Curves.elasticOut,
                  tween: Tween(begin: 0, end: 1),
                  builder: (_, scale, child) => Transform.scale(scale: scale, child: child),
                  child: Container(
                    width: 112,
                    height: 112,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.18),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.check_rounded, color: Colors.white, size: 64),
                  ),
                ),
                const SizedBox(height: Gap.xl),
                Text(
                  'Licao concluida!',
                  style: text.headlineMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w800),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: Gap.xxl),
                Row(
                  children: [
                    Expanded(child: _XpStat(xp: xp)),
                    const SizedBox(width: Gap.base),
                    Expanded(child: _Stat(value: '${result.accuracyPct}%', label: 'Precisao')),
                    const SizedBox(width: Gap.base),
                    Expanded(child: _Stat(value: '$streak', label: 'Dias')),
                  ],
                ),
                const Spacer(),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: const Color(0xFF059669),
                    ),
                    onPressed: onContinue,
                    child: const Text('Continuar'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Card de XP com contagem animada de 0 ate [xp].
class _XpStat extends StatelessWidget {
  const _XpStat({required this.xp});
  final int xp;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return _StatCard(
      child: Column(
        children: [
          TweenAnimationBuilder<int>(
            duration: LibraxDuration.slow,
            tween: IntTween(begin: 0, end: xp),
            builder: (_, value, __) => Text(
              '+$value XP',
              style: text.titleLarge?.copyWith(color: Colors.white, fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(height: 2),
          Text('Ganho', style: text.bodySmall?.copyWith(color: Colors.white.withValues(alpha: 0.85))),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return _StatCard(
      child: Column(
        children: [
          Text(value, style: text.titleLarge?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(label, style: text.bodySmall?.copyWith(color: Colors.white.withValues(alpha: 0.85))),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: Gap.md, horizontal: Gap.sm),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: Radii.cardAll,
      ),
      child: child,
    );
  }
}
