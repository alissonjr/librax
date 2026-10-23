import { useState, useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { ExerciseIntro } from '../components/ExerciseIntro';
import { ExerciseMatchPairs } from '../components/ExerciseMatchPairs';
import { ExerciseCameraSign } from '../components/ExerciseCameraSign';
import { ExerciseWatchChooseWord } from '../components/ExerciseWatchChooseWord';
import { ExerciseMirrorPractice } from '../components/ExerciseMirrorPractice';
import { ExerciseOrderSequence } from '../components/ExerciseOrderSequence';
import { ExerciseBuildPhrase } from '../components/ExerciseBuildPhrase';
import { Dialog } from '../components/Dialog';
import { course, getSign, type Exercise } from '../lib/content';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { warmUpHandLandmarker } from '../recognition/landmarker';

/** Exercícios que abrem a câmera: a lição que tem algum já começa a carregar o modelo. */
const CAMERA_EXERCISES = new Set<string>(['perform_sign', 'mirror_practice']);

export interface ReviewedItem {
  signId: string;
  result: { state: string; highConfidence?: boolean };
}

export interface LessonSessionResult {
  lessonId: string;
  score: number;
  reviewed: ReviewedItem[];
  xpReward: number;
  signsLearnedDelta: number;
  isLastLesson: boolean;
}

interface Props {
  lessonId: string;
  /** Exercícios da lição já resolvidos a partir do bundle (loadLessonExercises). */
  exercises: Exercise[];
  onComplete: (result: LessonSessionResult) => Promise<void>;
  /** Sair da lição (botão do topo). Passa pelo diálogo "Sair da lição?", como o voltar do navegador. */
  onExit: () => void;
}

export function LessonScreen({ lessonId, exercises, onComplete, onExit }: Props) {
  const { t } = useT();
  const lesson = course.lessonsMap[lessonId];

  const [currentIdx, setCurrentIdx] = useState(0);
  const [reviewed, setReviewed] = useState<ReviewedItem[]>([]);
  const [newSignsSeen] = useState(new Set<string>());
  const [correct, setCorrect] = useState(0);
  const [attempted, setAttempted] = useState(0);

  // Qualquer saída da lição (voltar do Android, do navegador, botão do topo, link) para no
  // diálogo "Sair da lição?". Ao concluir, a saída é liberada antes de ir para a conclusão.
  const finished = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !finished.current && currentLocation.pathname !== nextLocation.pathname,
  );

  // Cada exercício começa do topo (o anterior pode ter rolado até o botão Continuar)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentIdx]);

  // isLastLesson aciona a tela "Voce concluiu o Alfabeto": vale para a ultima licao
  // da U1, nao para a ultima licao do curso (que agora tem varias unidades).
  const alphabetLessons = course.units[0]?.lessons ?? [];
  const isLastLesson = alphabetLessons[alphabetLessons.length - 1]?.id === lessonId;
  const pct = Math.round((currentIdx / (exercises.length || 1)) * 100);
  const hasCamera = exercises.some(e => CAMERA_EXERCISES.has(e.type));

  // Aquece o landmarker da sessão ao abrir a lição: quando o exercício de câmera chega, o
  // modelo já está pronto (ou quase). Ele é criado uma vez e serve a todos os exercícios.
  useEffect(() => {
    if (hasCamera) warmUpHandLandmarker();
  }, [hasCamera]);

  const advance = useCallback(() => {
    const next = currentIdx + 1;
    if (next >= exercises.length) {
      const score = attempted > 0 ? correct / attempted : 1;
      finished.current = true;
      onComplete({
        lessonId,
        score,
        reviewed,
        xpReward: lesson.xpReward,
        signsLearnedDelta: newSignsSeen.size,
        isLastLesson,
      });
    } else {
      setCurrentIdx(next);
    }
  }, [currentIdx, exercises.length, attempted, correct, reviewed, onComplete, lessonId, lesson, newSignsSeen, isLastLesson]);

  function handleIntroNext(signId: string) {
    newSignsSeen.add(signId);
    advance();
  }

  function handleAnswer(signId: string, answeredCorrectly: boolean) {
    setAttempted((a) => a + 1);
    if (answeredCorrectly) setCorrect((c) => c + 1);
    setReviewed((r) => [
      ...r,
      {
        signId,
        result: answeredCorrectly
          ? { state: 'correct', highConfidence: true }
          : { state: 'failed' },
      },
    ]);
  }

  function handleMatchPairsComplete(allCorrect: boolean) {
    setAttempted((a) => a + 1);
    if (allCorrect) setCorrect((c) => c + 1);
    advance();
  }

  if (!lesson || exercises.length === 0) return null;

  const ex = exercises[currentIdx];

  return (
    <div className="lesson-screen">
      <div className="lesson-topbar">
        <button className="back-btn" onClick={onExit} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <div className="progress-bar-wrap progress-bar-wrap--lesson" role="progressbar" aria-valuemin={0} aria-valuemax={exercises.length} aria-valuenow={currentIdx} aria-valuetext={`${currentIdx}/${exercises.length}`}>
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="progress-label">
          {currentIdx}/{exercises.length}
        </span>
      </div>

      <div key={currentIdx} className="lesson-exercise-wrap animate__animated animate__fadeIn animate__faster">
      {ex.type === 'sign_intro' && (
        <ExerciseIntro sign={getSign(ex.signId)} onNext={() => handleIntroNext(ex.signId)} />
      )}

      {ex.type === 'perform_sign' && (
        <ExerciseCameraSign
          key={ex.id}
          sign={getSign(ex.signId)}
          onComplete={(wasCorrect) => {
            handleAnswer(ex.signId, wasCorrect);
            advance();
          }}
        />
      )}

      {ex.type === 'match_pairs' && ex.pairSignIds && (
        <ExerciseMatchPairs
          key={ex.id}
          signs={ex.pairSignIds.map(getSign)}
          onComplete={handleMatchPairsComplete}
        />
      )}

      {ex.type === 'watch_choose_word' && (
        <ExerciseWatchChooseWord
          key={ex.id}
          sign={getSign(ex.signId)}
          choices={ex.choices ?? []}
          onAnswer={(wasCorrect) => handleAnswer(ex.signId, wasCorrect)}
          onNext={advance}
        />
      )}

      {ex.type === 'mirror_practice' && (
        <ExerciseMirrorPractice
          key={ex.id}
          sign={getSign(ex.signId)}
          onComplete={advance}
        />
      )}

      {ex.type === 'order_sequence' && (
        <ExerciseOrderSequence
          key={ex.id}
          steps={ex.steps ?? []}
          correctOrder={ex.correctOrder ?? (ex.steps ?? []).map((_, i) => i)}
          prompt={ex.word ? t('exerciseOrderSequence.spellPrompt', { word: ex.word }) : undefined}
          onAnswer={(wasCorrect) => {
            setAttempted(a => a + 1);
            if (wasCorrect) setCorrect(c => c + 1);
          }}
          onNext={advance}
        />
      )}

      {ex.type === 'build_phrase' && ex.phrase && (
        <ExerciseBuildPhrase
          key={ex.id}
          pt={ex.phrase.pt}
          glosses={ex.phrase.glosses}
          tiles={ex.tiles ?? ex.phrase.glosses}
          onAnswer={(wasCorrect) => {
            setAttempted(a => a + 1);
            if (wasCorrect) setCorrect(c => c + 1);
          }}
          onNext={advance}
        />
      )}
      </div>

      <Dialog
        isOpen={blocker.state === 'blocked'}
        title={t('lessonScreen.exitTitle')}
        message={t('lessonScreen.exitMessage')}
        confirmLabel={t('lessonScreen.exitConfirm')}
        cancelLabel={t('common.continue')}
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}
