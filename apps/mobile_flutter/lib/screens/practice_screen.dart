import 'package:flutter/material.dart';
import '../platform/practice_widget.dart';
import '../ui/app_theme.dart';

class PracticeScreen extends StatelessWidget {
  const PracticeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Praticar'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: Gap.md),
            child: Chip(
              avatar: const Icon(Icons.back_hand_rounded,
                  size: 14, color: LibraxColors.teal),
              label: Text(
                'Camera ativa',
                style: text.labelSmall
                    ?.copyWith(color: LibraxColors.teal, fontWeight: FontWeight.w600),
              ),
              backgroundColor: LibraxColors.tealSoft,
              padding: EdgeInsets.zero,
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // -- Banner de instrucao --
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
                horizontal: Gap.screenH, vertical: Gap.sm),
            color: LibraxColors.tealSoft,
            child: Row(
              children: [
                const Icon(Icons.lightbulb_rounded,
                    size: 16, color: LibraxColors.teal),
                const SizedBox(width: Gap.sm),
                Expanded(
                  child: Text(
                    'Mostre sua mao no quadro para comecar',
                    style: text.bodySmall
                        ?.copyWith(color: LibraxColors.teal),
                  ),
                ),
              ],
            ),
          ),

          // -- Area de camera --
          const Expanded(child: PracticeWidget()),
        ],
      ),
    );
  }
}
