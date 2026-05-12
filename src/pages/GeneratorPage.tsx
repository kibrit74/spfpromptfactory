import { Check, Copy, LoaderCircle, MessageSquareText, ScrollText, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { generatePrompt } from '../lib/api';
import type { AuthConfig, SessionUser } from '../lib/types';

export function GeneratorPage({
  user,
  config,
}: {
  user: SessionUser;
  config: AuthConfig | null;
}) {
  const [task, setTask] = useState('');
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const runtimeBlocked = Boolean(config && !config.geminiConfigured);

  async function handleGenerate() {
    if (!task.trim()) {
      setError(true);
      setStatus('Görev metni gerekli.');
      return;
    }

    setLoading(true);
    setError(false);
    setStatus('Gemini promptu hazırlanıyor...');

    try {
      const result = await generatePrompt(task.trim());
      setPrompt(result.prompt);
      setStatus(result.prompt_id ? 'Prompt üretildi ve profilinize kaydedildi.' : 'Prompt üretildi.');
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Beklenmeyen hata oluştu.';
      setError(true);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!prompt.trim()) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <AppShell user={user}>
      <main className="shell">
        <section className="hero-copy">
          <p className="eyeline">SPF Prompt Factory</p>
          <h1>Derdini anlat, sistem nokta atışı SPF prompt üretsin.</h1>
          <p className="subtitle">
            Görevi yaz, Gemini 2.5 Pro ile yapılandırılmış, çalıştırılabilir bir SPF
            prompt al. Ürettiğin promptlar profilinde saklanır.
          </p>
        </section>

        <section className="factory-grid" aria-label="SPF prompt üretici">
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <MessageSquareText size={16} /> Görev
              </div>
            </div>
            <textarea
              rows={15}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="Örn: Bir hukuk PDF'inden savunma HTML'i üreten ajan promptu oluştur."
            />
            <div className="actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleGenerate}
                disabled={loading || runtimeBlocked}
              >
                {loading ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
                {loading ? 'Üretiliyor' : 'Prompt Üret'}
              </button>
              <span className={`status${error ? ' error' : ''}`}>
                {runtimeBlocked
                  ? 'Gemini backend ayarı eksik. Vertex veya API key yapılandırmasını tamamlayın.'
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
                {copied ? 'Kopyalandı' : 'Kopyala'}
              </button>
            </div>
            <textarea
              rows={15}
              readOnly
              value={prompt}
              placeholder="Üretilen SPF prompt burada görünecek."
            />
          </div>
        </section>
      </main>
    </AppShell>
  );
}
