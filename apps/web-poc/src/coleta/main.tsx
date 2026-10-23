import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../style.css';
import './coleta.css';
import { applyTheme, getThemePref } from '../lib/theme';
import { ColetaPage } from './ColetaPage';

// Ferramenta de coleta do dataset (fase W1 do docs/plano-mobile-web.md), aberta por link no
// navegador de cada participante. Guarda só landmarks no IndexedDB do aparelho.
applyTheme(getThemePref());

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ColetaPage />
  </StrictMode>,
);
