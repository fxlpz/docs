import { changePasswordResponseSchema, PASSWORD_MIN_LENGTH } from '@krndocs/shared';
import { KeyRound, UserRound } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { PageHeader } from '../components/PageHeader.js';
import { UserAvatar } from '../components/UserAvatar.js';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

/**
 * Perfil do usuário (`/app/perfil`).
 *
 * - Nome de exibição editável (PATCH /api/users/me).
 * - Troca voluntária de senha (mesma rota da troca obrigatória).
 * - Usuário e papel são imutáveis aqui (papel só via administração).
 */
export function ProfilePage(): React.JSX.Element {
  const { userId, username, displayName, role, mustChangePassword, hasAvatar, refresh } = useAuth();
  const [name, setName] = useState(displayName ?? '');
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [passError, setPassError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const [avatarKey, setAvatarKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadAvatar(file: File): Promise<void> {
    setAvatarMsg(null);
    const form = new FormData();
    form.append('avatar', file, file.name);
    try {
      await apiFetch('/api/users/me/avatar', { method: 'POST', body: form });
      setAvatarKey((current) => current + 1);
      await refresh();
      setAvatarMsg('Foto atualizada.');
    } catch (err) {
      setAvatarMsg(err instanceof ApiError ? err.message : 'Falha no envio.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeAvatar(): Promise<void> {
    setAvatarMsg(null);
    try {
      await apiFetch('/api/users/me/avatar', { method: 'DELETE' });
      setAvatarKey((current) => current + 1);
      await refresh();
      setAvatarMsg('Foto removida.');
    } catch (err) {
      setAvatarMsg(err instanceof ApiError ? err.message : 'Falha ao remover.');
    }
  }

  async function handleName(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNameMsg(null);
    setSaving(true);
    try {
      await apiFetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: name.trim() }),
      });
      await refresh();
      setNameMsg('Nome atualizado.');
    } catch (err) {
      setNameMsg(err instanceof ApiError ? err.message : 'Falha ao atualizar o nome.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPassMsg(null);
    setPassError(null);
    if (newPassword !== confirm) {
      setPassError('A nova senha e a confirmação não coincidem.');
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPassError(`A nova senha precisa de ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    setSaving(true);
    try {
      const json = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      parseWith(changePasswordResponseSchema, json);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      await refresh();
      setPassMsg('Senha alterada com sucesso.');
    } catch (err) {
      setPassError(
        err instanceof ApiError ? err.message : 'Não foi possível conectar ao servidor.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        icon={<UserRound size={18} aria-hidden="true" />}
        title="Meu perfil"
        description="Suas informações e credenciais."
      />

      {mustChangePassword && (
        <div role="alert" className="kd-alert-error mb-4">
          Sua senha ainda é provisória.{' '}
          <Link to="/trocar-senha" style={{ color: '#c0392b', textDecoration: 'underline' }}>
            Defina uma definitiva agora
          </Link>
          .
        </div>
      )}

      <section className="kd-card mb-4 flex items-center gap-3 p-4">
        <UserAvatar
          userId={userId ?? ''}
          hasAvatar={hasAvatar}
          name={displayName ?? username ?? '?'}
          size={48}
          cacheKey={avatarKey}
        />
        <div className="min-w-0 flex-1">
          <h2 className="kd-section-title">Foto de perfil</h2>
          <p className="text-xs" style={{ color: 'var(--kd-muted)' }}>
            PNG, JPEG, GIF ou WebP até 2 MiB. Visível para a equipe logada.
          </p>
          {avatarMsg && (
            <p role="status" className="mt-1 text-xs" style={{ color: 'var(--kd-muted)' }}>
              {avatarMsg}
            </p>
          )}
        </div>
        <span className="flex shrink-0 gap-2">
          <label className="kd-btn kd-btn-ghost cursor-pointer">
            Enviar foto
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              aria-label="Enviar foto de perfil"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
              }}
            />
          </label>
          {hasAvatar && (
            <button
              type="button"
              className="kd-btn kd-btn-danger-ghost"
              onClick={() => void removeAvatar()}
            >
              Remover
            </button>
          )}
        </span>
      </section>

      <section className="kd-card mb-4 p-4">
        <h2 className="kd-section-title mb-3 flex items-center gap-2">
          <UserRound size={15} aria-hidden="true" />
          Informações
        </h2>
        <dl className="mb-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt style={{ color: 'var(--kd-muted)' }}>Usuário</dt>
            <dd className="font-medium">{username}</dd>
          </div>
          <div className="flex justify-between">
            <dt style={{ color: 'var(--kd-muted)' }}>Papel</dt>
            <dd>
              <span className="kd-badge">
                {role === 'admin' ? 'Administrador' : 'Usuário padrão'}
              </span>
            </dd>
          </div>
        </dl>
        <form onSubmit={(event) => void handleName(event)} className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome de exibição"
            aria-label="Nome de exibição"
            required
            className="kd-input min-w-0 flex-1"
          />
          <button type="submit" disabled={saving} className="kd-btn kd-btn-primary shrink-0">
            Salvar
          </button>
        </form>
        {nameMsg && (
          <p role="status" className="mt-2 text-xs" style={{ color: 'var(--kd-muted)' }}>
            {nameMsg}
          </p>
        )}
      </section>

      <section className="kd-card p-4">
        <h2 className="kd-section-title mb-3 flex items-center gap-2">
          <KeyRound size={15} aria-hidden="true" />
          Trocar senha
        </h2>
        {passMsg && (
          <p role="status" className="mb-3 text-sm" style={{ color: 'var(--kd-accent)' }}>
            {passMsg}
          </p>
        )}
        {passError && (
          <div role="alert" className="kd-alert-error mb-3">
            {passError}
          </div>
        )}
        <form onSubmit={(event) => void handlePassword(event)} className="space-y-3">
          <label className="block text-sm">
            <span className="kd-label">Senha atual</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="kd-input"
            />
          </label>
          <label className="block text-sm">
            <span className="kd-label">Nova senha</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="kd-input"
            />
          </label>
          <label className="block text-sm">
            <span className="kd-label">Repita a nova senha</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="kd-input"
            />
          </label>
          <button type="submit" disabled={saving} className="kd-btn kd-btn-primary">
            {saving ? 'Salvando…' : 'Trocar senha'}
          </button>
        </form>
      </section>
    </div>
  );
}
