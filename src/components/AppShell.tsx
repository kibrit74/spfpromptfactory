import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { LogIn, Megaphone, X } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { getActiveAnnouncements } from '../lib/api';
import type { Announcement, SessionUser } from '../lib/types';
import { Brand } from './Brand';
import { UserMenu } from './UserMenu';

export function AppShell({
  user,
  children,
}: {
  user: SessionUser | null;
  children: ReactNode;
}) {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!user) {
      setAnnouncement(null);
      return;
    }
    getActiveAnnouncements()
      .then((result) => setAnnouncement(result.announcements[0] || null))
      .catch(() => setAnnouncement(null));
  }, [user]);

  return (
    <>
      <header className="navbar navbar-solid">
        <div className="nav-inner">
          <Brand />
          <nav className="nav-links" aria-label="Ana menü">
            <NavLink to="/app">Üretici</NavLink>
            <NavLink to="/market">Market</NavLink>
            <NavLink to="/profile">Profil</NavLink>
            {user?.is_admin ? <NavLink to="/admin">Admin</NavLink> : null}
          </nav>
          <div className="nav-actions">
            {user ? (
              <UserMenu user={user} />
            ) : (
              <Link className="btn btn-primary" to="/login">
                <LogIn size={16} /> Giriş Yap
              </Link>
            )}
          </div>
        </div>
      </header>
      {announcement ? (
        <aside className={`announcement-banner ${announcement.severity}`} role="status">
          <Megaphone size={16} />
          <div>
            <strong>{announcement.title}</strong>
            <span>{announcement.body}</span>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Duyuruyu kapat"
            onClick={() => setAnnouncement(null)}
          >
            <X size={16} />
          </button>
        </aside>
      ) : null}
      {children}
    </>
  );
}
