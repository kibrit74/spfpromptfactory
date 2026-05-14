import {
  BadgeDollarSign,
  Check,
  Coins,
  Copy,
  FileText,
  Info,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Save,
  ScrollText,
  SearchCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import {
  analyzePrompt,
  createContextPack,
  deleteContextPack,
  generatePrompt,
  getContextPacks,
  getCredits,
  revisePrompt,
  startCreditCheckout,
  updateContextPack,
} from '../lib/api';
import type { AuthConfig, ContextPack, CreditSummary, PromptAnalysis, SessionUser } from '../lib/types';

const emptyPackForm = {
  name: '',
  description: '',
  content: '',
};

export function GeneratorPage({
  user,
  config,
}: {
  user: SessionUser;
  config: AuthConfig | null;
}) {
  const [task, setTask] = useState('');
  const [prompt, setPrompt] = useState('');
  const [promptId, setPromptId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PromptAnalysis | null>(null);
  const [contextPacks, setContextPacks] = useState<ContextPack[]>([]);
  const [credits, setCredits] = useState<CreditSummary | null>(null);
  const [selectedContextPackId, setSelectedContextPackId] = useState('');
  const [packForm, setPackForm] = useState(emptyPackForm);
  const [revisionInstruction, setRevisionInstruction] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [loadingAction, setLoadingAction] = useState<'generate' | 'analyze' | 'revise' | 'pack' | null>(null);
  const [copied, setCopied] = useState(false);

  const runtimeBlocked = Boolean(config && !config.geminiConfigured);
  const creditCosts = credits?.costs || { analyze: 1, generate: 5, revise: 5 };
  const canAnalyze = !credits || credits.balance >= creditCosts.analyze;
  const canGenerate = !credits || credits.balance >= creditCosts.generate;
  const canRevise = !credits || credits.balance >= creditCosts.revise;
  const selectedContextPack = useMemo(
    () => contextPacks.find((pack) => pack.id === selectedContextPackId) || null,
    [contextPacks, selectedContextPackId],
  );

  useEffect(() => {
    getContextPacks()
      .then((result) => setContextPacks(result.context_packs))
      .catch(() => setContextPacks([]));
    getCredits()
      .then((result) => setCredits(result))
      .catch(() => setCredits(null));

    const marketPrompt = window.localStorage.getItem('spf_market_prompt');
    if (marketPrompt) {
      try {
        const parsed = JSON.parse(marketPrompt) as { title?: string; prompt?: string };
        if (parsed.prompt) {
          setTask(parsed.title || '');
          setPrompt(parsed.prompt);
          setPromptId(null);
          setStatus('Market promptu yuklendi. Isterseniz kopyalayabilir veya yeni prompt uretebilirsiniz.');
        }
      } catch {
        // Ignore stale local storage payloads.
      } finally {
        window.localStorage.removeItem('spf_market_prompt');
      }
    }
  }, []);

  useEffect(() => {
    if (selectedContextPack) {
      setPackForm({
        name: selectedContextPack.name,
        description: selectedContextPack.description || '',
        content: selectedContextPack.content,
      });
    } else {
      setPackForm(emptyPackForm);
    }
  }, [selectedContextPack]);

  function requireTask() {
    if (!task.trim()) {
      setError(true);
      setStatus('Gorev metni gerekli.');
      return false;
    }
    return true;
  }

  async function handleGenerate() {
    if (!requireTask()) return;

    setLoadingAction('generate');
    setError(false);
    setStatus('Gemini promptu hazirlaniyor...');

    try {
      const result = await generatePrompt(task.trim(), selectedContextPackId);
      setPrompt(result.prompt);
      setPromptId(result.prompt_id);
      if (typeof result.credits_balance === 'number') {
        setCredits((current) => (current ? { ...current, balance: result.credits_balance } : current));
      }
      if (result.save_status === 'failed') {
        setError(true);
        setStatus(result.save_error || 'Prompt uretildi ama profilinize kaydedilemedi.');
      } else {
        setStatus(result.prompt_id ? 'Prompt uretildi ve profilinize kaydedildi.' : 'Prompt uretildi.');
      }
    } catch (requestError) {
      const data = (requestError as Error & {
        data?: { prompt?: string; save_status?: string; save_error?: string };
      }).data;
      if (data?.save_status === 'failed' && typeof data.prompt === 'string') {
        setPrompt(data.prompt);
        setPromptId(null);
        setError(true);
        setStatus(data.save_error || 'Prompt uretildi ama profilinize kaydedilemedi.');
        return;
      }
      const message =
        requestError instanceof Error ? requestError.message : 'Beklenmeyen hata olustu.';
      setError(true);
      setStatus(message);
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleAnalyze() {
    if (!requireTask()) return;

    setLoadingAction('analyze');
    setError(false);
    setStatus('Eksik baglam ve kalite kontrol ediliyor...');

    try {
      const result = await analyzePrompt(task.trim(), selectedContextPackId);
      setAnalysis(result.analysis);
      if (typeof result.credits_balance === 'number') {
        setCredits((current) => (current ? { ...current, balance: result.credits_balance } : current));
      }
      setStatus('Analiz hazir.');
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Analiz olusturulamadi.';
      setError(true);
      setStatus(message);
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleRevise() {
    if (!promptId || !prompt.trim()) {
      setError(true);
      setStatus('Revizyon icin once kayitli bir prompt uretin.');
      return;
    }
    if (!revisionInstruction.trim()) {
      setError(true);
      setStatus('Revizyon talimati gerekli.');
      return;
    }

    setLoadingAction('revise');
    setError(false);
    setStatus('Prompt revize ediliyor...');

    try {
      const result = await revisePrompt(promptId, revisionInstruction.trim(), selectedContextPackId);
      setPrompt(result.prompt);
      setAnalysis(result.analysis);
      if (typeof result.credits_balance === 'number') {
        setCredits((current) => (current ? { ...current, balance: result.credits_balance } : current));
      }
      setRevisionInstruction('');
      setStatus(`Revizyon v${result.version.version_number} olarak kaydedildi.`);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Revizyon olusturulamadi.';
      setError(true);
      setStatus(message);
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleSavePack() {
    const packContent = packForm.content.trim() || packForm.description.trim();

    if (!packForm.name.trim() || !packContent) {
      setError(true);
      setStatus('Context pack adi ve en az bir baglam metni gerekli.');
      return;
    }

    setLoadingAction('pack');
    setError(false);
    setStatus('Context pack kaydediliyor...');

    try {
      const input = {
        name: packForm.name.trim(),
        description: packForm.description.trim(),
        content: packContent,
      };
      const result = selectedContextPackId
        ? await updateContextPack(selectedContextPackId, input)
        : await createContextPack(input);

      setContextPacks((current) => {
        const exists = current.some((pack) => pack.id === result.context_pack.id);
        return exists
          ? current.map((pack) => (pack.id === result.context_pack.id ? result.context_pack : pack))
          : [result.context_pack, ...current];
      });
      setSelectedContextPackId(result.context_pack.id);
      setStatus('Context pack kaydedildi.');
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Context pack kaydedilemedi.';
      setError(true);
      setStatus(message);
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleDeletePack() {
    if (!selectedContextPackId) return;

    setLoadingAction('pack');
    setError(false);
    setStatus('Context pack siliniyor...');

    try {
      await deleteContextPack(selectedContextPackId);
      setContextPacks((current) => current.filter((pack) => pack.id !== selectedContextPackId));
      setSelectedContextPackId('');
      setPackForm(emptyPackForm);
      setStatus('Context pack silindi.');
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Context pack silinemedi.';
      setError(true);
      setStatus(message);
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleCopy() {
    if (!prompt.trim()) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function handlePackage(packageId: string) {
    setLoadingAction('pack');
    setError(false);
    setStatus('Kredi paketi kontrol ediliyor...');

    try {
      const result = await startCreditCheckout(packageId);
      setCredits({
        balance: result.balance,
        costs: result.costs,
        packages: result.packages,
      });
      setStatus(result.message);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Kredi paketi baslatilamadi.';
      setError(true);
      setStatus(message);
    } finally {
      setLoadingAction(null);
    }
  }

  function formatPackagePrice(priceCents: number) {
    if (priceCents === 0) return 'Free';
    return `$${(priceCents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }

  return (
    <AppShell user={user}>
      <main className="shell">
        <section className="hero-copy">
          <p className="eyeline">SPF Prompt Factory</p>
          <h1>Derdini anlat, sistem nokta atisi SPF prompt uretsin.</h1>
          <p className="subtitle">
            Gorevi yaz, baglam paketini sec, promptu analiz et ve surumlu revizyonlarla gelistir.
          </p>
          <div className="credit-strip" aria-label="Kredi bakiyesi">
            <div className="credit-balance">
              <Coins size={18} />
              <span>{credits ? `${credits.balance} kredi` : 'Kredi yukleniyor'}</span>
            </div>
            <span>Analiz {creditCosts.analyze} kredi</span>
            <span>Prompt {creditCosts.generate} kredi</span>
            <span>Revizyon {creditCosts.revise} kredi</span>
          </div>
        </section>

        {credits ? (
          <section className="pricing-panel" aria-label="Kredi paketleri">
            <div className="panel-head">
              <div className="panel-title">
                <BadgeDollarSign size={16} /> Kredi Paketleri
              </div>
              <span className="status">1 prompt = {creditCosts.generate} kredi</span>
            </div>
            <div className="pricing-grid">
              {credits.packages.map((pack) => (
                <article className="pricing-card" key={pack.id}>
                  <div>
                    <strong>{pack.name}</strong>
                    <p>{pack.description}</p>
                  </div>
                  <div className="package-meta">
                    <span>{pack.credits} kredi</span>
                    <strong>{formatPackagePrice(pack.price_cents)}</strong>
                  </div>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => handlePackage(pack.id)}
                    disabled={loadingAction === 'pack'}
                  >
                    {loadingAction === 'pack' ? <LoaderCircle size={16} className="spin" /> : <Coins size={16} />}
                    {pack.price_cents === 0 ? 'Aktif' : 'Paketi Sec'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="factory-grid" aria-label="SPF prompt uretici">
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <MessageSquareText size={16} /> Gorev
              </div>
            </div>
            <textarea
              rows={12}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="Orn: Bir hukuk PDF'inden savunma HTML'i ureten ajan promptu olustur."
            />

            <div className="context-builder">
              <div className="panel-head">
                <div className="panel-title">
                  <FileText size={16} /> Context Pack
                </div>
                <button className="btn btn-ghost" type="button" onClick={() => setSelectedContextPackId('')}>
                  Yeni
                </button>
              </div>
              <aside className="context-help" aria-label="Context Pack aciklamasi">
                <Info size={16} />
                <div>
                  <strong>Context Pack ne ise yarar?</strong>
                  <p>
                    Ayni proje, marka tonu veya sabit kurallari her promptta tekrar yazmamak icin kullanin.
                    Secili paket; uretim, analiz ve revizyonlarda goreve eklenir.
                  </p>
                </div>
              </aside>
              <select
                className="select-field"
                value={selectedContextPackId}
                onChange={(event) => setSelectedContextPackId(event.target.value)}
              >
                <option value="">Context pack yok</option>
                {contextPacks.map((pack) => (
                  <option value={pack.id} key={pack.id}>
                    {pack.name}
                  </option>
                ))}
              </select>
              <input
                className="text-field"
                value={packForm.name}
                onChange={(event) => setPackForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Paket adi"
              />
              <input
                className="text-field"
                value={packForm.description}
                onChange={(event) =>
                  setPackForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Kisa aciklama"
              />
              <textarea
                className="compact-textarea"
                rows={5}
                value={packForm.content}
                onChange={(event) =>
                  setPackForm((current) => ({ ...current, content: event.target.value }))
                }
                placeholder="Stack, kurallar, dosya beklentileri, marka tonu veya proje baglami."
              />
              <div className="actions">
                <button className="btn btn-ghost" type="button" onClick={handleSavePack}>
                  {loadingAction === 'pack' ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
                  Kaydet
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={handleDeletePack}
                  disabled={!selectedContextPackId || loadingAction === 'pack'}
                >
                  <Trash2 size={16} /> Sil
                </button>
              </div>
            </div>

            <div className="actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={handleAnalyze}
                disabled={Boolean(loadingAction) || runtimeBlocked || !canAnalyze}
              >
                {loadingAction === 'analyze' ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <SearchCheck size={16} />
                )}
                Eksik Baglami Analiz Et
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleGenerate}
                disabled={Boolean(loadingAction) || runtimeBlocked || !canGenerate}
              >
                {loadingAction === 'generate' ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Sparkles size={16} />
                )}
                Prompt Uret
              </button>
              <span className={`status${error ? ' error' : ''}`}>
                {runtimeBlocked
                  ? 'Gemini backend ayari eksik. Vertex veya API key yapilandirmasini tamamlayin.'
                  : status}
              </span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <ScrollText size={16} /> SPF Prompt
              </div>
              <button className="btn btn-ghost" type="button" onClick={handleCopy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Kopyalandi' : 'Kopyala'}
              </button>
            </div>
            <textarea
              rows={12}
              readOnly
              value={prompt}
              placeholder="Uretilen SPF prompt burada gorunecek."
            />

            <div className="revision-box">
              <div className="panel-title">
                <RefreshCw size={16} /> Prompt Revize
              </div>
              <textarea
                className="compact-textarea"
                rows={4}
                value={revisionInstruction}
                onChange={(event) => setRevisionInstruction(event.target.value)}
                placeholder="Orn: daha kisa yap, dosya bekleme kuralini guclendir, frontend odakli hale getir."
              />
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleRevise}
                disabled={Boolean(loadingAction) || !promptId || !canRevise}
              >
                {loadingAction === 'revise' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                Revize Et
              </button>
            </div>

            {analysis ? (
              <div className="analysis-panel">
                <div className="score-row">
                  <span>Kalite Skoru</span>
                  <strong>{analysis.quality_score}/100</strong>
                </div>
                <div className="analysis-section">
                  <h3>Eksik Baglam</h3>
                  {analysis.missing_context.length ? (
                    analysis.missing_context.map((item, index) => (
                      <article className="analysis-card" key={`${item.label || 'missing'}-${index}`}>
                        <strong>{item.label || 'Eksik bilgi'}</strong>
                        <p>{item.reason || item.question || 'Detay gerekli.'}</p>
                        {item.question ? <small>{item.question}</small> : null}
                      </article>
                    ))
                  ) : (
                    <p className="muted">Kritik eksik baglam bulunmadi.</p>
                  )}
                </div>
                <div className="analysis-section">
                  <h3>Kalite Bulgulari</h3>
                  {analysis.quality_findings.length ? (
                    <ul>
                      {analysis.quality_findings.map((finding) => (
                        <li key={finding}>{finding}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">Bulgu yok.</p>
                  )}
                </div>
                <div className="analysis-section">
                  <h3>Test Paketi</h3>
                  {analysis.test_cases.length ? (
                    analysis.test_cases.map((testCase, index) => (
                      <article className="analysis-card" key={`${testCase.name || 'test'}-${index}`}>
                        <strong>{testCase.name || 'Test'}</strong>
                        <p>{testCase.scenario || 'Senaryo belirtilmedi.'}</p>
                        <small>{testCase.expected || 'Beklenen sonuc belirtilmedi.'}</small>
                      </article>
                    ))
                  ) : (
                    <p className="muted">Test onerisi yok.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
