import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'animate.css';
import './styles/tokens.css';
import './style.css';
import { App } from './App';
import { I18nProvider, adoptLangFromUrl, getInitialLang } from './i18n';
import { applyTheme, getThemePref } from './lib/theme';
import { initInstall } from './lib/install';
import { installSoundUnlock } from './lib/sound';
import { splashStep } from './lib/splash';

// Tela de abertura (index.html): o código principal chegou e está rodando
splashStep('app');
// Idioma escolhido na landing (outro endereço): chega no link como ?lang= e vira a escolha do app
adoptLangFromUrl();
document.documentElement.lang = getInitialLang();
applyTheme(getThemePref());
installSoundUnlock();
// Guarda o beforeinstallprompt do Chrome desde o início: ele pode chegar antes de o React montar
initInstall();

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
