import { useT } from '../i18n';
import { Icon } from './Icon';
import { TraceArrowIcon } from './Brand';

interface Props {
  showDemo: boolean;
  onOpen: () => void;
  onClose: () => void;
}

/** Botão dos exercícios com câmera: "Ver o movimento" (pausa a câmera) e "Voltar para a câmera". */
export function DemoToggle({ showDemo, onOpen, onClose }: Props) {
  const { t } = useT();
  return showDemo ? (
    <button type="button" className="btn btn-secondary btn-sm btn-inline cam-sign-demo-toggle" onClick={onClose}>
      <Icon name="videocam" /> {t('signDemo.backToCamera')}
    </button>
  ) : (
    <button type="button" className="btn btn-secondary btn-sm btn-inline cam-sign-demo-toggle" onClick={onOpen}>
      <TraceArrowIcon /> {t('signDemo.showSign')}
    </button>
  );
}
