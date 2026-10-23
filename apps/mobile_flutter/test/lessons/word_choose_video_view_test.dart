import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:librax/lessons/exercise.dart';
import 'package:librax/lessons/widgets/word_choose_video_view.dart';

void main() {
  WordChooseVideo ex() => WordChooseVideo(
        word: 'OBRIGADO',
        videoOptions: ['OBRIGADO', 'OI', 'TCHAU', 'DESCULPA'],
        correctSignId: 'OBRIGADO',
      );

  Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

  testWidgets('mostra o enunciado com a palavra e os 4 videos', (tester) async {
    await tester.pumpWidget(host(WordChooseVideoView(exercise: ex(), onAnswered: (_) {})));
    expect(find.text('Qual video mostra o sinal de OBRIGADO?'), findsOneWidget);
    for (final s in ['OBRIGADO', 'OI', 'TCHAU', 'DESCULPA']) {
      expect(find.bySemanticsLabel(s), findsOneWidget);
    }
  });

  testWidgets('acerto: onAnswered(true) e marca o video certo', (tester) async {
    bool? result;
    await tester.pumpWidget(host(WordChooseVideoView(exercise: ex(), onAnswered: (c) => result = c)));
    await tester.ensureVisible(find.bySemanticsLabel('OBRIGADO'));
    await tester.tap(find.bySemanticsLabel('OBRIGADO'));
    await tester.pump();
    expect(result, isTrue);
    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget);
    expect(find.byIcon(Icons.cancel_rounded), findsNothing);
  });

  testWidgets('erro: onAnswered(false), revela o certo e marca o escolhido', (tester) async {
    bool? result;
    await tester.pumpWidget(host(WordChooseVideoView(exercise: ex(), onAnswered: (c) => result = c)));
    await tester.ensureVisible(find.bySemanticsLabel('OI'));
    await tester.tap(find.bySemanticsLabel('OI'));
    await tester.pump();
    expect(result, isFalse);
    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget); // OBRIGADO revelado
    expect(find.byIcon(Icons.cancel_rounded), findsOneWidget); // OI marcado
  });

  testWidgets('nao aceita segunda resposta', (tester) async {
    int calls = 0;
    await tester.pumpWidget(host(WordChooseVideoView(exercise: ex(), onAnswered: (_) => calls++)));
    await tester.ensureVisible(find.bySemanticsLabel('OI'));
    await tester.tap(find.bySemanticsLabel('OI'));
    await tester.pump();
    await tester.ensureVisible(find.bySemanticsLabel('OBRIGADO'));
    await tester.tap(find.bySemanticsLabel('OBRIGADO'));
    await tester.pump();
    expect(calls, 1);
  });
}
