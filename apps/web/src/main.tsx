import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { ChangePasswordPage, RequireFreshPassword } from './pages/ChangePasswordPage';
import { HealthPage } from './pages/HealthPage';
import { HomePanel } from './pages/HomePanel';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { PagePanel } from './pages/PagePanel';
import { ProfilePage } from './pages/ProfilePage';
import { PublicPage } from './pages/PublicPage';
import { SearchPage } from './pages/SearchPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TrashPage } from './pages/TrashPage';
import { RequireAdmin, UsersPage } from './pages/UsersPage';
import './styles.css';

/**
 * Rotas da aplicação:
 * - /                 landing pública (sem login)
 * - /pub/:id          leitor público somente-leitura (sem login)
 * - /login            tela de entrada (pública)
 * - /trocar-senha     troca obrigatória no 1º acesso (sessão exigida)
 * - /diagnostico      tela de diagnóstico
 * - /app/*            área logada (sessão + senha definitiva exigidas)
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
          <Route path="/" element={<LandingPage />} />
          <Route path="/pub/:id" element={<PublicPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/trocar-senha" element={<ChangePasswordPage />} />
          <Route path="/diagnostico" element={<HealthPage />} />
          <Route
            path="/app"
            element={
              <RequireFreshPassword>
                <AppLayout />
              </RequireFreshPassword>
            }
          >
            <Route index element={<HomePanel />} />
            <Route path="p/:id" element={<PagePanel />} />
            <Route path="perfil" element={<ProfilePage />} />
            <Route
              path="usuarios"
              element={
                <RequireAdmin>
                  <UsersPage />
                </RequireAdmin>
              }
            />
            <Route path="buscar" element={<SearchPage />} />
            <Route path="lixeira" element={<TrashPage />} />
            <Route path="modelos" element={<TemplatesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
