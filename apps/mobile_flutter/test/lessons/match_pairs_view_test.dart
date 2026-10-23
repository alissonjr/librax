import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:librax/lessons/exercise.dart';
import 'package:librax/lessons/widgets/match_pairs_view.dart';

void main() {
  // signId distinto da gloss para os finders nao colidirem.
  MatchPairs ex() => MatchPairs(pairs: const [
        Pair('sinal_oi', 'OI'),
        Pair('sinal_tchau', 'TCHAU'),
      ]);

  Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

  testWidgets('mostra a instrucao, os sinais (esquerda) e as glosas (direita)', (tester) async {
    await tester.pumpWidget(host(MatchPairsView(exercise: ex(), onAnswered: (_) {})));
    expect(find.text('Relacione os sinais com os significados.'), findsOneWidget);
    expect(find.bySemanticsLabel('sinal_oi'), findsOneWidget);
    expect(find.bySemanticsLabel('sinal_tchau'), findsOneWidget);
    expect(find.text('OI'), findsOneWidget);
    expect(find.text('TCHAU'), findsOneWidget);
  });

  testWidgets('parear todos corretamente dispara onAnswered(true)', (tester) async {
    bool? result;
    await tester.pumpWidget(host(MatchPairsView(exercise: ex(), onAnswered: (c) => result = c)));

    await tester.tap(find.bySemanticsLabel('sinal_oi'));
    await tester.pump();
    await tester.tap(find.text('OI'));
    await tester.pump();
    expect(result, isNull, reason: 'ainda falta um par');

    await tester.tap(find.bySemanticsLabel('sinal_tchau'));
    await tester.pump();
    await tester.tap(find.text('TCHAU'));
    await tester.pump();
    expect(result, isTrue);
  });

  testWidgets('par errado nao conclui o exercicio', (tester) async {
    bool? result;
    await tester.pumpWidget(host(MatchPairsView(exercise: ex(), onAnswered: (c) => result = c)));

    await tester.tap(find.bySemanticsLabel('sinal_oi'));
    await tester.pump();
    await tester.tap(find.text('TCHAU')); // gloss errada para sinal_oi
    await tester.pump();
    expect(result, isNull);
  });
}
