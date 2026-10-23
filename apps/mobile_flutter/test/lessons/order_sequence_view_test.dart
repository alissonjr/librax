import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:librax/lessons/exercise.dart';
import 'package:librax/lessons/widgets/order_sequence_view.dart';

void main() {
  OrderSequence okEx() => OrderSequence(steps: const ['a', 'b', 'c'], correctOrder: const ['a', 'b', 'c']);
  OrderSequence wrongEx() => OrderSequence(steps: const ['b', 'a', 'c'], correctOrder: const ['a', 'b', 'c']);

  Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

  testWidgets('mostra instrucao, passos e o botao confirmar', (tester) async {
    await tester.pumpWidget(host(OrderSequenceView(exercise: okEx(), onAnswered: (_) {})));
    expect(find.text('Coloque os passos na ordem correta.'), findsOneWidget);
    for (final s in ['a', 'b', 'c']) {
      expect(find.text(s), findsOneWidget);
    }
    expect(find.text('Confirmar ordem'), findsOneWidget);
  });

  testWidgets('ordem correta: confirmar dispara onAnswered(true)', (tester) async {
    bool? result;
    await tester.pumpWidget(host(OrderSequenceView(exercise: okEx(), onAnswered: (c) => result = c)));
    await tester.ensureVisible(find.text('Confirmar ordem'));
    await tester.tap(find.text('Confirmar ordem'));
    await tester.pump();
    expect(result, isTrue);
  });

  testWidgets('ordem errada: nao dispara onAnswered e mostra dica de ajuste', (tester) async {
    bool? result;
    await tester.pumpWidget(host(OrderSequenceView(exercise: wrongEx(), onAnswered: (c) => result = c)));
    await tester.ensureVisible(find.text('Confirmar ordem'));
    await tester.tap(find.text('Confirmar ordem'));
    await tester.pump();
    expect(result, isNull);
    expect(find.textContaining('Ajuste'), findsOneWidget);
  });
}
