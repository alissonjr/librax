import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../exercise.dart';
import '../../ui/app_theme.dart';

/// Exercicio receptivo `order_sequence` (SPEC 03 secao 11.6):
/// arrasta os passos ate a ordem correta e confirma. Ordem errada nao pune:
/// mostra uma dica e deixa tentar de novo. Conclui quando a ordem bate.
class OrderSequenceView extends StatefulWidget {
  const OrderSequenceView({
    super.key,
    required this.exercise,
    required this.onAnswered,
  });

  final OrderSequence exercise;
  final ValueChanged<bool> onAnswered;

  @override
  State<OrderSequenceView> createState() => _OrderSequenceViewState();
}

class _OrderSequenceViewState extends State<OrderSequenceView> {
  late final List<String> _order = List<String>.from(widget.exercise.steps);
  bool _wrong = false;
  bool _done = false;

  void _onReorderItem(int fromIndex, int toIndex) {
    if (_done) return;
    setState(() {
      final item = _order.removeAt(fromIndex);
      _order.insert(toIndex, item);
      _wrong = false;
    });
  }

  void _confirm() {
    if (_done) return;
    final correct = widget.exercise.check(_order);
    if (correct) {
      HapticFeedback.mediumImpact();
      setState(() => _done = true);
      widget.onAnswered(true);
    } else {
      HapticFeedback.heavyImpact();
      setState(() => _wrong = true);
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
            'Coloque os passos na ordem correta.',
            style: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Gap.lg),
          ReorderableListView(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            buildDefaultDragHandles: false,
            onReorderItem: _onReorderItem,
            children: [
              for (int i = 0; i < _order.length; i++)
                _StepTile(
                  key: ValueKey(_order[i]),
                  index: i,
                  label: _order[i],
                  done: _done,
                ),
            ],
          ),
          if (_wrong) ...[
            const SizedBox(height: Gap.sm),
            Text(
              'Quase! Ajuste a ordem e tente de novo.',
              style: text.bodyMedium?.copyWith(color: LibraxColors.error, fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: Gap.lg),
          FilledButton(
            onPressed: _done ? null : _confirm,
            child: const Text('Confirmar ordem'),
          ),
        ],
      ),
    );
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({
    super.key,
    required this.index,
    required this.label,
    required this.done,
  });

  final int index;
  final String label;
  final bool done;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.sm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: Gap.md, vertical: Gap.base),
        decoration: BoxDecoration(
          color: done ? LibraxColors.successSoft : LibraxColors.card,
          border: Border.all(
            color: done ? LibraxColors.success : LibraxColors.line,
            width: 2,
          ),
          borderRadius: Radii.cardAll,
        ),
        child: Row(
          children: [
            CircleAvatar(
              radius: 14,
              backgroundColor: done ? LibraxColors.success : LibraxColors.brand,
              child: Text(
                '${index + 1}',
                style: text.labelMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w800),
              ),
            ),
            const SizedBox(width: Gap.md),
            Expanded(
              child: Text(label, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
            ),
            if (!done)
              ReorderableDragStartListener(
                index: index,
                child: const Icon(Icons.drag_handle_rounded, color: LibraxColors.muted),
              )
            else
              const Icon(Icons.check_circle_rounded, color: LibraxColors.success),
          ],
        ),
      ),
    );
  }
}
