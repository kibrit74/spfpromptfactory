import {
  Activity,
  Ban,
  CalendarDays,
  Coins,
  FileText,
  LoaderCircle,
  Megaphone,
  RefreshCw,
  Save,
  Shield,
  Ticket,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import {
  adjustAdminUserCredits,
  createAnnouncement,
  createCampaign,
  deleteAnnouncement,
  getAdminOverview,
  getAdminUsers,
  updateAdminUserControls,
  updateAnnouncement,
  updateAdminUser,
  updateCampaign,
} from '../lib/api';
import type {
  AdminAuditLog,
  AdminCreditTransaction,
  AdminOverview,
  AdminUserRow,
  Announcement,
  Campaign,
  SessionUser,
} from '../lib/types';

function formatDate(value: string | null) {
  if (!value) return 'Yok';
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDelta(delta: number) {
  return delta > 0 ? `+${delta}` : String(delta);
}

const emptyAnnouncementForm = {
  title: '',
  body: '',
  severity: 'info',
  status: 'active',
};

const emptyCampaignForm = {
  name: '',
  code: '',
  description: '',
  credit_bonus: '25',
  max_redemptions: '',
  is_active: true,
};

export function AdminPage({ user }: { user: SessionUser }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [transactions, setTransactions] = useState<AdminCreditTransaction[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [query, setQuery] = useState('');
  const [creditDelta, setCreditDelta] = useState<Record<string, string>>({});
  const [userEdits, setUserEdits] = useState<Record<string, {
    block_reason: string;
    admin_notes: string;
    daily_prompt_limit: string;
    daily_revision_limit: string;
    daily_analysis_limit: string;
  }>>({});
  const [announcementForm, setAnnouncementForm] = useState(emptyAnnouncementForm);
  const [campaignForm, setCampaignForm] = useState(emptyCampaignForm);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadAdminData() {
    setLoading(true);
    setError(false);
    try {
      const [overviewResult, usersResult] = await Promise.all([
        getAdminOverview(),
        getAdminUsers(),
      ]);
      setOverview(overviewResult.overview);
      const nextUsers = usersResult.users || [];
      setTransactions(overviewResult.recent_credit_transactions || []);
      setAnnouncements(overviewResult.announcements || []);
      setCampaigns(overviewResult.campaigns || []);
      setAuditLogs(overviewResult.audit_logs || []);
      setUsers(nextUsers);
      setUserEdits(Object.fromEntries(nextUsers.map((item) => [
        item.id,
        {
          block_reason: item.block_reason || '',
          admin_notes: item.admin_notes || '',
          daily_prompt_limit: item.daily_prompt_limit === null ? '' : String(item.daily_prompt_limit),
          daily_revision_limit: item.daily_revision_limit === null ? '' : String(item.daily_revision_limit),
          daily_analysis_limit: item.daily_analysis_limit === null ? '' : String(item.daily_analysis_limit),
        },
      ])));
      setStatus('');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Admin verisi yuklenemedi.';
      setError(true);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdminData();
  }, []);

  const filteredUsers = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    if (!lowered) return users;
    return users.filter((item) => {
      return (
        item.email.toLowerCase().includes(lowered) ||
        String(item.name || '').toLowerCase().includes(lowered)
      );
    });
  }, [query, users]);

  function replaceUser(nextUser: AdminUserRow) {
    setUsers((current) => current.map((item) => (item.id === nextUser.id ? nextUser : item)));
  }

  async function handleCreditChange(targetUser: AdminUserRow) {
    const delta = Number(creditDelta[targetUser.id]);
    if (!Number.isInteger(delta) || delta === 0) {
      setError(true);
      setStatus('Kredi degisimi sifir olmayan tam sayi olmali.');
      return;
    }

    setSavingId(targetUser.id);
    setError(false);
    setStatus('Kredi guncelleniyor...');
    try {
      const result = await adjustAdminUserCredits(
        targetUser.id,
        delta,
        `Admin kredi duzeltmesi: ${formatDelta(delta)} kredi`,
      );
      replaceUser(result.user);
      setCreditDelta((current) => ({ ...current, [targetUser.id]: '' }));
      setStatus(`${targetUser.email} icin kredi bakiyesi guncellendi.`);
      void loadAdminData();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Kredi guncellenemedi.';
      setError(true);
      setStatus(message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleAdminToggle(targetUser: AdminUserRow) {
    setSavingId(targetUser.id);
    setError(false);
    setStatus('Admin yetkisi guncelleniyor...');
    try {
      const result = await updateAdminUser(targetUser.id, { is_admin: !targetUser.is_admin });
      replaceUser(result.user);
      setStatus(`${targetUser.email} admin yetkisi guncellendi.`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Admin yetkisi guncellenemedi.';
      setError(true);
      setStatus(message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleUserControls(targetUser: AdminUserRow, nextBlocked = targetUser.is_blocked) {
    const edit = userEdits[targetUser.id] || {
      block_reason: '',
      admin_notes: '',
      daily_prompt_limit: '',
      daily_revision_limit: '',
      daily_analysis_limit: '',
    };
    setSavingId(targetUser.id);
    setError(false);
    setStatus('Kullanici kontrolleri guncelleniyor...');
    try {
      const result = await updateAdminUserControls(targetUser.id, {
        is_blocked: nextBlocked,
        block_reason: edit.block_reason,
        admin_notes: edit.admin_notes,
        daily_prompt_limit: edit.daily_prompt_limit === '' ? null : Number(edit.daily_prompt_limit),
        daily_revision_limit: edit.daily_revision_limit === '' ? null : Number(edit.daily_revision_limit),
        daily_analysis_limit: edit.daily_analysis_limit === '' ? null : Number(edit.daily_analysis_limit),
      });
      replaceUser(result.user);
      setStatus(`${targetUser.email} kontrolleri guncellendi.`);
      void loadAdminData();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Kullanici kontrolleri guncellenemedi.';
      setError(true);
      setStatus(message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreateAnnouncement() {
    if (!announcementForm.title.trim() || !announcementForm.body.trim()) {
      setError(true);
      setStatus('Duyuru basligi ve metni gerekli.');
      return;
    }
    setSavingId('announcement');
    setError(false);
    try {
      const result = await createAnnouncement(announcementForm);
      setAnnouncements((current) => [result.announcement, ...current]);
      setAnnouncementForm(emptyAnnouncementForm);
      setStatus('Duyuru yayina hazir.');
      void loadAdminData();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Duyuru olusturulamadi.';
      setError(true);
      setStatus(message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleAnnouncementStatus(item: Announcement, statusValue: string) {
    setSavingId(item.id);
    try {
      const result = await updateAnnouncement(item.id, { status: statusValue });
      setAnnouncements((current) => current.map((entry) => (entry.id === item.id ? result.announcement : entry)));
      setStatus('Duyuru durumu guncellendi.');
    } catch (requestError) {
      setError(true);
      setStatus(requestError instanceof Error ? requestError.message : 'Duyuru guncellenemedi.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteAnnouncement(id: string) {
    setSavingId(id);
    try {
      await deleteAnnouncement(id);
      setAnnouncements((current) => current.filter((item) => item.id !== id));
      setStatus('Duyuru silindi.');
    } catch (requestError) {
      setError(true);
      setStatus(requestError instanceof Error ? requestError.message : 'Duyuru silinemedi.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreateCampaign() {
    if (!campaignForm.name.trim() || !campaignForm.code.trim()) {
      setError(true);
      setStatus('Kampanya adi ve kodu gerekli.');
      return;
    }
    setSavingId('campaign');
    setError(false);
    try {
      const result = await createCampaign({
        name: campaignForm.name.trim(),
        code: campaignForm.code.trim(),
        description: campaignForm.description.trim(),
        credit_bonus: Number(campaignForm.credit_bonus || 0),
        max_redemptions: campaignForm.max_redemptions ? Number(campaignForm.max_redemptions) : null,
        is_active: campaignForm.is_active,
      });
      setCampaigns((current) => [result.campaign, ...current]);
      setCampaignForm(emptyCampaignForm);
      setStatus('Kampanya olusturuldu.');
      void loadAdminData();
    } catch (requestError) {
      setError(true);
      setStatus(requestError instanceof Error ? requestError.message : 'Kampanya olusturulamadi.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleCampaignToggle(item: Campaign) {
    setSavingId(item.id);
    try {
      const result = await updateCampaign(item.id, { is_active: !item.is_active });
      setCampaigns((current) => current.map((entry) => (entry.id === item.id ? result.campaign : entry)));
      setStatus('Kampanya durumu guncellendi.');
    } catch (requestError) {
      setError(true);
      setStatus(requestError instanceof Error ? requestError.message : 'Kampanya guncellenemedi.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AppShell user={user}>
      <main className="shell">
        <section className="profile-header">
          <div>
            <p className="eyeline">Admin Control Center</p>
            <h1 className="profile-heading">Platform Kontrol</h1>
            <p className="subtitle">
              Kullanicilar, krediler, prompt uretimi ve revizyon metrikleri tek ekranda.
            </p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={loadAdminData} disabled={loading}>
            {loading ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
            Yenile
          </button>
        </section>

        {status ? <p className={`status${error ? ' error' : ''}`}>{status}</p> : null}

        <section className="admin-stats" aria-label="Admin istatistikleri">
          <article className="stat-card">
            <div className="stat-label"><Users size={16} /> Kullanici</div>
            <div className="stat-value">{overview?.total_users ?? 0}</div>
          </article>
          <article className="stat-card">
            <div className="stat-label"><Coins size={16} /> Toplam Kredi</div>
            <div className="stat-value">{overview?.total_credit_balance ?? 0}</div>
          </article>
          <article className="stat-card">
            <div className="stat-label"><FileText size={16} /> Kayitli Prompt</div>
            <div className="stat-value">{overview?.total_prompts ?? 0}</div>
          </article>
          <article className="stat-card">
            <div className="stat-label"><CalendarDays size={16} /> Bugun Prompt</div>
            <div className="stat-value">{overview?.daily_prompts ?? 0}</div>
          </article>
          <article className="stat-card">
            <div className="stat-label"><RefreshCw size={16} /> Toplam Revize</div>
            <div className="stat-value">{overview?.total_revisions ?? 0}</div>
          </article>
          <article className="stat-card">
            <div className="stat-label"><RefreshCw size={16} /> Bugun Revize</div>
            <div className="stat-value">{overview?.daily_revisions ?? 0}</div>
          </article>
        </section>

        <section className="panel admin-panel" aria-label="Kullanici yonetimi">
          <div className="dashboard-head">
            <h2>Kullanici Kontrolu</h2>
            <label className="search-field admin-search">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="E-posta veya isim ara"
              />
            </label>
          </div>

          <div className="admin-table" role="table">
            <div className="admin-row admin-row-head" role="row">
              <span>Kullanici</span>
              <span>Kredi</span>
              <span>Prompt</span>
              <span>Revize</span>
              <span>Son Prompt</span>
              <span>Kontrol</span>
            </div>
            {filteredUsers.map((item) => (
              <div className="admin-row" role="row" key={item.id}>
                <span>
                  <strong>{item.email}</strong>
                  <small>
                    {item.name || 'Isimsiz'} {item.is_admin ? 'Admin' : ''} {item.is_blocked ? 'Bloklu' : ''}
                  </small>
                </span>
                <span>{item.credits_balance}</span>
                <span>{item.prompt_count}</span>
                <span>{item.revision_count}</span>
                <span>{formatDate(item.last_prompt_at)}</span>
                <span className="admin-actions">
                  <input
                    className="credit-input"
                    value={creditDelta[item.id] || ''}
                    onChange={(event) =>
                      setCreditDelta((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                    placeholder="+/- kredi"
                    inputMode="numeric"
                  />
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => handleCreditChange(item)}
                    disabled={savingId === item.id}
                  >
                    {savingId === item.id ? <LoaderCircle size={16} className="spin" /> : <Coins size={16} />}
                    Uygula
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => handleAdminToggle(item)}
                    disabled={savingId === item.id}
                  >
                    <Shield size={16} />
                    {item.is_admin ? 'Admin Kaldir' : 'Admin Yap'}
                  </button>
                  <button
                    className={item.is_blocked ? 'btn btn-primary' : 'btn btn-danger'}
                    type="button"
                    onClick={() => handleUserControls(item, !item.is_blocked)}
                    disabled={savingId === item.id}
                  >
                    <Ban size={16} />
                    {item.is_blocked ? 'Blok Kaldir' : 'Blokla'}
                  </button>
                  <input
                    className="limit-input"
                    value={userEdits[item.id]?.daily_prompt_limit || ''}
                    onChange={(event) =>
                      setUserEdits((current) => ({
                        ...current,
                        [item.id]: { ...current[item.id], daily_prompt_limit: event.target.value },
                      }))
                    }
                    placeholder="Prompt limit"
                    inputMode="numeric"
                  />
                  <input
                    className="limit-input"
                    value={userEdits[item.id]?.daily_revision_limit || ''}
                    onChange={(event) =>
                      setUserEdits((current) => ({
                        ...current,
                        [item.id]: { ...current[item.id], daily_revision_limit: event.target.value },
                      }))
                    }
                    placeholder="Revize limit"
                    inputMode="numeric"
                  />
                  <input
                    className="limit-input"
                    value={userEdits[item.id]?.daily_analysis_limit || ''}
                    onChange={(event) =>
                      setUserEdits((current) => ({
                        ...current,
                        [item.id]: { ...current[item.id], daily_analysis_limit: event.target.value },
                      }))
                    }
                    placeholder="Analiz limit"
                    inputMode="numeric"
                  />
                  <input
                    className="admin-note-input"
                    value={userEdits[item.id]?.block_reason || ''}
                    onChange={(event) =>
                      setUserEdits((current) => ({
                        ...current,
                        [item.id]: { ...current[item.id], block_reason: event.target.value },
                      }))
                    }
                    placeholder="Blok sebebi"
                  />
                  <input
                    className="admin-note-input"
                    value={userEdits[item.id]?.admin_notes || ''}
                    onChange={(event) =>
                      setUserEdits((current) => ({
                        ...current,
                        [item.id]: { ...current[item.id], admin_notes: event.target.value },
                      }))
                    }
                    placeholder="Admin notu"
                  />
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => handleUserControls(item, item.is_blocked)}
                    disabled={savingId === item.id}
                  >
                    <Save size={16} />
                    Limitleri Kaydet
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-management-grid">
          <section className="panel admin-panel" aria-label="Duyuru yonetimi">
            <div className="dashboard-head">
              <h2><Megaphone size={18} /> Duyurular</h2>
              <span className="badge">{announcements.length} duyuru</span>
            </div>
            <div className="admin-form-grid">
              <input
                className="text-field"
                value={announcementForm.title}
                onChange={(event) => setAnnouncementForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Duyuru basligi"
              />
              <select
                className="select-field"
                value={announcementForm.severity}
                onChange={(event) => setAnnouncementForm((current) => ({ ...current, severity: event.target.value }))}
              >
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="danger">Danger</option>
              </select>
              <textarea
                className="compact-textarea"
                rows={3}
                value={announcementForm.body}
                onChange={(event) => setAnnouncementForm((current) => ({ ...current, body: event.target.value }))}
                placeholder="Kullaniciya gosterilecek duyuru metni"
              />
              <button className="btn btn-primary" type="button" onClick={handleCreateAnnouncement}>
                <Megaphone size={16} /> Duyuru Olustur
              </button>
            </div>
            <div className="admin-list">
              {announcements.map((item) => (
                <article className="admin-list-item" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                    <small>{item.severity} / {item.status}</small>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => handleAnnouncementStatus(item, item.status === 'active' ? 'paused' : 'active')}
                    >
                      {item.status === 'active' ? 'Duraklat' : 'Aktif Et'}
                    </button>
                    <button className="btn btn-danger" type="button" onClick={() => handleDeleteAnnouncement(item.id)}>
                      <Trash2 size={16} /> Sil
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel admin-panel" aria-label="Kampanya yonetimi">
            <div className="dashboard-head">
              <h2><Ticket size={18} /> Kampanyalar</h2>
              <span className="badge">{campaigns.length} kampanya</span>
            </div>
            <div className="admin-form-grid">
              <input
                className="text-field"
                value={campaignForm.name}
                onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Kampanya adi"
              />
              <input
                className="text-field"
                value={campaignForm.code}
                onChange={(event) => setCampaignForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="Kod: LAUNCH50"
              />
              <input
                className="text-field"
                value={campaignForm.credit_bonus}
                onChange={(event) => setCampaignForm((current) => ({ ...current, credit_bonus: event.target.value }))}
                placeholder="Kredi bonusu"
                inputMode="numeric"
              />
              <input
                className="text-field"
                value={campaignForm.max_redemptions}
                onChange={(event) => setCampaignForm((current) => ({ ...current, max_redemptions: event.target.value }))}
                placeholder="Maks kullanim"
                inputMode="numeric"
              />
              <textarea
                className="compact-textarea"
                rows={3}
                value={campaignForm.description}
                onChange={(event) => setCampaignForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Kampanya aciklamasi"
              />
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={campaignForm.is_active}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, is_active: event.target.checked }))}
                />
                Aktif kampanya
              </label>
              <button className="btn btn-primary" type="button" onClick={handleCreateCampaign}>
                <Ticket size={16} /> Kampanya Olustur
              </button>
            </div>
            <div className="admin-list">
              {campaigns.map((item) => (
                <article className="admin-list-item" key={item.id}>
                  <div>
                    <strong>{item.name} / {item.code}</strong>
                    <p>{item.description || `${item.credit_bonus} kredi bonusu`}</p>
                    <small>{item.redeemed_count}/{item.max_redemptions || 'sinirsiz'} kullanim</small>
                  </div>
                  <button className="btn btn-ghost" type="button" onClick={() => handleCampaignToggle(item)}>
                    {item.is_active ? 'Duraklat' : 'Aktif Et'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </section>

        <section className="panel admin-panel" aria-label="Kredi hareketleri">
          <div className="dashboard-head">
            <h2>Son Kredi Hareketleri</h2>
            <span className="badge">{transactions.length} hareket</span>
          </div>
          <div className="credit-ledger">
            {transactions.map((transaction) => (
              <article className="ledger-item" key={transaction.id}>
                <strong>{formatDelta(transaction.delta)} kredi</strong>
                <span>{transaction.display_label || transaction.user_email || 'Bilinmeyen kullanici'}</span>
                <small>{transaction.description || transaction.reason || formatDate(transaction.created_at)}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel admin-panel" aria-label="Admin audit log">
          <div className="dashboard-head">
            <h2><Activity size={18} /> Admin Audit Log</h2>
            <span className="badge">{auditLogs.length} kayit</span>
          </div>
          <div className="credit-ledger">
            {auditLogs.map((item) => (
              <article className="ledger-item" key={item.id}>
                <strong>{item.action}</strong>
                <span>{item.target_type}</span>
                <small>{formatDate(item.created_at)}</small>
              </article>
            ))}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
