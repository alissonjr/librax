import type { Sign } from '../lib/content';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { HandDemo } from './HandDemo';

interface Props {
  sign: Sign;
  onNext: () => void;
}

export function ExerciseIntro({ sign, onNext }: Props) {
  const { t } = useT();
  const typeBadge =
    sign.recognition === 'dynamic' ? t('exerciseIntro.badgeDynamic') : t('exerciseIntro.badgeStatic');

  return (
    <div className="exercise-screen">
      <div className="sign-card animate__animated animate__zoomIn animate__faster">
        <HandDemo
          sign={sign}
          className="sign-demo--intro"
          fallback={
            <div className="video-placeholder">
              <Icon name="sign_language" filled />
            </div>
          }
        />
        <div className="sign-gloss animate__animated animate__bounceIn" style={{ animationDelay: '150ms' }}>{sign.gloss}</div>
        <div className="sign-label">
          {sign.category === 'alfabeto'
            ? t('exerciseIntro.letter', { gloss: sign.gloss })
            : sign.category === 'numeros'
              ? t('exerciseIntro.number', { gloss: sign.gloss })
              : t('exerciseIntro.sign')}
        </div>
        <span className="sign-type-badge">{typeBadge}</span>
        <p className="sign-description">{sign.params.CM}</p>
        {sign.recognition === 'dynamic' && (
          <p className="sign-description sign-description--movement">
            {t('exerciseIntro.movement', { mov: sign.params.MOV })}
          </p>
        )}
      </div>
      <button className="btn btn-primary" onClick={onNext}>
        {t('exerciseIntro.understood')} <Icon name="arrow_forward" />
      </button>
    </div>
  );
}
