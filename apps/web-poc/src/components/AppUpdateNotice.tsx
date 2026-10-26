import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../i18n';
import {
  beginUpdateNotice, endUpdateNotice, getAppUpdateState, isSafeForUpdate, reloadForUpdate, subscribeAppUpdate,
} from '../lib/appUpdate';
import { Toast } from './Toast';

interface Props {
  /** Outro aviso da sessão na tela: o de atualização espera ele sair. */
  busy?: boolean;
}

/**
 * Atualização do app (lib/appUpdate.ts) vista pela pessoa: recarrega para a versão nova e mostra
 * "App atualizado", uma vez. Os dois só acontecem no mapa ou nas Configurações; numa
 * lição ou na câmera, esperam a pessoa voltar. O aviso não bloqueia nada (toast, some em 4 s).
 */
export function AppUpdateNotice({ busy = false }: Props) {
  const { t } = useT();
  const { pathname } = useLocation();
  const { notice, reloadPending } = useSyncExternalStore(subscribeAppUpdate, getAppUpdateState);
  const safe = isSafeForUpdate(pathname);

  useEffect(() => {
    if (safe && !busy && reloadPending) reloadForUpdate();
  }, [safe, busy, reloadPending]);

  useEffect(() => {
    if (safe && !busy && !reloadPending && notice === 'pending') beginUpdateNotice();
  }, [safe, busy, reloadPending, notice]);

  useEffect(() => {
    if (notice === 'showing' && (!safe || busy || reloadPending)) endUpdateNotice();
  }, [safe, busy, reloadPending, notice]);

  if (!safe || busy || reloadPending || notice !== 'showing') return null;
  return (
    <Toast
      message={t('appUpdate.updated')}
      onDone={endUpdateNotice}
    />
  );
}
