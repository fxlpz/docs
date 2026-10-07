import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { ChangePasswordPage, RequireFreshPassword } from './pages/ChangePasswordPage';
import { HealthPage } from './pages/HealthPage';
import { HomePanel } from './pages/HomePanel';
import { LoginPage } from './pages/LoginPage';
import { PagePanel } from './pages/PagePanel';
import './styles.css';

/**
 * Rotas da aplicação (Etapa 2):
 * - /login            tela de entrada (pública)
 * - /trocar-senha     troca obrigatória no 1º acesso (sessão exigida)
 * - /                 home do workspace (sessão + senha definitiva exigidas)
 * - /p/:id            página (sessão + senha definitiva exigidas)
 * - /diagnostico      tela de diagnóstico da Etapa 1
 */
const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemento #root não encontrado no index.html');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/trocar-senha" element={<ChangePasswordPage />} />
          <Route path="/diagnostico" element={<HealthPage />} />
          <Route
            element={
              <RequireFreshPassword>
                <AppLayout />
              </RequireFreshPassword>
            }
          >
            <Route path="/" element={<HomePanel />} />
            <Route path="/p/:id" element={<PagePanel />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
