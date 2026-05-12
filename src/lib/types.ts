export type SessionUser = {
  id: string | null;
  email: string;
  name: string;
  avatar_url: string;
};

export type SessionResponse = {
  authenticated: boolean;
  user: SessionUser | null;
};

export type AuthConfig = {
  googleOAuthConfigured: boolean;
  supabaseConfigured: boolean;
  geminiConfigured: boolean;
  callbackUrl: string;
};

export type PromptRecord = {
  id: string;
  task: string;
  generated_prompt: string;
  created_at: string;
};
