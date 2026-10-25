import { useState, useCallback, useEffect, useRef } from 'react';
import { ExerciseIntro } from '../components/ExerciseIntro';
import { ExerciseMatchPairs } from '../components/ExerciseMatchPairs';
import { ExerciseCameraSign } from '../components/ExerciseCameraSign';
import { ExerciseCameraMotionSign } from '../components/ExerciseCameraMotionSign';
import { ExerciseCameraMotionLetter } from '../components/ExerciseCameraMotionLetter';
import { ExerciseWatchChooseWord } from '../components/ExerciseWatchChooseWord';
import { ExerciseWordChooseVideo } from '../components/ExerciseWordChooseVideo';
import { ExerciseFingerspell } from '../components/ExerciseFingerspell';
import { ExerciseMirrorPractice } from '../components/ExerciseMirrorPractice';
import { ExerciseOrderSequence } from '../components/ExerciseOrderSequence';
import { ExerciseBuildPhrase } from '../components/ExerciseBuildPhrase';
import { course, getSign, type Exercise } from '../lib/content';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { warmUpHandLandmarker } from '../recognition/landmarker';
import { warmUpPoseLandmarker } from '../recognition/poseLandmarker';
import type { LessonProgress } from '../lib/lessonRun';
import type { ExerciseStats } from '../lib/sync';
import { addRunToLesson, onCameraRun, type LessonCameraStats } from '../lib/cameraStats';

/** Exercícios que abrem a câmera: a lição que tem algum já começa a carregar o modelo. */
const CAMERA_EXERCISES = new Set<string>(['perform_sign', 'mirror_practice', 'fingerspell']);

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
  /** Respostas e erros por tipo de exercício, para o painel de administração. */
  exerciseStats?: ExerciseStats;
  /** Desempenho da câmera só desta lição (não o acumulado), para o painel de administração. */
  cameraStats?: LessonCameraStats;
}

interface Props {
  lessonId: string;
  /** Exercícios da lição já resolvidos a partir do bundle (loadLessonExercises). */
  exercises: Exercise[];
  onComplete: (result: LessonSessionResult) => Promise<void>;
  /**
   * Sair da lição (botão do topo). Passa pelo diálogo "Sair da lição?", como o voltar do navegador;
   * o diálogo e o bloqueio da saída ficam na rota (useLessonExit).
   */
  onExit: () => void;
  /** Lição em andamento retomada (página recarregada): abre nesse ponto, com o que já foi respondido. */
  initial?: LessonProgress;
  /** Chamado a cada exercício respondido ou passado, para a rota guardar a lição em andamento. */
  onProgress?: (progress: LessonProgress) => void;
}

