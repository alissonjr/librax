import 'package:flutter/material.dart';
import '../hand_camera_view.dart';
import '../ui/app_theme.dart';

class PracticeWidget extends StatefulWidget {
  const PracticeWidget({super.key});

  @override
  State<PracticeWidget> createState() => _PracticeWidgetState();
}

class _PracticeWidgetState extends State<PracticeWidget> {
  int _handCount = 0;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return HandCameraView(
      mode: HandViewMode.avatar3d,
      onHands: (hands) {
        if (hands.length != _handCount && mounted) {
          setState(() => _handCount = hands.length);
        }
      },
      overlay: SafeArea(
        child: Align(
          alignment: Alignment.bottomCenter,
          child: Padding(
            padding: const EdgeInsets.only(bottom: Gap.xl),
            child: AnimatedSwitcher(
              duration: LibraxDuration.normal,
              child: _handCount > 0
                  ? _DetectedBadge(count: _handCount, textTheme: text)
                  : _NoBadge(textTheme: text),
            ),
          ),
        ),
      ),
    );
  }
}

class _DetectedBadge extends StatelessWidget {
  const _DetectedBadge({required this.count, required this.textTheme});

  final int count;
  final TextTheme textTheme;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: Gap.md, vertical: Gap.sm),
      decoration: BoxDecoration(
        color: LibraxColors.teal.withAlpha(230),
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.back_hand_rounded, color: Colors.white, size: 18),
          const SizedBox(width: Gap.sm),
          Text(
            count == 1 ? 'Mao detectada' : 'Maos detectadas: $count',
            style: textTheme.labelMedium?.copyWith(color: Colors.white),
          ),
        ],
      ),
    );
  }
}

class _NoBadge extends StatelessWidget {
  const _NoBadge({required this.textTheme});

  final TextTheme textTheme;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: Gap.md, vertical: Gap.sm),
      decoration: BoxDecoration(
        color: Colors.black.withAlpha(153),
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.back_hand_outlined, color: Colors.white54, size: 18),
          const SizedBox(width: Gap.sm),
          Text(
            'Mostre a mao no quadro',
            style: textTheme.labelMedium?.copyWith(color: Colors.white70),
          ),
        ],
      ),
    );
  }
}
