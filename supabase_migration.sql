CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS prompts_user_id_created_at_idx
  ON public.prompts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS context_packs_user_id_updated_at_idx
  ON public.context_packs (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS prompt_versions_prompt_id_version_number_idx
  ON public.prompt_versions (prompt_id, version_number DESC);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

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
