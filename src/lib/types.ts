export type SessionUser = {
  id: string | null;
  email: string;
  name: string;
  avatar_url: string;
  is_admin?: boolean;
  is_blocked?: boolean;
  block_reason?: string;
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

export type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  currency: string;
  description: string;
};

export type CreditSummary = {
  balance: number;
  costs: {
    analyze: number;
    generate: number;
    revise: number;
  };
  packages: CreditPackage[];
};

export type AdminOverview = {
  total_users: number;
  total_prompts: number;
  total_revisions: number;
  daily_prompts: number;
  daily_revisions: number;
  total_credit_balance: number;
  total_credits_spent: number;
  total_credits_added: number;
};

export type AdminUserRow = {
  id: string;
  google_id?: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login: string | null;
  is_admin: boolean;
  is_blocked: boolean;
  block_reason: string;
  blocked_at: string | null;
  daily_prompt_limit: number | null;
  daily_revision_limit: number | null;
  daily_analysis_limit: number | null;
  admin_notes: string;
  credits_balance: number;
  prompt_count: number;
  revision_count: number;
  last_prompt_at: string | null;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'success' | 'warning' | 'danger' | string;
  status: 'draft' | 'active' | 'paused' | string;
  starts_at: string | null;
  ends_at: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string;
};

export type Campaign = {
  id: string;
  name: string;
  code: string;
  description: string;
  credit_bonus: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redeemed_count: number;
  is_active: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at?: string;
};

export type AdminAuditLog = {
  id: string;
  admin_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type AdminCreditTransaction = {
  id: string;
  user_id: string;
  user_email?: string | null;
  user_name?: string | null;
  display_label?: string | null;
  delta: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  package_id: string | null;
  description: string | null;
  created_at: string;
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

export type MarketItem = {
  id: string;
  prompt_id: string | null;
  user_id: string;
  title: string;
  description: string;
  category: string;
  prompt_text: string;
  source_task: string | null;
  star_count: number;
  comment_count: number;
  save_count: number;
  usage_count: number;
  starred_by_user?: boolean;
  saved_by_user?: boolean;
  author_name?: string | null;
  author_email?: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketComment = {
  id: string;
  market_item_id: string;
  user_id: string;
  body: string;
  user_name?: string | null;
  user_email?: string | null;
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
