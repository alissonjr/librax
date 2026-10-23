import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:librax/lessons/exercise.dart';
import 'package:librax/lessons/widgets/watch_choose_word_view.dart';

void main() {
  WatchChooseWord ex() => WatchChooseWord(
        signId: 'OBRIGADO',
        options: ['OBRIGADO', 'TCHAU', 'OI', 'DESCULPA'],
        correct: 'OBRIGADO',
      );

  Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

  testWidgets('mostra o enunciado e as 4 opcoes', (tester) async {
    await tester.pumpWidget(host(WatchChooseWordView(exercise: ex(), onAnswered: (_) {})));
    expect(find.text('Qual e este sinal?'), findsOneWidget);
    for (final o in ['OBRIGADO', 'TCHAU', 'OI', 'DESCULPA']) {
      expect(find.text(o), findsOneWidget);
    }
  });

  testWidgets('acerto: dispara onAnswered(true) e marca a opcao certa', (tester) async {
    bool? result;
    await tester.pumpWidget(host(WatchChooseWordView(exercise: ex(), onAnswered: (c) => result = c)));
    await tester.ensureVisible(find.text('OBRIGADO'));
    await tester.tap(find.text('OBRIGADO'));
    await tester.pump();
    expect(result, isTrue);
    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget);
    expect(find.byIcon(Icons.cancel_rounded), findsNothing);
  });

  testWidgets('erro: onAnswered(false), revela a certa e marca a errada (sem punir)', (tester) async {
    bool? result;
    await tester.pumpWidget(host(WatchChooseWordView(exercise: ex(), onAnswered: (c) => result = c)));
    await tester.ensureVisible(find.text('TCHAU'));
    await tester.tap(find.text('TCHAU'));
    await tester.pump();
    expect(result, isFalse);
    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget); // OBRIGADO revelado
    expect(find.byIcon(Icons.cancel_rounded), findsOneWidget); // TCHAU marcado
  });

  testWidgets('nao aceita uma segunda resposta', (tester) async {
    int calls = 0;
    await tester.pumpWidget(host(WatchChooseWordView(exercise: ex(), onAnswered: (_) => calls++)));
    await tester.ensureVisible(find.text('TCHAU'));
    await tester.tap(find.text('TCHAU'));
    await tester.pump();
    await tester.ensureVisible(find.text('OBRIGADO'));
    await tester.tap(find.text('OBRIGADO'));
    await tester.pump();
    expect(calls, 1);
  });
}
