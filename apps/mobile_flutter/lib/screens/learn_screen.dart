import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../ui/app_theme.dart';

class LearnScreen extends StatelessWidget {
  const LearnScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Aprender')),
      body: ListView(
        padding: const EdgeInsets.symmetric(
            vertical: Gap.md, horizontal: Gap.screenH),
        children: const [
          _UnitSection(
            unitNumber: 1,
            title: 'Alfabeto',
            description: 'Letras do alfabeto em Libras (datilologia)',
            gradientColors: [Color(0xFF6C5CE7), Color(0xFF5546D6)],
            lessons: [
              (label: 'A, B, C, D', locked: false, done: false),
              (label: 'E, F, G, H', locked: true,  done: false),
              (label: 'I, J, K, L', locked: true,  done: false),
              (label: 'Revisao - Parte 1', locked: true, done: false),
            ],
          ),
          SizedBox(height: 0),
          _UnitSection(
            unitNumber: 2,
            title: 'Numeros',
            description: 'De 0 a 100 em Libras',
            gradientColors: [Color(0xFF009688), Color(0xFF00796B)],
            lessons: [
              (label: '0 a 10',   locked: true, done: false),
              (label: '11 a 100', locked: true, done: false),
            ],
          ),
        ],
      ),
    );
  }
}

// -- Secao de unidade --

class _UnitSection extends StatelessWidget {
  const _UnitSection({
    required this.unitNumber,
    required this.title,
    required this.description,
    required this.gradientColors,
    required this.lessons,
  });

  final int unitNumber;
  final String title;
  final String description;
  final List<Color> gradientColors;
  final List<({String label, bool locked, bool done})> lessons;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // -- Cabecalho de unidade com gradiente --
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(Gap.md),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: gradientColors,
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: Radii.cardAll,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Unidade $unitNumber',
                style: text.labelMedium?.copyWith(
                  color: Colors.white.withAlpha(204),
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: Gap.xs),
              Text(
                title,
                style: text.headlineSmall?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: Gap.xs),
              Text(
                description,
                style: text.bodySmall?.copyWith(
                  color: Colors.white.withAlpha(179),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Gap.sm),

        // -- Lista de licoes --
        ...lessons.asMap().entries.map(
              (e) => _LessonTile(
                unitNumber: unitNumber,
                index: e.key,
                label: e.value.label,
                locked: e.value.locked,
                done: e.value.done,
                accentColor: gradientColors.first,
              ),
            ),
        const SizedBox(height: Gap.xxl),
      ],
    );
  }
}

// -- Tile de licao individual --

class _LessonTile extends StatelessWidget {
  const _LessonTile({
    required this.unitNumber,
    required this.index,
    required this.label,
    required this.locked,
    required this.done,
    required this.accentColor,
  });

  final int unitNumber;
  final int index;
  final String label;
  final bool locked;
  final bool done;
  final Color accentColor;

  Color get _avatarColor {
    if (locked) return LibraxColors.locked;
    if (done) return LibraxColors.success;
    return accentColor;
  }

  Color get _tileBg {
    if (done) return LibraxColors.successSoft;
    if (locked) return LibraxColors.surface;
    return LibraxColors.card;
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.sm),
      child: Material(
        color: _tileBg,
        borderRadius: Radii.mdAll,
        child: InkWell(
          onTap: locked
              ? null
              : () => context.push(
                    '/learn/unit/$unitNumber/lesson/$index',
                  ),
          borderRadius: Radii.mdAll,
          child: Container(
            padding: const EdgeInsets.symmetric(
                horizontal: Gap.md, vertical: Gap.base),
            decoration: BoxDecoration(
              border: Border.all(
                color: locked
                    ? LibraxColors.line
                    : done
                        ? LibraxColors.successDark.withAlpha(51)
                        : accentColor.withAlpha(51),
              ),
              borderRadius: Radii.mdAll,
            ),
            child: Row(
              children: [
                // Icone de estado
                CircleAvatar(
                  radius: 22,
                  backgroundColor: _avatarColor,
                  child: _avatarChild(text),
                ),
                const SizedBox(width: Gap.md),

                // Label e subtitulo
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: text.titleSmall?.copyWith(
                          color: locked
                              ? LibraxColors.muted
                              : LibraxColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        done
                            ? 'Concluida'
                            : locked
                                ? 'Bloqueada'
                                : 'Disponivel',
                        style: text.bodySmall?.copyWith(
                          color: done
                              ? LibraxColors.successDark
                              : LibraxColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),

                // Seta ou check
                if (!locked)
                  Icon(
                    done
                        ? Icons.check_circle_rounded
                        : Icons.arrow_forward_ios_rounded,
                    size: done ? 20 : 16,
                    color: done ? LibraxColors.success : LibraxColors.muted,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _avatarChild(TextTheme text) {
    if (locked) {
      return const Icon(Icons.lock_rounded, size: 18, color: Colors.white);
    }
    if (done) {
      return const Icon(Icons.check_rounded, size: 20, color: Colors.white);
    }
    return Text(
      '${index + 1}',
      style: text.titleSmall?.copyWith(
        color: Colors.white,
        fontWeight: FontWeight.w800,
      ),
    );
  }
}
