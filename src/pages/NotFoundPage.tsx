import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import type { SessionUser } from '../lib/types';

export function NotFoundPage({ user }: { user: SessionUser | null }) {
  return (
    <AppShell user={user}>
      <main className="shell shell-centered">
        <section className="panel panel-centered">
          <h1>Sayfa bulunamadı</h1>
          <p className="subtitle">
            İstediğiniz yüzey burada yok. Üretici veya profil sayfasına geri dönün.
          </p>
          <div className="actions actions-centered">
            <Link className="btn btn-primary" to={user ? '/app' : '/login'}>
              Devam Et
            </Link>
            <a className="btn btn-ghost" href="/">
              Landing
            </a>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
