import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../ui/app_theme.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Librax',
          style: text.titleLarge?.copyWith(
            color: LibraxColors.brand,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.5,
          ),
        ),
        actions: const [
          _StreakBadge(value: 0),
          SizedBox(width: Gap.md),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(
          horizontal: Gap.screenH,
          vertical: Gap.lg,
        ),
        children: const [
          _DailyGoalCard(),
          SizedBox(height: Gap.md),
          _ContinueLessonCard(),
          SizedBox(height: Gap.md),
          _QuickStatsRow(),
        ],
      ),
    );
  }
}

// -- Streak counter no AppBar --

class _StreakBadge extends StatelessWidget {
  const _StreakBadge({required this.value});

  final int value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.local_fire_department_rounded,
            color: LibraxColors.streak, size: 22),
        const SizedBox(width: Gap.xs),
        Text(
          '$value',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: LibraxColors.streak,
                fontWeight: FontWeight.w800,
              ),
        ),
      ],
    );
  }
}

// -- Card de meta diaria --

class _DailyGoalCard extends StatelessWidget {
  const _DailyGoalCard();

  static const int _current = 0;
  static const int _goal = 10;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    const progress = _current / _goal;

    return Container(
      padding: const EdgeInsets.all(Gap.md),
      decoration: BoxDecoration(
        color: LibraxColors.card,
        borderRadius: Radii.cardAll,
        border: Border.all(color: LibraxColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.military_tech_rounded,
                  color: LibraxColors.xp, size: 20),
              const SizedBox(width: Gap.xs),
              Text('Meta diaria',
                  style: text.titleSmall?.copyWith(color: LibraxColors.ink)),
              const Spacer(),
              Text(
                '$_current / $_goal XP',
                style: text.labelMedium?.copyWith(color: LibraxColors.muted),
              ),
            ],
          ),
          const SizedBox(height: Gap.sm),
          ClipRRect(
            borderRadius: BorderRadius.circular(Radii.sm),
            child: const LinearProgressIndicator(
              value: progress,
              minHeight: 10,
              color: LibraxColors.xp,
              backgroundColor: LibraxColors.line,
            ),
          ),
        ],
      ),
    );
  }
}

// -- Card de continuar licao --

class _ContinueLessonCard extends StatelessWidget {
  const _ContinueLessonCard();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(Gap.md),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF6C5CE7), Color(0xFF5546D6)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: Radii.cardAll,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Unidade 1 - Alfabeto',
                  style: text.labelMedium?.copyWith(
                    color: Colors.white.withAlpha(204),
                  ),
                ),
                const SizedBox(height: Gap.xs),
                Text(
                  'Comece a aprender Libras',
                  style: text.titleMedium?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: Gap.xs),
                Text(
                  'Licao 1 de 4 disponivel',
                  style: text.bodySmall?.copyWith(
                    color: Colors.white.withAlpha(179),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: Gap.md),
          FilledButton(
            onPressed: () => context.go('/learn'),
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: LibraxColors.brand,
              minimumSize: const Size(96, 44),
              padding: const EdgeInsets.symmetric(
                  horizontal: Gap.md, vertical: Gap.sm),
              shape: RoundedRectangleBorder(borderRadius: Radii.pillAll),
            ),
            child: Text(
              'Comecar',
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(color: LibraxColors.brand, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

// -- Linha de estatisticas rapidas --

class _QuickStatsRow extends StatelessWidget {
  const _QuickStatsRow();

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        Expanded(
          child: _StatCard(
            icon: Icons.local_fire_department_rounded,
            iconColor: LibraxColors.streak,
            value: '0',
            label: 'Dias seguidos',
          ),
        ),
        SizedBox(width: Gap.sm),
        Expanded(
          child: _StatCard(
            icon: Icons.military_tech_rounded,
            iconColor: LibraxColors.xp,
            value: '0',
            label: 'XP total',
          ),
        ),
        SizedBox(width: Gap.sm),
        Expanded(
          child: _StatCard(
            icon: Icons.school_rounded,
            iconColor: LibraxColors.brand,
            value: '0',
            label: 'Licoes',
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.iconColor,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final Color iconColor;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
          vertical: Gap.md, horizontal: Gap.sm),
      decoration: BoxDecoration(
        color: LibraxColors.card,
        borderRadius: Radii.cardAll,
        border: Border.all(color: LibraxColors.line),
      ),
      child: Column(
        children: [
          Icon(icon, color: iconColor, size: 24),
          const SizedBox(height: Gap.xs),
          Text(
            value,
            style: text.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          Text(
            label,
            style: text.bodySmall?.copyWith(color: LibraxColors.muted),
            textAlign: TextAlign.center,
            maxLines: 2,
          ),
        ],
      ),
    );
  }
}
