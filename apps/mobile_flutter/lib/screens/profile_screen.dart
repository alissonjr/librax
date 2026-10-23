import 'package:flutter/material.dart';
import '../ui/app_theme.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Perfil')),
      body: ListView(
        padding: const EdgeInsets.symmetric(
            horizontal: Gap.screenH, vertical: Gap.lg),
        children: const [
          _ProfileHeader(),
          SizedBox(height: Gap.xl),
          _StatsRow(),
          SizedBox(height: Gap.xl),
          _AchievementsSection(),
          SizedBox(height: Gap.xl),
          _StreakSection(),
        ],
      ),
    );
  }
}

// -- Cabecalho com avatar e nome --

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      children: [
        Stack(
          children: [
            const CircleAvatar(
              radius: 48,
              backgroundColor: LibraxColors.brandSoft,
              child: Icon(
                Icons.person_rounded,
                size: 52,
                color: LibraxColors.brand,
              ),
            ),
            Positioned(
              bottom: 0,
              right: 0,
              child: Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: LibraxColors.brand,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                ),
                child: const Icon(Icons.edit_rounded,
                    size: 14, color: Colors.white),
              ),
            ),
          ],
        ),
        const SizedBox(height: Gap.md),
        Text(
          'Aluno',
          style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: Gap.xs),
        Text(
          'Aprendendo Libras',
          style: text.bodyMedium?.copyWith(color: LibraxColors.muted),
        ),
      ],
    );
  }
}

// -- Linha de estatisticas --

class _StatsRow extends StatelessWidget {
  const _StatsRow();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          vertical: Gap.md, horizontal: Gap.sm),
      decoration: BoxDecoration(
        color: LibraxColors.card,
        borderRadius: Radii.cardAll,
        border: Border.all(color: LibraxColors.line),
      ),
      child: const IntrinsicHeight(
        child: Row(
          children: [
            Expanded(
              child: _StatItem(
                icon: Icons.local_fire_department_rounded,
                iconColor: LibraxColors.streak,
                value: '0',
                label: 'Dias seguidos',
              ),
            ),
            VerticalDivider(
                color: LibraxColors.line, thickness: 1, width: 1),
            Expanded(
              child: _StatItem(
                icon: Icons.military_tech_rounded,
                iconColor: LibraxColors.xp,
                value: '0',
                label: 'XP total',
              ),
            ),
            VerticalDivider(
                color: LibraxColors.line, thickness: 1, width: 1),
            Expanded(
              child: _StatItem(
                icon: Icons.school_rounded,
                iconColor: LibraxColors.brand,
                value: '0',
                label: 'Licoes',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({
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
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, color: iconColor, size: 26),
        const SizedBox(height: Gap.xs),
        Text(
          value,
          style:
              text.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        Text(
          label,
          style: text.bodySmall?.copyWith(color: LibraxColors.muted),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

// -- Conquistas --

class _AchievementsSection extends StatelessWidget {
  const _AchievementsSection();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.emoji_events_rounded,
                color: LibraxColors.xp, size: 20),
            const SizedBox(width: Gap.sm),
            Text('Conquistas', style: text.titleMedium),
          ],
        ),
        const SizedBox(height: Gap.md),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(Gap.xl),
          decoration: BoxDecoration(
            color: LibraxColors.card,
            borderRadius: Radii.cardAll,
            border: Border.all(color: LibraxColors.line),
          ),
          child: Column(
            children: [
              const Icon(Icons.emoji_events_outlined,
                  size: 48, color: LibraxColors.locked),
              const SizedBox(height: Gap.sm),
              Text(
                'Suas conquistas aparecerao aqui.',
                style: text.bodyMedium?.copyWith(color: LibraxColors.ink),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: Gap.xs),
              Text(
                'Complete licoes para desbloquear.',
                style: text.bodySmall?.copyWith(color: LibraxColors.muted),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// -- Streak visual --

class _StreakSection extends StatelessWidget {
  const _StreakSection();

  static const int _streak = 0;
  static const List<String> _days = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final today = DateTime.now().weekday - 1; // 0=seg, 6=dom

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.local_fire_department_rounded,
                color: LibraxColors.streak, size: 20),
            const SizedBox(width: Gap.sm),
            Text('Sequencia', style: text.titleMedium),
            const Spacer(),
            Text(
              '$_streak dias',
              style: text.labelMedium?.copyWith(color: LibraxColors.muted),
            ),
          ],
        ),
        const SizedBox(height: Gap.md),
        Container(
          padding: const EdgeInsets.all(Gap.md),
          decoration: BoxDecoration(
            color: LibraxColors.card,
            borderRadius: Radii.cardAll,
            border: Border.all(color: LibraxColors.line),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: List.generate(7, (i) {
              final isToday = i == today;
              return Column(
                children: [
                  Text(
                    _days[i],
                    style: text.labelSmall?.copyWith(
                      color: isToday ? LibraxColors.brand : LibraxColors.muted,
                      fontWeight:
                          isToday ? FontWeight.w700 : FontWeight.w400,
                    ),
                  ),
                  const SizedBox(height: Gap.xs),
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: isToday
                          ? LibraxColors.brandSoft
                          : LibraxColors.surface,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: isToday
                            ? LibraxColors.brand
                            : LibraxColors.line,
                        width: isToday ? 2 : 1,
                      ),
                    ),
                  ),
                ],
              );
            }),
          ),
        ),
      ],
    );
  }
}
