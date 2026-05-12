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

export type ContextPack = {
  id: string;
  name: string;
  description: string | null;
  content: string;
  created_at: string;
  updated_at: string;
};

export type PromptAnalysis = {
  missing_context: Array<{
    label?: string;
    reason?: string;
    question?: string;
  }>;
  quality_score: number;
  quality_findings: string[];
  test_cases: Array<{
    name?: string;
    scenario?: string;
    expected?: string;
  }>;
};

export type PromptRecord = {
  id: string;
  task: string;
  generated_prompt: string;
  created_at: string;
};

export type PromptVersion = {
  id: string;
  prompt_id: string;
  version_number: number;
  generated_prompt: string;
  revision_instruction: string | null;
  context_pack_snapshot: ContextPack | null;
  missing_context: PromptAnalysis['missing_context'];
  quality_report: {
    score?: number | null;
    findings?: string[];
  };
  test_package: PromptAnalysis['test_cases'];
  created_at: string;
};
