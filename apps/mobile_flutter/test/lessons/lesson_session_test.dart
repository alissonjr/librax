import 'package:flutter_test/flutter_test.dart';
import 'package:librax/lessons/exercise.dart';
import 'package:librax/lessons/lesson_session.dart';

void main() {
  group('Exercicios receptivos (SPEC 03 secao 3)', () {
    test('watch_choose_word: correto quando escolhe a glosa certa', () {
      final ex = WatchChooseWord(
        signId: 'OBRIGADO',
        options: ['OBRIGADO', 'TCHAU', 'OI', 'DESCULPA'],
        correct: 'OBRIGADO',
      );
      expect(ex.check('OBRIGADO'), isTrue);
      expect(ex.check('TCHAU'), isFalse);
    });

    test('word_choose_video: correto quando escolhe o sign_id certo', () {
      final ex = WordChooseVideo(
        word: 'OBRIGADO',
        videoOptions: ['OBRIGADO', 'OI'],
        correctSignId: 'OBRIGADO',
      );
      expect(ex.check('OBRIGADO'), isTrue);
      expect(ex.check('OI'), isFalse);
    });

    test('match_pairs: correto so quando todos os pares batem', () {
      final ex = MatchPairs(pairs: const [Pair('OI', 'OI'), Pair('TCHAU', 'TCHAU')]);
      expect(ex.check({'OI': 'OI', 'TCHAU': 'TCHAU'}), isTrue);
      expect(ex.check({'OI': 'TCHAU', 'TCHAU': 'OI'}), isFalse);
      expect(ex.check({'OI': 'OI'}), isFalse); // incompleto
    });

    test('order_sequence: correto quando a ordem bate exatamente', () {
      final ex = OrderSequence(steps: ['a', 'b', 'c'], correctOrder: ['a', 'b', 'c']);
      expect(ex.check(['a', 'b', 'c']), isTrue);
      expect(ex.check(['b', 'a', 'c']), isFalse);
    });
  });

  group('LessonSession (SPEC 03 secao 4)', () {
    LessonSession build() => LessonSession([
          WatchChooseWord(signId: 'OBRIGADO', options: ['OBRIGADO', 'TCHAU'], correct: 'OBRIGADO'),
          OrderSequence(steps: ['a', 'b'], correctOrder: ['a', 'b']),
        ]);

    test('comeca no primeiro exercicio, progresso 0', () {
      final s = build();
      expect(s.total, 2);
      expect(s.index, 0);
      expect(s.isComplete, isFalse);
      expect(s.progress, 0.0);
    });

    test('responder registra acerto e NAO avanca sozinho', () {
      final s = build();
      final correct = s.submit('OBRIGADO');
      expect(correct, isTrue);
      expect(s.index, 0);
      expect(s.answeredCurrent, isTrue);
    });

    test('avancar leva ao proximo; conclui ao responder o ultimo', () {
      final s = build();
      s.submit('OBRIGADO');
      s.advance();
      expect(s.index, 1);
      s.submit(['a', 'b']);
      expect(s.isComplete, isTrue);
      expect(s.progress, 1.0);
      expect(s.score, 1.0);
    });

    test('erro NAO encerra a licao (sem vidas) e conta no score', () {
      final s = build();
      expect(s.submit('TCHAU'), isFalse);
      s.advance();
      s.submit(['a', 'b']);
      expect(s.isComplete, isTrue);
      expect(s.score, 0.5); // 1 de 2
    });
  });
}
