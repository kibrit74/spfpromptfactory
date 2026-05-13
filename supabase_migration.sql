CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  is_admin BOOLEAN DEFAULT FALSE NOT NULL,
  is_blocked BOOLEAN DEFAULT FALSE NOT NULL,
  block_reason TEXT DEFAULT '' NOT NULL,
  blocked_at TIMESTAMPTZ,
  daily_prompt_limit INTEGER,
  daily_revision_limit INTEGER,
  daily_analysis_limit INTEGER,
  admin_notes TEXT DEFAULT '' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS block_reason TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS daily_prompt_limit INTEGER;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS daily_revision_limit INTEGER;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS daily_analysis_limit INTEGER;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS admin_notes TEXT DEFAULT '' NOT NULL;

CREATE TABLE IF NOT EXISTS public.prompts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  generated_prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.context_packs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_id UUID REFERENCES public.prompts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  generated_prompt TEXT NOT NULL,
  revision_instruction TEXT,
  context_pack_snapshot JSONB,
  missing_context JSONB DEFAULT '[]'::jsonb NOT NULL,
  quality_report JSONB DEFAULT '{}'::jsonb NOT NULL,
  test_package JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (prompt_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  package_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT DEFAULT 'info' NOT NULL,
  status TEXT DEFAULT 'draft' NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '' NOT NULL,
  credit_bonus INTEGER DEFAULT 0 NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  max_redemptions INTEGER,
  redeemed_count INTEGER DEFAULT 0 NOT NULL,
  is_active BOOLEAN DEFAULT FALSE NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  details JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prompt_market_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_id UUID UNIQUE REFERENCES public.prompts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'Genel' NOT NULL,
  prompt_text TEXT NOT NULL,
  source_task TEXT,
  star_count INTEGER DEFAULT 0 NOT NULL,
  comment_count INTEGER DEFAULT 0 NOT NULL,
  save_count INTEGER DEFAULT 0 NOT NULL,
  usage_count INTEGER DEFAULT 0 NOT NULL,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prompt_market_stars (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_item_id UUID REFERENCES public.prompt_market_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (market_item_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.prompt_market_saves (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_item_id UUID REFERENCES public.prompt_market_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (market_item_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.prompt_market_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_item_id UUID REFERENCES public.prompt_market_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prompts_user_id_created_at_idx
  ON public.prompts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS context_packs_user_id_updated_at_idx
  ON public.context_packs (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS prompt_versions_prompt_id_version_number_idx
  ON public.prompt_versions (prompt_id, version_number DESC);

CREATE INDEX IF NOT EXISTS credit_transactions_user_id_created_at_idx
  ON public.credit_transactions (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_signup_bonus_uidx
  ON public.credit_transactions (user_id)
  WHERE reason = 'signup_bonus';

CREATE INDEX IF NOT EXISTS users_is_admin_idx
  ON public.users (is_admin)
  WHERE is_admin = TRUE;

CREATE INDEX IF NOT EXISTS users_is_blocked_idx
  ON public.users (is_blocked)
  WHERE is_blocked = TRUE;

CREATE INDEX IF NOT EXISTS announcements_status_window_idx
  ON public.announcements (status, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS campaigns_code_idx
  ON public.campaigns (code);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_idx
  ON public.admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS prompt_market_items_rank_idx
  ON public.prompt_market_items (star_count DESC, comment_count DESC, save_count DESC, created_at DESC)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS prompt_market_items_category_idx
  ON public.prompt_market_items (category)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS prompt_market_stars_item_idx
  ON public.prompt_market_stars (market_item_id);

CREATE INDEX IF NOT EXISTS prompt_market_saves_item_idx
  ON public.prompt_market_saves (market_item_id);

CREATE INDEX IF NOT EXISTS prompt_market_comments_item_created_at_idx
  ON public.prompt_market_comments (market_item_id, created_at DESC);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_market_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_market_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_market_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_market_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own data" ON public.users;
CREATE POLICY "Users can read own data" ON public.users
  FOR SELECT USING (google_id = current_setting('app.google_id', true));

DROP POLICY IF EXISTS "Users can read own prompts" ON public.prompts;
CREATE POLICY "Users can read own prompts" ON public.prompts
  FOR SELECT USING (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Users can manage own prompts" ON public.prompts;
CREATE POLICY "Users can manage own prompts" ON public.prompts
  FOR ALL USING (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ))
  WITH CHECK (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Users can manage own context packs" ON public.context_packs;
CREATE POLICY "Users can manage own context packs" ON public.context_packs
  FOR ALL USING (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ))
  WITH CHECK (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Users can read own prompt versions" ON public.prompt_versions;
CREATE POLICY "Users can read own prompt versions" ON public.prompt_versions
  FOR SELECT USING (prompt_id IN (
    SELECT prompts.id
    FROM public.prompts
    JOIN public.users ON users.id = prompts.user_id
    WHERE users.google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Users can manage own prompt versions" ON public.prompt_versions;
CREATE POLICY "Users can manage own prompt versions" ON public.prompt_versions
  FOR ALL USING (prompt_id IN (
    SELECT prompts.id
    FROM public.prompts
    JOIN public.users ON users.id = prompts.user_id
    WHERE users.google_id = current_setting('app.google_id', true)
  ))
  WITH CHECK (prompt_id IN (
    SELECT prompts.id
    FROM public.prompts
    JOIN public.users ON users.id = prompts.user_id
    WHERE users.google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Users can read own credit transactions" ON public.credit_transactions;
CREATE POLICY "Users can read own credit transactions" ON public.credit_transactions
  FOR SELECT USING (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Authenticated users can read active announcements" ON public.announcements;
CREATE POLICY "Authenticated users can read active announcements" ON public.announcements
  FOR SELECT USING (
    status = 'active'
    AND (starts_at IS NULL OR starts_at <= NOW())
    AND (ends_at IS NULL OR ends_at >= NOW())
  );

DROP POLICY IF EXISTS "Users can read active market prompts" ON public.prompt_market_items;
CREATE POLICY "Users can read active market prompts" ON public.prompt_market_items
  FOR SELECT USING (
    is_active = TRUE
    AND current_setting('app.google_id', true) <> ''
  );

DROP POLICY IF EXISTS "Users can manage own market prompts" ON public.prompt_market_items;
CREATE POLICY "Users can manage own market prompts" ON public.prompt_market_items
  FOR ALL USING (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ))
  WITH CHECK (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Users can manage own market stars" ON public.prompt_market_stars;
CREATE POLICY "Users can manage own market stars" ON public.prompt_market_stars
  FOR ALL USING (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ))
  WITH CHECK (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Users can manage own market saves" ON public.prompt_market_saves;
CREATE POLICY "Users can manage own market saves" ON public.prompt_market_saves
  FOR ALL USING (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ))
  WITH CHECK (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ));

DROP POLICY IF EXISTS "Users can read market comments" ON public.prompt_market_comments;
CREATE POLICY "Users can read market comments" ON public.prompt_market_comments
  FOR SELECT USING (
    current_setting('app.google_id', true) <> ''
    AND market_item_id IN (
      SELECT id FROM public.prompt_market_items WHERE is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "Users can manage own market comments" ON public.prompt_market_comments;
CREATE POLICY "Users can manage own market comments" ON public.prompt_market_comments
  FOR ALL USING (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ))
  WITH CHECK (user_id IN (
    SELECT id FROM public.users WHERE google_id = current_setting('app.google_id', true)
  ));
