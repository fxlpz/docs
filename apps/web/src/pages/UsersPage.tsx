import { type ManagedUser, userListResponseSchema, userRoleSchema } from '@krndocs/shared';
import { Pencil, ShieldAlert, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { PageHeader } from '../components/PageHeader.js';
import { UserAvatar } from '../components/UserAvatar.js';
import { ApiError, apiFetch, parseWith } from '../lib/api.js';

/**
 * Administração de usuários (`/app/usuarios`) — SÓ admin.
 * Criar contas (senha sempre provisória), trocar papel e ativar/desativar.
 * O backend impede auto-rebaixamento e auto-desativação.
 */
export function RequireAdmin({ children }: { children: React.JSX.Element }): React.JSX.Element {
  const { status, role } = useAuth();
  if (status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center" role="status">
        <span className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Carregando…
        </span>
      </div>
    );
  }
  if (status === 'anon') return <Navigate to="/login" replace />;
  if (role !== 'admin') {
    return (
      <div role="alert" className="mx-auto max-w-xl p-6 text-center">
        <p className="mb-1 flex items-center justify-center gap-2 text-sm font-medium">
          <ShieldAlert size={16} aria-hidden="true" style={{ color: '#c0392b' }} />
          <span style={{ color: '#c0392b' }}>Acesso restrito a administradores.</span>
        </p>
        <p className="text-sm" style={{ color: 'var(--kd-muted)' }}>
          Procure um administrador da equipe.
        </p>
      </div>
    );
  }
  return children;
}

const ROLES = userRoleSchema.options;

