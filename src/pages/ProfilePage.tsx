import {
  Check,
  Copy,
  Eye,
  Inbox,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { deletePrompt, getPrompts } from '../lib/api';
import type { PromptRecord, SessionUser } from '../lib/types';

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'SP'
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function truncate(value: string, limit = 100) {
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
}

export function ProfilePage({ user }: { user: SessionUser }) {
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [query, setQuery] = useState('');
  const [activePrompt, setActivePrompt] = useState<PromptRecord | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);

  useEffect(() => {
    getPrompts()
      .then((result) => setPrompts(result.prompts))
      .catch(() => setPrompts([]));
  }, []);

  const filteredPrompts = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    if (!lowered) return prompts;
    return prompts.filter(
      (prompt) =>
        prompt.task.toLowerCase().includes(lowered) ||
        prompt.generated_prompt.toLowerCase().includes(lowered),
    );
  }, [prompts, query]);

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthCount = prompts.filter((prompt) => {
    const createdAt = new Date(prompt.created_at);
    return createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear;
  }).length;
  const lastActivity = prompts[0] ? formatDate(prompts[0].created_at) : 'Yok';
  const avatarFallback = initials(user.name || 'Profil');

  async function handleCopyPrompt(prompt: PromptRecord) {
    await navigator.clipboard.writeText(prompt.generated_prompt);
    setCopyId(prompt.id);
    window.setTimeout(() => setCopyId((current) => (current === prompt.id ? null : current)), 1200);
  }

  async function handleDeletePrompt(id: string) {
    try {
      await deletePrompt(id);
      setPrompts((current) => current.filter((prompt) => prompt.id !== id));
      if (activePrompt?.id === id) {
        setActivePrompt(null);
      }
    } catch {
      // Keep UI stable; backend already returns guarded responses.
    }
  }

  return (
    <AppShell user={user}>
      <main className="shell">
        <section className="profile-header">
          <div className="profile-identity">
            <span className="profile-avatar-wrap">
              {user.avatar_url ? (
                <img className="profile-avatar" src={user.avatar_url} alt={user.name} />
              ) : (
                <span className="profile-avatar-fallback">{avatarFallback}</span>
              )}
            </span>
            <div>
              <h1 className="profile-heading">{user.name}</h1>
              <p className="profile-email">{user.email}</p>
            </div>
          </div>
          <Link className="btn btn-primary" to="/app">
            <Sparkles size={16} /> Prompt Üret
          </Link>
        </section>

        <section className="stats" aria-label="Profil istatistikleri">
          <div className="stat-card">
            <div className="stat-label">Toplam Prompt</div>
            <div className="stat-value">{prompts.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Bu Ay</div>
            <div className="stat-value">{monthCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Son Aktivite</div>
            <div className="stat-value stat-value-small">{lastActivity}</div>
          </div>
        </section>

        <section aria-label="Prompt Dashboard">
          <div className="dashboard-head">
            <h2>Kayıtlı Promptlarım</h2>
            <span className="badge">{filteredPrompts.length} prompt</span>
          </div>
          <div className="search-row">
            <label className="search-field">
              <Search size={16} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Promptlarda ara"
              />
            </label>
          </div>

          {filteredPrompts.length ? (
            <div className="prompt-grid">
              {filteredPrompts.map((prompt) => (
                <article className="prompt-card" key={prompt.id}>
                  <div>
                    <p className="prompt-task">{truncate(prompt.task)}</p>
                    <p className="prompt-date">{formatDate(prompt.created_at)}</p>
                  </div>
                  <div className="card-actions">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => setActivePrompt(prompt)}
                    >
                      <Eye size={16} /> Görüntüle
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => handleCopyPrompt(prompt)}
                    >
                      {copyId === prompt.id ? <Check size={16} /> : <Copy size={16} />}
                      {copyId === prompt.id ? 'Kopyalandı' : 'Kopyala'}
                    </button>
                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() => handleDeletePrompt(prompt.id)}
                    >
                      <Trash2 size={16} /> Sil
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state visible">
              <div>
                <div className="empty-icon">
                  <Inbox size={24} />
                </div>
                <h3 className="empty-title">Henüz prompt oluşturmadınız.</h3>
                <p className="subtitle subtitle-centered">
                  İlk promptunuzu oluşturduğunuzda burada listelenecek.
                </p>
                <Link className="btn btn-primary" to="/app">
                  <Sparkles size={16} /> İlk Promptumu Oluştur
                </Link>
              </div>
            </div>
          )}
        </section>
      </main>

      {activePrompt ? (
        <div className="modal open" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <section className="modal-panel">
            <div className="modal-head">
              <h3 id="modalTitle">Prompt</h3>
              <button className="btn btn-ghost" type="button" onClick={() => setActivePrompt(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">{activePrompt.generated_prompt}</div>
            <div className="modal-actions">
              <button className="btn btn-primary" type="button" onClick={() => handleCopyPrompt(activePrompt)}>
                {copyId === activePrompt.id ? <Check size={16} /> : <Copy size={16} />}
                {copyId === activePrompt.id ? 'Kopyalandı' : 'Kopyala'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setActivePrompt(null)}>
                Kapat
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
