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

ALTER TABLE public.prompt_market_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_market_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_market_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_market_comments ENABLE ROW LEVEL SECURITY;

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
