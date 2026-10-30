import { useState } from 'react';
import { Card, Chip } from './ui';
import { Icon } from './Icon';
import { useApi } from '../lib/context';
import { buildCalibrationExport, downloadJson, exportFileName, EXPORT_DAYS } from '../lib/exportData';

/**
 * "Baixar dados para calibrar": um arquivo com a câmera, as lições e os exercícios dos últimos
 * 90 dias, os dados de uso consolidados, todas as notas com comentário e o catálogo do curso.
 * Só totais e notas anônimas: nenhum e-mail, nome ou id de conta vai no arquivo.
 */
export function ExportCalibration({ now = () => new Date() }: { now?: () => Date }) {
  const api = useApi();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const run = async () => {
    setState('busy');
    try {
      const data = await buildCalibrationExport(api, now);
      downloadJson(data, exportFileName(now()));
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <Card
      title="Dados para calibrar"
      actions={(
        <button type="button" className="btn btn--secondary" onClick={() => void run()} disabled={state === 'busy'}>
          <Icon name="download" /> {state === 'busy' ? 'Juntando...' : 'Baixar arquivo'}
        </button>
      )}
    >
      <p className="note">
        Um arquivo só com a câmera, as lições e os exercícios dos últimos {EXPORT_DAYS} dias, os dados de uso consolidados,
        todas as notas com comentário e o catálogo do curso. Só totais e notas anônimas: nenhum e-mail, nome ou conta.
      </p>
      {state === 'done' && <p className="note" role="status">Arquivo baixado. É só trazer para a conversa com o Claude.</p>}
      {state === 'error' && <p className="state state--error" role="alert"><Chip tone="error" icon="warning">Erro</Chip> Não deu para juntar os dados agora. Tente de novo.</p>}
    </Card>
  );
}
