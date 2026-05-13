import {
  Bookmark,
  LoaderCircle,
  MessageCircle,
  Play,
  Search,
  Send,
  Star,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import {
  createMarketComment,
  getMarketComments,
  getMarketItems,
  saveMarketItem,
  starMarketItem,
  useMarketItem,
} from '../lib/api';
import type { MarketComment, MarketItem, SessionUser } from '../lib/types';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(value));
}

function authorLabel(item: MarketItem) {
  return item.author_name || item.author_email || 'SPF kullanicisi';
}

export function MarketPage({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<MarketItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [activeItem, setActiveItem] = useState<MarketItem | null>(null);
  const [comments, setComments] = useState<MarketComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadMarket(nextQuery = query, nextCategory = category) {
    setLoading(true);
    setError(false);
    try {
      const result = await getMarketItems({ query: nextQuery.trim(), category: nextCategory });
      setItems(result.items);
      setCategories(result.categories);
      setStatus('');
    } catch (requestError) {
      setItems([]);
      setCategories([]);
      setError(true);
      setStatus(requestError instanceof Error ? requestError.message : 'Market yuklenemedi.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMarket('', '');
  }, []);

  useEffect(() => {
    if (!activeItem) {
      setComments([]);
      return;
    }
    getMarketComments(activeItem.id)
      .then((result) => setComments(result.comments))
      .catch(() => setComments([]));
  }, [activeItem]);

  const featured = useMemo(() => items.slice(0, 3), [items]);

  function replaceItem(nextItem: MarketItem) {
    setItems((current) =>
      current.map((item) => (item.id === nextItem.id ? { ...item, ...nextItem } : item)),
    );
    setActiveItem((current) => (current?.id === nextItem.id ? { ...current, ...nextItem } : current));
  }

  async function handleStar(item: MarketItem) {
    setSavingId(item.id);
    try {
      const result = await starMarketItem(item.id, !item.starred_by_user);
      replaceItem({
        ...item,
        ...result.item,
        starred_by_user: !item.starred_by_user,
        saved_by_user: item.saved_by_user,
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleSave(item: MarketItem) {
    setSavingId(item.id);
    try {
      const result = await saveMarketItem(item.id, !item.saved_by_user);
      replaceItem({
        ...item,
        ...result.item,
        saved_by_user: !item.saved_by_user,
        starred_by_user: item.starred_by_user,
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleUse(item: MarketItem) {
    setSavingId(item.id);
    setError(false);
    setStatus('Prompt ureticiye aktariliyor...');
    try {
      const result = await useMarketItem(item.id);
      window.localStorage.setItem(
        'spf_market_prompt',
        JSON.stringify({
          title: item.title,
          category: item.category,
          prompt: result.prompt,
        }),
      );
      navigate('/app');
    } catch (requestError) {
      setError(true);
      setStatus(requestError instanceof Error ? requestError.message : 'Prompt kullanilamadi.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleComment() {
    if (!activeItem || !commentBody.trim()) return;
    setSavingId(activeItem.id);
    try {
      const result = await createMarketComment(activeItem.id, commentBody.trim());
      setComments((current) => [result.comment, ...current]);
      replaceItem({ ...activeItem, ...result.item });
      setCommentBody('');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AppShell user={user}>
      <main className="shell">
        <section className="profile-header">
          <div>
            <p className="eyeline">Prompt Market</p>
            <h1 className="profile-heading">Hazir Prompt Kutuphanesi</h1>
            <p className="subtitle">
              Kullanicilarin paylastigi promptlari yildiz, yorum ve kategoriye gore secip kullanin.
            </p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={() => loadMarket()} disabled={loading}>
            {loading ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
            Yenile
          </button>
        </section>

        {status ? <p className={`status${error ? ' error' : ''}`}>{status}</p> : null}

        <section className="market-toolbar" aria-label="Market filtreleri">
          <label className="search-field">
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void loadMarket();
              }}
              placeholder="Prompt, aciklama veya kategori ara"
            />
          </label>
          <select
            className="select-field"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              void loadMarket(query, event.target.value);
            }}
          >
            <option value="">Tum kategoriler</option>
            {categories.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="button" onClick={() => loadMarket()}>
            <Search size={16} /> Ara
          </button>
        </section>

        {featured.length ? (
          <section className="market-featured" aria-label="En yuksek puanli promptlar">
            {featured.map((item) => (
              <article className="market-card featured" key={item.id}>
                <div className="market-card-head">
                  <span className="badge">{item.category}</span>
                  <span><Star size={14} /> {item.star_count}</span>
                </div>
                <h2>{item.title}</h2>
                <p>{item.description}</p>
                <small>{authorLabel(item)} / {formatDate(item.created_at)}</small>
              </article>
            ))}
          </section>
        ) : null}

        <section className="market-grid" aria-label="Prompt market listesi">
          {items.map((item) => (
            <article className="market-card" key={item.id}>
              <div className="market-card-head">
                <span className="badge">{item.category}</span>
                <small>{authorLabel(item)}</small>
              </div>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
              <div className="market-metrics" aria-label="Prompt etkilesimleri">
                <span><Star size={14} /> {item.star_count}</span>
                <span><MessageCircle size={14} /> {item.comment_count}</span>
                <span><Bookmark size={14} /> {item.save_count}</span>
                <span><Play size={14} /> {item.usage_count}</span>
              </div>
              <div className="card-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => handleUse(item)}
                  disabled={savingId === item.id}
                >
                  <Play size={16} /> Kullan
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => handleStar(item)}>
                  <Star size={16} fill={item.starred_by_user ? 'currentColor' : 'none'} />
                  {item.starred_by_user ? 'Yildizli' : 'Yildiz'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => handleSave(item)}>
                  <Bookmark size={16} fill={item.saved_by_user ? 'currentColor' : 'none'} />
                  {item.saved_by_user ? 'Kayitli' : 'Kaydet'}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setActiveItem(item)}>
                  <MessageCircle size={16} /> Yorum
                </button>
              </div>
            </article>
          ))}
        </section>

        {!loading && !items.length ? (
          <div className="empty-state visible">
            <div>
              <h3 className="empty-title">Market promptu bulunamadi.</h3>
              <p className="subtitle subtitle-centered">Profilinizden bir prompt paylasarak kutuphaneyi baslatin.</p>
            </div>
          </div>
        ) : null}
      </main>

      {activeItem ? (
        <div className="modal open" role="dialog" aria-modal="true" aria-labelledby="marketModalTitle">
          <section className="modal-panel">
            <div className="modal-head">
              <h3 id="marketModalTitle">{activeItem.title}</h3>
              <button className="btn btn-ghost" type="button" onClick={() => setActiveItem(null)}>
                Kapat
              </button>
            </div>
            <div className="modal-body market-comment-body">
              <p>{activeItem.description}</p>
              <div className="comment-compose">
                <textarea
                  className="compact-textarea"
                  rows={3}
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="Bu prompt hakkinda yorum yaz"
                />
                <button className="btn btn-primary" type="button" onClick={handleComment}>
                  <Send size={16} /> Yorum Gonder
                </button>
              </div>
              <div className="comment-list">
                {comments.map((comment) => (
                  <article className="comment-item" key={comment.id}>
                    <strong>{comment.user_name || comment.user_email || 'Kullanici'}</strong>
                    <p>{comment.body}</p>
                    <small>{formatDate(comment.created_at)}</small>
                  </article>
                ))}
                {!comments.length ? <p className="muted">Henuz yorum yok.</p> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
