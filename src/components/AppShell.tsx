import type { ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import type { SessionUser } from '../lib/types';
import { Brand } from './Brand';
import { UserMenu } from './UserMenu';

export function AppShell({
  user,
  children,
}: {
  user: SessionUser | null;
  children: ReactNode;
}) {
  return (
    <>
      <header className="navbar navbar-solid">
        <div className="nav-inner">
          <Brand />
          <nav className="nav-links" aria-label="Ana menü">
            <NavLink to="/app">Üretici</NavLink>
            <NavLink to="/profile">Profil</NavLink>
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
      {children}
    </>
  );
}
