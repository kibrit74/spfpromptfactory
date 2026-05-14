(function () {
  function escapeAttribute(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getInitials(name) {
    return (
      String(name || 'Profil')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => (part[0] ? part[0].toUpperCase() : ''))
        .join('') || 'SP'
    );
  }

  function renderProfileCta(user) {
    const name = user?.name || 'Profil';
    const avatarUrl = user?.avatar_url || '';
    const initials = getInitials(name);
    const hiddenImage = avatarUrl ? '' : ' hidden';
    const hiddenFallback = avatarUrl ? ' hidden' : '';

    return `
      <span class="profile-cta-avatar-wrap">
        <img class="profile-cta-avatar" src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(name)}"${hiddenImage} referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false;">
        <span class="profile-cta-fallback"${hiddenFallback}>${escapeHtml(initials)}</span>
      </span>
      <span class="profile-cta-name">${escapeHtml(name)}</span>
      <i data-lucide="chevron-down" class="profile-cta-chevron" style="width: 18px; height: 18px;"></i>
    `;
  }

  async function syncAuthCtas() {
    const ctas = document.querySelectorAll('[data-auth-cta="nav-profile"]');
    if (!ctas.length) return;

    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      if (!response.ok) return;

      const session = await response.json();
      if (!session.authenticated || !session.user) return;

      ctas.forEach((cta) => {
        cta.href = '/profile';
        cta.className = 'profile-cta';
        cta.innerHTML = renderProfileCta(session.user);
      });

      if (window.lucide?.createIcons) {
        window.lucide.createIcons();
      }
    } catch {
      // Keep the default CTA when auth state is unavailable.
    }
  }

  window.SpfAuthUi = {
    getInitials,
    renderProfileCta,
    syncAuthCtas,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncAuthCtas, { once: true });
  } else {
    syncAuthCtas();
  }
})();
