import { ChevronDown, LogOut, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SessionUser } from '../lib/types';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'SP';
}

export function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const fallback = useMemo(() => initials(user.name || 'Profil'), [user.name]);

  return (
    <div className="user-menu">
      <button
        className="user-button"
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar-wrap">
          {user.avatar_url ? (
            <img className="avatar" src={user.avatar_url} alt={user.name} />
          ) : (
            <span className="avatar-fallback">{fallback}</span>
          )}
        </span>
        <span className="user-name">{user.name}</span>
        <ChevronDown size={16} />
      </button>
      <div className={`dropdown${open ? ' open' : ''}`}>
        <Link to="/profile" onClick={() => setOpen(false)}>
          <User size={16} /> Profilim
        </Link>
        <a href="/auth/logout">
          <LogOut size={16} /> Çıkış Yap
        </a>
      </div>
    </div>
  );
}
