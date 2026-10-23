import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:librax/lessons/exercise.dart';
import 'package:librax/lessons/lesson.dart';
import 'package:librax/lessons/lesson_flow.dart';

void main() {
  testWidgets('ao concluir a licao, transita para a tela de conclusao', (tester) async {
    final lesson = Lesson(
      id: 't',
      title: 'T',
      exercises: [WatchChooseWord(signId: 'A', options: ['A', 'E'], correct: 'A')],
    );

    await tester.pumpWidget(MaterialApp(home: PlayLesson(lesson: lesson)));

    await tester.ensureVisible(find.text('A'));
    await tester.tap(find.text('A'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Concluir'));
    await tester.pumpAndSettle();

    expect(find.text('Licao concluida!'), findsOneWidget);
    expect(find.text('100%'), findsOneWidget); // 1 de 1
  });
}
