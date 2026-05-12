import { useEffect, useMemo, useState } from 'react';

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'SP'
  );
}

type AvatarProps = {
  name: string;
  avatarUrl?: string | null;
  wrapperClassName: string;
  imageClassName: string;
  fallbackClassName: string;
};

export function Avatar({
  name,
  avatarUrl,
  wrapperClassName,
  imageClassName,
  fallbackClassName,
}: AvatarProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const fallback = useMemo(() => initials(name || 'Profil'), [name]);
  const canShowImage = Boolean(avatarUrl && !loadFailed);

  useEffect(() => {
    setLoadFailed(false);
  }, [avatarUrl]);

  return (
    <span className={wrapperClassName}>
      {canShowImage ? (
        <img
          className={imageClassName}
          src={avatarUrl || ''}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <span className={fallbackClassName}>{fallback}</span>
      )}
    </span>
  );
}
