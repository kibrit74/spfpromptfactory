import type {
  AuthConfig,
  ContextPack,
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

export async function generatePrompt(task: string, contextPackId?: string) {
  return requestJson<{ prompt: string; prompt_id: string | null }>('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ task, context_pack_id: contextPackId || null }),
  });
}

export async function analyzePrompt(task: string, contextPackId?: string) {
  return requestJson<{ analysis: PromptAnalysis }>('/api/prompts/analyze', {
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
  return requestJson<{ prompt: string; version: PromptVersion; analysis: PromptAnalysis | null }>(
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
