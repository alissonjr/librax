import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@app/styles/tokens.css';
import './styles.css';
import { AdminApp } from './App';
import { httpApi, type AdminApi } from './lib/api';
import { sharedAuth, type AdminAuth } from './lib/auth';
import { applyTheme, loadTheme } from './lib/theme';

applyTheme(loadTheme());

async function start() {
  let api: AdminApi = httpApi();
  let session: AdminAuth = sharedAuth();
  // `npm run dev:mock`: dados de exemplo e login de mentira (some do build de produção)
  if (import.meta.env.MODE === 'mock') {
    const mock = await import('./dev/mock');
    api = mock.mockApi();
    session = mock.mockSession();
  }
  createRoot(document.getElementById('admin')!).render(
    <StrictMode>
      <BrowserRouter basename="/admin" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminApp api={api} session={session} />
      </BrowserRouter>
    </StrictMode>,
  );
}

void start();
