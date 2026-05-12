import { ChevronDown, LogOut, User } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from './Avatar';
import type { SessionUser } from '../lib/types';

export function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="user-menu">
      <button
        className="user-button"
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar
          name={user.name}
          avatarUrl={user.avatar_url}
          wrapperClassName="avatar-wrap"
          imageClassName="avatar"
          fallbackClassName="avatar-fallback"
        />
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
