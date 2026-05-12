import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Brand } from '../components/Brand';
import type { SessionUser } from '../lib/types';

export function LoginPage({
  loading,
  user,
}: {
  loading: boolean;
  user: SessionUser | null;
}) {
  if (!loading && user) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <main className="login-screen">
      <section className="login-card" aria-label="Giriş">
        <div className="login-brand">
          <Brand />
        </div>
        <h1>SPF Prompt Factory</h1>
        <p className="subtitle subtitle-centered">Derdini anlat, model talimatını al.</p>
        <a className="btn google-btn" href="/auth/google">
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.2 4 9.5 8.5 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.3 35.1 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.4 39.5 16.1 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4 5.6l6.2 5.2C37.1 39.1 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Google ile Giriş Yap
        </a>
        <p className="terms">Giriş yaparak kullanım şartlarını kabul etmiş olursunuz.</p>
      </section>
    </main>
  );
}
