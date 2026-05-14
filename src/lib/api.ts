import type {
  AdminCreditTransaction,
  AdminAuditLog,
  AdminOverview,
  AdminUserRow,
  Announcement,
  AuthConfig,
  Campaign,
  CreditPackage,
  CreditSummary,
  ContextPack,
  MarketComment,
  MarketItem,
  PromptAnalysis,
  PromptRecord,
  PromptVersion,
  SessionResponse,
} from './types';

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      typeof data?.error === 'string' ? data.error : 'Request failed',
    ) as Error & { status?: number; data?: unknown };
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data as T;
}

export async function getSession() {
  return requestJson<SessionResponse>('/api/auth/session', { method: 'GET' });
}

export async function getAuthConfig() {
  return requestJson<AuthConfig>('/api/auth/config', { method: 'GET' });
}

export async function getAdminOverview() {
  return requestJson<{
    overview: AdminOverview;
    recent_users: AdminUserRow[];
    recent_credit_transactions: AdminCreditTransaction[];
    announcements: Announcement[];
    campaigns: Campaign[];
    audit_logs: AdminAuditLog[];
  }>('/api/admin/overview', { method: 'GET' });
}

export async function getAdminUsers() {
  return requestJson<{ users: AdminUserRow[] }>('/api/admin/users', { method: 'GET' });
}

export async function adjustAdminUserCredits(id: string, delta: number, description: string) {
  return requestJson<{ user: AdminUserRow }>(`/api/admin/users/${encodeURIComponent(id)}/credits`, {
    method: 'POST',
    body: JSON.stringify({ delta, description }),
  });
}

export async function updateAdminUser(id: string, input: { is_admin: boolean }) {
  return requestJson<{ user: AdminUserRow }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function updateAdminUserControls(
  id: string,
  input: Partial<Pick<
    AdminUserRow,
    | 'is_admin'
    | 'is_blocked'
    | 'block_reason'
    | 'admin_notes'
    | 'daily_prompt_limit'
    | 'daily_revision_limit'
    | 'daily_analysis_limit'
  >>,
) {
  return requestJson<{ user: AdminUserRow }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function getActiveAnnouncements() {
  return requestJson<{ announcements: Announcement[] }>('/api/announcements', { method: 'GET' });
}

export async function createAnnouncement(input: {
  title: string;
  body: string;
  severity: string;
  status: string;
  starts_at?: string | null;
  ends_at?: string | null;
}) {
  return requestJson<{ announcement: Announcement }>('/api/admin/announcements', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAnnouncement(id: string, input: Partial<Announcement>) {
  return requestJson<{ announcement: Announcement }>(
    `/api/admin/announcements/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export async function deleteAnnouncement(id: string) {
  return requestJson<{ ok: true }>(`/api/admin/announcements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function createCampaign(input: {
  name: string;
  code: string;
  description: string;
  credit_bonus: number;
  max_redemptions?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active: boolean;
}) {
  return requestJson<{ campaign: Campaign }>('/api/admin/campaigns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCampaign(id: string, input: Partial<Campaign>) {
  return requestJson<{ campaign: Campaign }>(`/api/admin/campaigns/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function getCredits() {
  return requestJson<CreditSummary>('/api/credits', { method: 'GET' });
}

export async function startCreditCheckout(packageId: string) {
  return requestJson<
    CreditSummary & {
      package: CreditPackage;
      checkout_url: string | null;
      payment_required: boolean;
      message: string;
    }
  >('/api/credits/checkout', {
    method: 'POST',
    body: JSON.stringify({ package_id: packageId }),
  });
}

export async function generatePrompt(task: string, contextPackId?: string) {
  return requestJson<{
    prompt: string;
    prompt_id: string | null;
    credits_balance?: number;
    save_status?: 'saved' | 'failed';
    save_error?: string;
  }>('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ task, context_pack_id: contextPackId || null }),
  });
}

export async function analyzePrompt(task: string, contextPackId?: string) {
  return requestJson<{ analysis: PromptAnalysis; credits_balance?: number }>('/api/prompts/analyze', {
    method: 'POST',
    body: JSON.stringify({ task, context_pack_id: contextPackId || null }),
  });
}

export async function getPrompts() {
  return requestJson<{ prompts: PromptRecord[] }>('/api/prompts', { method: 'GET' });
}

export async function getPromptVersions(id: string) {
  return requestJson<{ prompt: PromptRecord; versions: PromptVersion[] }>(
    `/api/prompts/${encodeURIComponent(id)}/versions`,
    { method: 'GET' },
  );
}

export async function revisePrompt(id: string, revisionInstruction: string, contextPackId?: string) {
  return requestJson<{
    prompt: string;
    version: PromptVersion;
    analysis: PromptAnalysis | null;
    credits_balance?: number;
  }>(
    `/api/prompts/${encodeURIComponent(id)}/revise`,
    {
      method: 'POST',
      body: JSON.stringify({
        revision_instruction: revisionInstruction,
        context_pack_id: contextPackId || null,
      }),
    },
  );
}

export async function deletePrompt(id: string) {
  return requestJson<{ ok: true }>(`/api/prompts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getMarketItems(input: { query?: string; category?: string } = {}) {
  const params = new URLSearchParams();
  if (input.query) params.set('q', input.query);
  if (input.category) params.set('category', input.category);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return requestJson<{ items: MarketItem[]; categories: string[] }>(`/api/market${suffix}`, {
    method: 'GET',
  });
}

export async function sharePrompt(
  id: string,
  input: { title: string; description: string; category: string },
) {
  return requestJson<{ item: MarketItem }>(`/api/prompts/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function starMarketItem(id: string, starred: boolean) {
  return requestJson<{ item: MarketItem }>(`/api/market/${encodeURIComponent(id)}/star`, {
    method: 'POST',
    body: JSON.stringify({ starred }),
  });
}

export async function saveMarketItem(id: string, saved: boolean) {
  return requestJson<{ item: MarketItem }>(`/api/market/${encodeURIComponent(id)}/save`, {
    method: 'POST',
    body: JSON.stringify({ saved }),
  });
}

export async function getMarketComments(id: string) {
  return requestJson<{ comments: MarketComment[] }>(
    `/api/market/${encodeURIComponent(id)}/comments`,
    { method: 'GET' },
  );
}

export async function createMarketComment(id: string, body: string) {
  return requestJson<{ comment: MarketComment; item: MarketItem }>(
    `/api/market/${encodeURIComponent(id)}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
  );
}

export async function useMarketItem(id: string) {
  return requestJson<{ item: MarketItem; prompt: string }>(`/api/market/${encodeURIComponent(id)}/use`, {
    method: 'POST',
  });
}

export async function getContextPacks() {
  return requestJson<{ context_packs: ContextPack[] }>('/api/context-packs', { method: 'GET' });
}

export async function createContextPack(input: {
  name: string;
  description: string;
  content: string;
}) {
  return requestJson<{ context_pack: ContextPack }>('/api/context-packs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateContextPack(
  id: string,
  input: { name: string; description: string; content: string },
) {
  return requestJson<{ context_pack: ContextPack }>(
    `/api/context-packs/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export async function deleteContextPack(id: string) {
  return requestJson<{ ok: true }>(`/api/context-packs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
