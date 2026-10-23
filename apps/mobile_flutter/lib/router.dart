import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'content/lesson_content.dart';
import 'lessons/lesson.dart';
import 'lessons/lesson_flow.dart';
import 'screens/home_screen.dart';
import 'screens/learn_screen.dart';
import 'screens/practice_screen.dart';
import 'screens/profile_screen.dart';
import 'widgets/librax_nav.dart';

final router = GoRouter(
  initialLocation: '/',
  routes: [
    // -- Shell com bottom navigation bar --
    ShellRoute(
      builder: (context, state, child) => LibraxScaffold(child: child),
      routes: [
        GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
        GoRoute(path: '/learn', builder: (_, __) => const LearnScreen()),
        GoRoute(path: '/practice', builder: (_, __) => const PracticeScreen()),
        GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
      ],
    ),

    // -- Game loop: licao + conclusao (sem bottom nav bar) --
    GoRoute(
      path: '/learn/unit/:unitId/lesson/:lessonIndex',
      builder: (context, state) {
        final unitId = int.tryParse(state.pathParameters['unitId'] ?? '') ?? 1;
        final lessonIndex =
            int.tryParse(state.pathParameters['lessonIndex'] ?? '') ?? 0;
        final lesson = LessonContent.getLesson(unitId, lessonIndex);

        if (lesson == null) {
          return const Scaffold(
            body: Center(child: Text('Conteudo nao encontrado.')),
          );
        }

        return _LessonRoute(lesson: lesson);
      },
    ),
  ],
);

/// Wrapper que fornece callbacks de navegacao ao [PlayLesson].
/// Usar StatelessWidget para que [context] em build() seja sempre fresco.
class _LessonRoute extends StatelessWidget {
  const _LessonRoute({required this.lesson});

  final Lesson lesson;

  @override
  Widget build(BuildContext context) {
    return PlayLesson(
      lesson: lesson,
      onDone: () => context.go('/learn'),
      onExit: () => context.go('/learn'),
    );
  }
}
