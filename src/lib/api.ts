import type { AuthConfig, PromptRecord, SessionResponse } from './types';

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
    ) as Error & { status?: number };
    error.status = response.status;
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

export async function generatePrompt(task: string) {
  return requestJson<{ prompt: string; prompt_id: string | null }>('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ task }),
  });
}

export async function getPrompts() {
  return requestJson<{ prompts: PromptRecord[] }>('/api/prompts', { method: 'GET' });
}

export async function deletePrompt(id: string) {
  return requestJson<{ ok: true }>(`/api/prompts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
