import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../style.css';
import './teste-camera.css';
import { applyTheme, getThemePref } from '../lib/theme';
import { TesteCameraPage } from './TesteCameraPage';

// Página isolada da fase W0 (docs/plano-mobile-web.md): não carrega o app, só a câmera e o
// MediaPipe, para medir o aparelho sem interferência.
applyTheme(getThemePref());

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <TesteCameraPage />
  </StrictMode>,
);
