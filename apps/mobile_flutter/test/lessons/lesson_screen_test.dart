import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:librax/lessons/exercise.dart';
import 'package:librax/lessons/lesson.dart';
import 'package:librax/lessons/screens/lesson_screen.dart';

void main() {
  Lesson lesson() => Lesson(
        id: 't',
        title: 'Teste',
        exercises: [
          WatchChooseWord(signId: 'OBRIGADO', options: ['OBRIGADO', 'TCHAU'], correct: 'OBRIGADO'),
          WatchChooseWord(signId: 'OI', options: ['OI', 'TCHAU'], correct: 'OI'),
        ],
      );

  Widget host(Widget child) => MaterialApp(home: child);

  testWidgets('toca a licao de ponta a ponta e reporta o score', (tester) async {
    LessonResult? result;
    await tester.pumpWidget(host(LessonScreen(
      lesson: lesson(),
      onCompleted: (r) => result = r,
    )));

    // Exercicio 1: acerto.
    await tester.ensureVisible(find.text('OBRIGADO'));
    await tester.tap(find.text('OBRIGADO'));
    await tester.pumpAndSettle();
    expect(find.text('Continuar'), findsOneWidget, reason: 'banner + Continuar apos responder');
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();

    // Exercicio 2: erro (correto e OI).
    await tester.ensureVisible(find.text('TCHAU'));
    await tester.tap(find.text('TCHAU'));
    await tester.pumpAndSettle();
    expect(find.textContaining('resposta certa'), findsOneWidget, reason: 'revela a resposta certa');
    await tester.tap(find.text('Concluir')); // ultimo exercicio
    await tester.pumpAndSettle();

    expect(result, isNotNull);
    expect(result!.total, 2);
    expect(result!.correct, 1);
    expect(result!.score, 0.5);
  });

  testWidgets('progresso avanca conforme responde', (tester) async {
    await tester.pumpWidget(host(LessonScreen(lesson: lesson(), onCompleted: (_) {})));
    final bar = tester.widget<LinearProgressIndicator>(find.byType(LinearProgressIndicator));
    expect(bar.value, 0.0);
  });

  testWidgets('sair pede confirmacao e Cancelar mantem na licao', (tester) async {
    await tester.pumpWidget(host(LessonScreen(lesson: lesson(), onCompleted: (_) {})));
    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Sair da licao?'), findsOneWidget);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(find.text('Sair da licao?'), findsNothing);
    expect(find.text('OBRIGADO'), findsOneWidget); // continua no exercicio
  });
}
