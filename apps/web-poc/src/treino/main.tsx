import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../style.css';
import '../coleta/coleta.css';
import './treino.css';
import { applyTheme, getThemePref } from '../lib/theme';
import { TreinoVideoPage } from './TreinoVideoPage';

// Extração de landmarks de vídeos para o treino (ml-training/video). Só no servidor de
// desenvolvimento: os vídeos e a gravação passam pelo plugin librax-treino-video do vite.config.ts.
applyTheme(getThemePref());

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <TreinoVideoPage />
  </StrictMode>,
);
