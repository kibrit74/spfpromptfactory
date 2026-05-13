import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getAuthConfig, getSession } from './lib/api';
import type { AuthConfig, SessionUser } from './lib/types';
import { AdminPage } from './pages/AdminPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { LoginPage } from './pages/LoginPage';
import { MarketPage } from './pages/MarketPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProfilePage } from './pages/ProfilePage';

function LoadingScreen() {
  return (
    <main className="shell shell-centered">
      <section className="panel panel-centered">
        <LoaderCircle size={24} className="spin" />
      </section>
    </main>
  );
}

export default function App() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRuntime() {
      try {
        const [session, authConfig] = await Promise.all([getSession(), getAuthConfig()]);
        if (cancelled) return;
        setUser(session.authenticated ? session.user : null);
        setConfig(authConfig);
      } catch {
        if (cancelled) return;
        setUser(null);
        setConfig(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRuntime();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage loading={loading} user={user} />} />
      <Route
        path="/app"
        element={user ? <GeneratorPage user={user} config={config} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/profile"
        element={user ? <ProfilePage user={user} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/market"
        element={user ? <MarketPage user={user} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/admin"
        element={
          user?.is_admin ? (
            <AdminPage user={user} />
          ) : (
            <Navigate to={user ? '/profile' : '/login'} replace />
          )
        }
      />
      <Route path="/" element={<Navigate to={user ? '/profile' : '/login'} replace />} />
      <Route path="*" element={<NotFoundPage user={user} />} />
    </Routes>
  );
}
