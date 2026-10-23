import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:librax/lessons/lesson.dart';
import 'package:librax/lessons/screens/lesson_complete_screen.dart';

void main() {
  Widget host(Widget child) => MaterialApp(home: child);

  testWidgets('mostra titulo, XP, precisao e sequencia', (tester) async {
    await tester.pumpWidget(host(LessonCompleteScreen(
      result: const LessonResult(correct: 2, total: 2),
      xp: 15,
      streak: 3,
      onContinue: () {},
    )));
    await tester.pumpAndSettle();

    expect(find.text('Licao concluida!'), findsOneWidget);
    expect(find.text('+15 XP'), findsOneWidget); // count-up assentado
    expect(find.text('100%'), findsOneWidget); // precisao
    expect(find.text('3'), findsOneWidget); // sequencia
  });

  testWidgets('Continuar dispara o callback', (tester) async {
    var continued = false;
    await tester.pumpWidget(host(LessonCompleteScreen(
      result: const LessonResult(correct: 1, total: 2),
      xp: 10,
      streak: 1,
      onContinue: () => continued = true,
    )));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continuar'));
    expect(continued, isTrue);
  });
}