export function UsersPage(): React.JSX.Element {
  const { username: ownUsername } = useAuth();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', displayName: '', role: 'member', password: '' });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const load = useCallback(async () => {
    try {
      const json = await apiFetch('/api/users');
      const parsed = parseWith(userListResponseSchema, json);
      setUsers(parsed.users);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar usuários.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (action: () => Promise<unknown>, okMsg: string): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okMsg);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ação não concluída.');
    }
  };

  const changeRole = (user: ManagedUser, role: 'admin' | 'member'): void => {
    if (role === user.role) return;
    const verb = role === 'admin' ? 'promover' : 'rebaixar';
    if (
      !window.confirm(
        `${verb === 'promover' ? 'Promover' : 'Rebaixar'} "${user.username}" ${verb === 'promover' ? 'a administrador' : 'a usuário padrão'}?`,
      )
    ) {
      return;
    }
    void mutate(
      () =>
        apiFetch(`/api/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        }),
      `Papel de ${user.username} atualizado.`,
    );
  };

  const toggleActive = (user: ManagedUser): void => {
    const action = user.isActive ? 'desativar' : 'reativar';
    if (
      !window.confirm(
        user.isActive
          ? `Desativar "${user.username}"? Ele perde o acesso imediatamente (sessões revogadas).`
          : `Reativar "${user.username}"?`,
      )
    ) {
      return;
    }
    void mutate(
      () =>
        apiFetch(`/api/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !user.isActive }),
        }),
      `"${user.username}" ${action === 'desativar' ? 'desativado' : 'reativado'}.`,
    );
  };

  const removeUser = (user: ManagedUser): void => {
    if (
      !window.confirm(
        `Excluir "${user.username}"? A conta perde o acesso e some da lista (exclusão lógica, auditada).`,
      )
    ) {
      return;
    }
    void mutate(
      () => apiFetch(`/api/users/${user.id}`, { method: 'DELETE' }),
      `Conta "${user.username}" excluída.`,
    );
  };

  const saveName = (user: ManagedUser): void => {
    const value = editingName.trim();
    if (!value || value === user.displayName) {
      setEditingId(null);
      return;
    }
    setEditingId(null);
    void mutate(
      () =>
        apiFetch(`/api/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ displayName: value }),
        }),
      `Nome de "${user.username}" atualizado.`,
    );
  };

  const resetUserPassword = (user: ManagedUser): void => {
    if (resetPassword.length < 10) return;
    const value = resetPassword;
    setResetId(null);
    setResetPassword('');
    void mutate(
      () =>
        apiFetch(`/api/users/${user.id}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ password: value }),
        }),
      `Senha de "${user.username}" redefinida (provisória).`,
    );
  };

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setCreating(true);
    void (async () => {
      try {
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            username: form.username,
            displayName: form.displayName,
            role: form.role,
            password: form.password,
          }),
        });
        setForm({ username: '', displayName: '', role: 'member', password: '' });
        setError(null);
        setNotice(`Conta "${form.username}" criada com senha provisória.`);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao criar usuário.');
      } finally {
        setCreating(false);
      }
    })();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={<Users size={18} aria-hidden="true" />}
        title="Usuários"
        description="Contas da equipe. Senhas de contas novas nascem provisórias (troca no 1º acesso)."
      />

      {error && (
        <div role="alert" className="kd-alert-error mb-4">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm" style={{ color: 'var(--kd-accent)' }}>
          {notice}
        </p>
      )}

      <section className="kd-card mb-5 p-4">
        <h2 className="kd-section-title mb-3 flex items-center gap-2">
          <UserPlus size={15} aria-hidden="true" />
          Nova conta
        </h2>
        <form onSubmit={create} className="grid gap-2 sm:grid-cols-2">
          <input
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            placeholder="usuário (ex.: maria.silva)"
            aria-label="Usuário"
            required
            minLength={3}
            className="kd-input"
          />
          <input
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            placeholder="Nome de exibição"
            aria-label="Nome de exibição"
            required
            className="kd-input"
          />
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
            aria-label="Papel"
            className="kd-select"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role === 'admin' ? 'Administrador' : 'Usuário padrão'}
              </option>
            ))}
          </select>
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="Senha provisória (mín. 10)"
            aria-label="Senha provisória"
            required
            minLength={10}
            autoComplete="new-password"
            className="kd-input"
          />
          <button type="submit" disabled={creating} className="kd-btn kd-btn-primary sm:col-span-2">
            {creating ? 'Criando…' : 'Criar conta'}
          </button>
        </form>
      </section>

      <section className="kd-card p-4">
        <h2 className="kd-section-title mb-3">Contas</h2>
        {users === null ? (
          <p role="status" className="text-sm" style={{ color: 'var(--kd-muted)' }}>
            Carregando…
          </p>
        ) : (
          <ul className="space-y-2">
            {users.map((user) => {
              const self = user.username === ownUsername;
              return (
                <li
                  key={user.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-3 transition-colors"
                  style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-bg)' }}
                >
                  <UserAvatar
                    userId={user.id}
                    hasAvatar={user.hasAvatar}
                    name={user.displayName}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    {editingId === user.id ? (
                      <span className="flex items-center gap-1">
                        <input
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          aria-label={`Nome de exibição de ${user.username}`}
                          className="kd-input min-w-0 flex-1 !py-1 !text-xs"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveName(user);
                            if (event.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <button
                          type="button"
                          className="kd-btn kd-btn-primary shrink-0 !px-2 !py-1 !text-xs"
                          onClick={() => saveName(user)}
                        >
                          OK
                        </button>
                      </span>
                    ) : (
                      <p className="flex items-center gap-1 truncate text-sm font-medium">
                        <span className="truncate">
                          {user.displayName}{' '}
                          <span className="font-normal" style={{ color: 'var(--kd-muted)' }}>
                            @{user.username}
                          </span>
                        </span>
                        {self && <span className="kd-badge shrink-0">você</span>}
                        <button
                          type="button"
                          aria-label={`Editar nome de ${user.username}`}
                          title="Editar nome de exibição"
                          className="shrink-0 rounded px-1"
                          style={{ color: 'var(--kd-muted)' }}
                          onClick={() => {
                            setEditingId(user.id);
                            setEditingName(user.displayName);
                          }}
                        >
                          <Pencil size={12} aria-hidden="true" />
                        </button>
                      </p>
                    )}
                    <p
                      className="mt-0.5 flex flex-wrap items-center gap-1 text-xs"
                      style={{ color: 'var(--kd-muted)' }}
                    >
                      <span className="kd-badge">
                        {user.role === 'admin' ? 'Administrador' : 'Usuário padrão'}
                      </span>
                      {!user.isActive && (
                        <span className="kd-badge kd-badge-danger">desativado</span>
                      )}
                      {user.mustChangePassword && (
                        <span className="kd-badge kd-badge-accent">troca pendente</span>
                      )}
                      {user.lastLoginAt && (
                        <span>
                          último acesso {new Date(user.lastLoginAt).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </p>
                    {resetId === user.id ? (
                      <span className="mt-1 flex items-center gap-1">
                        <input
                          type="password"
                          value={resetPassword}
                          onChange={(event) => setResetPassword(event.target.value)}
                          placeholder="Nova senha provisória (mín. 10)"
                          aria-label={`Nova senha provisória para ${user.username}`}
                          autoComplete="new-password"
                          className="kd-input min-w-0 flex-1 !py-1 !text-xs"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') resetUserPassword(user);
                            if (event.key === 'Escape') {
                              setResetId(null);
                              setResetPassword('');
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="kd-btn kd-btn-primary shrink-0 !px-2 !py-1 !text-xs"
                          disabled={resetPassword.length < 10}
                          onClick={() => resetUserPassword(user)}
                        >
                          Definir
                        </button>
                        <button
                          type="button"
                          className="kd-btn kd-btn-ghost shrink-0 !px-2 !py-1 !text-xs"
                          onClick={() => {
                            setResetId(null);
                            setResetPassword('');
                          }}
                        >
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {!self && (
                          <button
                            type="button"
                            className="kd-btn kd-btn-ghost shrink-0 !px-2 !py-0.5 !text-xs"
                            onClick={() => {
                              setResetId(user.id);
                              setResetPassword('');
                            }}
                          >
                            Redefinir senha
                          </button>
                        )}
                        {!self && (
                          <button
                            type="button"
                            className="kd-btn kd-btn-danger-ghost shrink-0 !px-2 !py-0.5 !text-xs"
                            onClick={() => removeUser(user)}
                          >
                            Excluir
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <select
                    value={user.role}
                    disabled={self}
                    title={self ? 'Você não pode alterar seu próprio papel' : 'Alterar papel'}
                    onChange={(event) => changeRole(user, event.target.value as 'admin' | 'member')}
                    aria-label={`Papel de ${user.username}`}
                    className="kd-select w-auto py-1 text-xs disabled:opacity-50"
                  >
                    <option value="admin">Administrador</option>
                    <option value="member">Usuário padrão</option>
                  </select>
                  <button
                    type="button"
                    disabled={self}
                    title={
                      self
                        ? 'Você não pode desativar sua conta'
                        : user.isActive
                          ? 'Desativar'
                          : 'Reativar'
                    }
                    onClick={() => toggleActive(user)}
                    className={`kd-btn ${user.isActive ? 'kd-btn-danger-ghost' : 'kd-btn-ghost'}`}
                  >
                    {user.isActive ? 'Desativar' : 'Reativar'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