export function LessonScreen({ lessonId, exercises, onComplete, onExit, initial, onProgress }: Props) {
  const { t } = useT();
  const lesson = course.lessonsMap[lessonId];

  const [currentIdx, setCurrentIdx] = useState(initial?.index ?? 0);
  const [reviewed, setReviewed] = useState<ReviewedItem[]>(initial?.reviewed ?? []);
  const [newSignsSeen] = useState(() => new Set<string>(initial?.seen ?? []));
  const [correct, setCorrect] = useState(initial?.correct ?? 0);
  const [attempted, setAttempted] = useState(initial?.attempted ?? 0);
  const [exerciseStats, setExerciseStats] = useState<ExerciseStats>(initial?.exerciseStats ?? {});
  // Desempenho da câmera desta lição: o ref é lido na conclusão, que pode vir no mesmo clique do
  // pulo (o estado ainda não renderizou); o estado guarda a lição em andamento a cada vez fechada.
  const cameraRef = useRef<LessonCameraStats>(initial?.cameraStats ?? {});
  const [cameraStats, setCameraStats] = useState<LessonCameraStats>(cameraRef.current);
  useEffect(() => onCameraRun((run) => {
    cameraRef.current = addRunToLesson(cameraRef.current, run);
    setCameraStats(cameraRef.current);
  }), []);
  // Exercício atual já verificado (resposta contada): se a página recarregar, retoma no seguinte
  const [answeredIdx, setAnsweredIdx] = useState(-1);

  // Guarda a lição em andamento a cada resposta e a cada avanço
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  useEffect(() => {
    if (currentIdx >= exercises.length) return;
    const index = answeredIdx === currentIdx ? currentIdx + 1 : currentIdx;
    // Só abriu a lição e ainda não fez nada: não há o que retomar
    if (index === 0 && attempted === 0) return;
    progressRef.current?.({
      index,
      correct,
      attempted,
      reviewed,
      seen: [...newSignsSeen],
      exerciseStats,
      cameraStats,
    });
  }, [currentIdx, answeredIdx, correct, attempted, reviewed, newSignsSeen, exerciseStats, cameraStats, exercises.length]);

  /** Conta a resposta do exercício atual (no total e no tipo do exercício). */
  function record(wasCorrect: boolean) {
    setAttempted(a => a + 1);
    if (wasCorrect) setCorrect(c => c + 1);
    setAnsweredIdx(currentIdx);
    const type = exercises[currentIdx]?.type;
    if (type) {
      setExerciseStats(s => {
        const cur = s[type] ?? { attempted: 0, wrong: 0 };
        return { ...s, [type]: { attempted: cur.attempted + 1, wrong: cur.wrong + (wasCorrect ? 0 : 1) } };
      });
    }
  }

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
  const hasMotionSign = exercises.some(e => e.recognizer === 'sinais');

  // Aquece o landmarker da sessão ao abrir a lição: quando o exercício de câmera chega, o
  // modelo já está pronto (ou quase). Ele é criado uma vez e serve a todos os exercícios.
  useEffect(() => {
    if (hasCamera) warmUpHandLandmarker();
  }, [hasCamera]);
  // O modelo do corpo só serve aos sinais com movimento: só a lição que tem um carrega
  useEffect(() => {
    if (hasMotionSign) warmUpPoseLandmarker();
  }, [hasMotionSign]);

  const finish = useCallback(() => {
    const score = attempted > 0 ? correct / attempted : 1;
    onComplete({
      lessonId,
      score,
      reviewed,
      xpReward: lesson.xpReward,
      signsLearnedDelta: newSignsSeen.size,
      isLastLesson,
      exerciseStats,
      cameraStats: cameraRef.current,
    });
  }, [attempted, correct, reviewed, onComplete, lessonId, lesson, newSignsSeen, isLastLesson, exerciseStats]);

  const advance = useCallback(() => {
    const next = currentIdx + 1;
    if (next >= exercises.length) finish();
    else setCurrentIdx(next);
  }, [currentIdx, exercises.length, finish]);

  // Retomada depois do último exercício já verificado: só falta concluir
  const finishedOnOpen = useRef(false);
  useEffect(() => {
    if (currentIdx < exercises.length || finishedOnOpen.current) return;
    finishedOnOpen.current = true;
    finish();
  }, [currentIdx, exercises.length, finish]);

  function handleIntroNext(signId: string) {
    newSignsSeen.add(signId);
    advance();
  }

  function handleAnswer(signId: string, answeredCorrectly: boolean) {
    record(answeredCorrectly);
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

  // Cada sinal do match_pairs entra no SRS: quem errou o par revisa mais cedo
  function handleMatchPairsComplete(signIds: string[], allCorrect: boolean, missed: string[]) {
    record(allCorrect);
    setReviewed((r) => [
      ...r,
      ...signIds.map((signId) => ({
        signId,
        result: missed.includes(signId) ? { state: 'failed' } : { state: 'correct', highConfidence: true },
      })),
    ]);
    advance();
  }

  if (!lesson || exercises.length === 0 || currentIdx >= exercises.length) return null;

  const ex = exercises[currentIdx];
  // Exercício com câmera: a tela inteira vira o palco (sempre escuro, nos dois modos)
  const onStage = CAMERA_EXERCISES.has(ex.type);

  return (
    <div className={`lesson-screen${onStage ? ' lesson-screen--stage lx-theme-dark' : ''}`}>
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

      {ex.type === 'perform_sign' && ex.recognizer === 'sinais' && (
        <ExerciseCameraMotionSign
          key={ex.id}
          sign={getSign(ex.signId)}
          onComplete={(wasCorrect) => {
            handleAnswer(ex.signId, wasCorrect);
            advance();
          }}
        />
      )}

      {ex.type === 'perform_sign' && ex.recognizer === 'letras-mov' && (
        <ExerciseCameraMotionLetter
          key={ex.id}
          sign={getSign(ex.signId)}
          onComplete={(wasCorrect) => {
            handleAnswer(ex.signId, wasCorrect);
            advance();
          }}
        />
      )}

      {ex.type === 'perform_sign' && !ex.recognizer && (
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
          onComplete={(allCorrect, missed) => handleMatchPairsComplete(ex.pairSignIds ?? [], allCorrect, missed)}
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

      {ex.type === 'word_choose_video' && ex.videoOptions && (
        <ExerciseWordChooseVideo
          key={ex.id}
          word={getSign(ex.signId).gloss}
          sign={getSign(ex.signId)}
          options={ex.videoOptions.map(getSign)}
          onAnswer={(wasCorrect) => handleAnswer(ex.signId, wasCorrect)}
          onNext={advance}
        />
      )}

      {ex.type === 'fingerspell' && ex.word && ex.letters && (
        <ExerciseFingerspell
          key={ex.id}
          word={ex.word}
          letters={ex.letters}
          perLetterConfidence={ex.perLetterConfidence}
          ownName={ex.ownName}
          onAnswer={record}
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
          prompt={ex.word
            ? t(ex.ownName ? 'exerciseOrderSequence.spellOwnNamePrompt' : 'exerciseOrderSequence.spellPrompt', { word: ex.word })
            : undefined}
          onAnswer={record}
          onNext={advance}
        />
      )}

      {ex.type === 'build_phrase' && ex.phrase && (
        <ExerciseBuildPhrase
          key={ex.id}
          pt={ex.phrase.pt}
          glosses={ex.phrase.glosses}
          tiles={ex.tiles ?? ex.phrase.glosses}
          onAnswer={record}
          onNext={advance}
        />
      )}
      </div>
    </div>
  );
}
