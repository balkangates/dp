-- =====================================================================
-- DEALER CORE SYSTEM (MASTER) — supabase_migration_v3_dealer_core.sql
-- =====================================================================
-- Run AFTER supabase_migration_v1_tables.sql and v2_payments.sql.
-- Implements, on top of the existing stores/store_products/store_orders
-- schema, every rule from the "SYSTEM FINALIZATION — DEALER CORE SYSTEM"
-- spec:
--   1. Passive dealer monthly scoring + status escalation
--   2. Product selection from an approved master catalog + 20% category rule
--   3. Mandatory live-recorded video per selected product
--   4. Live-stream day/hour compliance tracking
--   5. Real order flow only (no simulation) — enforced at the DB layer,
--      simulated feeds are simply not backed by any table here
--   6. Offline-mode fallback video is just product_videos, reused
--   7. dealer_status (ACTIVE / WARNING / INACTIVE / SUSPENDED) incl. login lock
--
-- Nothing here breaks existing rows: every ALTER is additive with safe
-- defaults, every new table is independent, every trigger only fires on
-- the tables it's attached to.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 0. CONFIG — reuse the existing platform_settings key/value table so
--    thresholds are tunable from the admin panel without a redeploy.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.platform_settings (key, value, description) VALUES
  ('dealer_min_category_selection_pct', 0.20, 'Bir kategorinin AKTİF sayılması için bayinin o kategorideki ürünlerin en az bu oranını seçmesi gerekir (0.20 = %20).'),
  ('dealer_low_sales_threshold',        5,    'Bu adedin altındaki aylık satış "düşük satış" sayılır ve iyileştirme önerileri gösterilir.'),
  ('dealer_required_live_days',         20,   'Aylık zorunlu canlı yayın gün sayısı.'),
  ('dealer_required_live_hours',        4,    'Canlı yayın oturumu başına zorunlu minimum saat.')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 1. MASTER CATALOG — the pool suppliers/admins approve products into.
--    Dealers may ONLY sell what's in here (via store_products below);
--    they cannot free-type a product into existence anymore.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.catalog_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  image_url text,
  unit text NOT NULL DEFAULT 'gr',
  unit_size numeric NOT NULL DEFAULT 500,
  suggested_price numeric CHECK (suggested_price IS NULL OR suggested_price >= 0),
  supplier_id uuid,
  is_approved boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT catalog_products_pkey PRIMARY KEY (id),
  CONSTRAINT catalog_products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT catalog_products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_category ON public.catalog_products(category_id) WHERE is_approved;

-- ─────────────────────────────────────────────────────────────────────
-- 2. store_products — link each dealer selection back to the master
--    catalog. category_id is denormalized for fast category-ratio math.
--    has_video is a maintained cache of "does this selection have >=1
--    live-recorded video", so enforcement doesn't need a join everywhere.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products(id),
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id),
  ADD COLUMN IF NOT EXISTS has_video boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_store_products_store_category ON public.store_products(store_id, category_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. VIDEO CONTENT — one row per uploaded / live-recorded presentation.
--    "minimum 1 live presentation video" per selected product; the
--    recording is also what plays automatically in OFFLINE MODE.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_videos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  store_product_id uuid NOT NULL,
  video_url text NOT NULL,
  source text NOT NULL DEFAULT 'live_recording' CHECK (source = ANY (ARRAY['live_recording'::text, 'upload'::text])),
  duration_seconds integer,
  live_session_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT product_videos_pkey PRIMARY KEY (id),
  CONSTRAINT product_videos_store_product_id_fkey FOREIGN KEY (store_product_id) REFERENCES public.store_products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_product_videos_store_product ON public.product_videos(store_product_id);

-- Keep store_products.has_video in sync automatically.
CREATE OR REPLACE FUNCTION public.sync_store_product_has_video()
RETURNS trigger AS $$
DECLARE
  target_id uuid := COALESCE(NEW.store_product_id, OLD.store_product_id);
BEGIN
  UPDATE public.store_products sp
  SET has_video = EXISTS (SELECT 1 FROM public.product_videos v WHERE v.store_product_id = target_id)
  WHERE sp.id = target_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_has_video ON public.product_videos;
CREATE TRIGGER trg_sync_has_video
AFTER INSERT OR DELETE ON public.product_videos
FOR EACH ROW EXECUTE FUNCTION public.sync_store_product_has_video();

-- ENFORCEMENT: a store_product cannot be activated (shown live / sold)
-- without at least one video. "IF product has NO video: cannot be shown
-- in live, cannot be sold."
CREATE OR REPLACE FUNCTION public.enforce_video_before_active()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_active AND NOT NEW.has_video THEN
    RAISE EXCEPTION 'DEALER_RULE_NO_VIDEO: Bu ürün için en az 1 canlı sunum videosu yüklenmeden aktif/satışa açık hale getirilemez.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_video_before_active ON public.store_products;
CREATE TRIGGER trg_enforce_video_before_active
BEFORE INSERT OR UPDATE OF is_active, has_video ON public.store_products
FOR EACH ROW EXECUTE FUNCTION public.enforce_video_before_active();

-- ─────────────────────────────────────────────────────────────────────
-- 4. CATEGORY RULE — a store's category is only ACTIVE once the dealer
--    has selected >= dealer_min_category_selection_pct of that
--    category's total catalog products. Recomputed on every
--    store_products change via trigger (kept a real table, not a view,
--    so it's cheap to read from the dashboard and easy to index).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_category_status (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  category_id uuid NOT NULL,
  total_products integer NOT NULL DEFAULT 0,
  selected_products integer NOT NULL DEFAULT 0,
  selection_ratio numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT store_category_status_pkey PRIMARY KEY (id),
  CONSTRAINT store_category_status_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE,
  CONSTRAINT store_category_status_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT store_category_status_unique UNIQUE (store_id, category_id)
);

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS dealer_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (dealer_status = ANY (ARRAY['ACTIVE'::text, 'WARNING'::text, 'INACTIVE'::text, 'SUSPENDED'::text])),
  ADD COLUMN IF NOT EXISTS login_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dashboard_locked boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS suspended_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS penalty_score numeric NOT NULL DEFAULT 0;

-- Recompute every category the store touches. Also flips
-- stores.dashboard_locked: spec requires >= 1 ACTIVE category with a
-- valid selection, otherwise "dashboard locked, cannot go live".
CREATE OR REPLACE FUNCTION public.refresh_store_category_status(p_store_id uuid)
RETURNS void AS $$
DECLARE
  min_pct numeric := COALESCE((SELECT value FROM public.platform_settings WHERE key = 'dealer_min_category_selection_pct'), 0.20);
  has_active boolean;
BEGIN
  -- Upsert a row per category the dealer has ANY selection in.
  INSERT INTO public.store_category_status (store_id, category_id, total_products, selected_products, selection_ratio, is_active, updated_at)
  SELECT
    p_store_id,
    cp_all.category_id,
    cp_all.total_products,
    COALESCE(sel.selected_products, 0),
    CASE WHEN cp_all.total_products > 0
         THEN COALESCE(sel.selected_products, 0)::numeric / cp_all.total_products
         ELSE 0 END,
    CASE WHEN cp_all.total_products > 0
         THEN (COALESCE(sel.selected_products, 0)::numeric / cp_all.total_products) >= min_pct
         ELSE false END,
    now()
  FROM (
    SELECT category_id, count(*) AS total_products
    FROM public.catalog_products
    WHERE is_approved
    GROUP BY category_id
  ) cp_all
  LEFT JOIN (
    SELECT category_id, count(*) AS selected_products
    FROM public.store_products
    WHERE store_id = p_store_id AND category_id IS NOT NULL
    GROUP BY category_id
  ) sel ON sel.category_id = cp_all.category_id
  WHERE cp_all.category_id IN (
    SELECT DISTINCT category_id FROM public.store_products WHERE store_id = p_store_id AND category_id IS NOT NULL
  )
  ON CONFLICT (store_id, category_id) DO UPDATE
    SET total_products = EXCLUDED.total_products,
        selected_products = EXCLUDED.selected_products,
        selection_ratio = EXCLUDED.selection_ratio,
        is_active = EXCLUDED.is_active,
        updated_at = now();

  SELECT EXISTS (
    SELECT 1 FROM public.store_category_status
    WHERE store_id = p_store_id AND is_active
  ) INTO has_active;

  UPDATE public.stores SET dashboard_locked = NOT has_active WHERE id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_refresh_store_category_status()
RETURNS trigger AS $$
BEGIN
  PERFORM public.refresh_store_category_status(COALESCE(NEW.store_id, OLD.store_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_store_products_category_status ON public.store_products;
CREATE TRIGGER trg_store_products_category_status
AFTER INSERT OR UPDATE OF category_id, is_active OR DELETE ON public.store_products
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_store_category_status();

-- ─────────────────────────────────────────────────────────────────────
-- 5. LIVE STREAM TRACKING — real start/stop timestamps, no fake viewer
--    ticking. Used both to gate "go live" and to score the monthly
--    20-days / 4-hours-per-session requirement.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.live_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  duration_minutes integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT live_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT live_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_store_started ON public.live_sessions(store_id, started_at);

-- Only one open (ended_at IS NULL) session per store at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_sessions_one_open_per_store
  ON public.live_sessions(store_id) WHERE ended_at IS NULL;

-- Can this store go live right now? Gates both the "Canlıya Geç" button
-- and, defensively, the DB itself.
CREATE OR REPLACE FUNCTION public.can_store_go_live(p_store_id uuid)
RETURNS TABLE(allowed boolean, reason text) AS $$
DECLARE
  s public.stores;
BEGIN
  SELECT * INTO s FROM public.stores WHERE id = p_store_id;
  IF s.id IS NULL THEN
    RETURN QUERY SELECT false, 'STORE_NOT_FOUND';
    RETURN;
  END IF;
  IF s.dealer_status = 'SUSPENDED' OR s.login_disabled THEN
    RETURN QUERY SELECT false, 'SUSPENDED';
    RETURN;
  END IF;
  IF s.dashboard_locked THEN
    RETURN QUERY SELECT false, 'NO_ACTIVE_CATEGORY';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_products WHERE store_id = p_store_id AND is_active AND has_video) THEN
    RETURN QUERY SELECT false, 'NO_VIDEO_PRODUCT';
    RETURN;
  END IF;
  RETURN QUERY SELECT true, 'OK';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.start_live_session(p_store_id uuid)
RETURNS uuid AS $$
DECLARE
  v_allowed boolean;
  v_reason text;
  v_id uuid;
BEGIN
  SELECT allowed, reason INTO v_allowed, v_reason FROM public.can_store_go_live(p_store_id);
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'DEALER_CANNOT_GO_LIVE: %', v_reason USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.live_sessions (store_id, started_at)
  VALUES (p_store_id, now())
  RETURNING id INTO v_id;

  UPDATE public.stores SET is_live = true, updated_at = now() WHERE id = p_store_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.end_live_session(p_store_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.live_sessions
  SET ended_at = now(),
      duration_minutes = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at)) / 60)::integer
  WHERE store_id = p_store_id AND ended_at IS NULL;

  UPDATE public.stores SET is_live = false, live_viewer_count = 0, updated_at = now() WHERE id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 6. MONTHLY PASSIVE-DEALER SCORING
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_monthly_performance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  dealer_month_number integer NOT NULL, -- months since this store started (1, 2, 3...)
  sales_count integer NOT NULL DEFAULT 0,
  prev_sales_count integer NOT NULL DEFAULT 0,
  live_days integer NOT NULL DEFAULT 0,
  live_days_required integer NOT NULL DEFAULT 20,
  live_compliant boolean NOT NULL DEFAULT false,
  penalty_score numeric NOT NULL DEFAULT 0,
  cumulative_penalty numeric NOT NULL DEFAULT 0,
  status text NOT NULL, -- OK | WARNING | LOW_SALES | ZERO_SALES | IMPROVED | REWARD_ELIGIBLE | SUSPENDED
  message text NOT NULL,
  evaluated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT dealer_monthly_performance_pkey PRIMARY KEY (id),
  CONSTRAINT dealer_monthly_performance_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE,
  CONSTRAINT dealer_monthly_performance_unique UNIQUE (store_id, period_year, period_month)
);
CREATE INDEX IF NOT EXISTS idx_dealer_monthly_performance_store ON public.dealer_monthly_performance(store_id, period_year, period_month);

-- Core monthly evaluator. Designed to be called once per store per
-- calendar month (by pg_cron on the 1st, or manually/backfill by admin).
-- Implements MONTH 1 / 2 / 3-5 / 6 exactly as specified.
CREATE OR REPLACE FUNCTION public.evaluate_dealer_monthly_performance(p_year integer, p_month integer)
RETURNS void AS $$
DECLARE
  low_sales_threshold numeric := COALESCE((SELECT value FROM public.platform_settings WHERE key = 'dealer_low_sales_threshold'), 5);
  required_live_days integer := COALESCE((SELECT value FROM public.platform_settings WHERE key = 'dealer_required_live_days'), 20)::integer;
  required_live_hours numeric := COALESCE((SELECT value FROM public.platform_settings WHERE key = 'dealer_required_live_hours'), 4);
  period_start timestamptz := make_timestamptz(p_year, p_month, 1, 0, 0, 0);
  period_end timestamptz := period_start + interval '1 month';
  r RECORD;
  v_month_number integer;
  v_sales integer;
  v_prev_sales integer;
  v_live_days integer;
  v_live_compliant boolean;
  v_penalty numeric;
  v_prev_cumulative numeric;
  v_status text;
  v_message text;
  v_new_dealer_status text;
BEGIN
  FOR r IN
    SELECT s.id AS store_id, s.created_at, s.dealer_status
    FROM public.stores s
    WHERE s.dealer_status <> 'SUSPENDED'
  LOOP
    -- 1-indexed month number since the store was created, clamped to >= 1.
    v_month_number := GREATEST(1,
      (EXTRACT(YEAR FROM period_start) - EXTRACT(YEAR FROM r.created_at)) * 12
      + (EXTRACT(MONTH FROM period_start) - EXTRACT(MONTH FROM r.created_at)) + 1);

    SELECT count(*) INTO v_sales
    FROM public.store_orders so
    WHERE so.store_id = r.store_id
      AND so.status <> 'cancelled'
      AND so.created_at >= period_start AND so.created_at < period_end;

    SELECT COALESCE(dmp.sales_count, 0), COALESCE(dmp.cumulative_penalty, 0)
    INTO v_prev_sales, v_prev_cumulative
    FROM public.dealer_monthly_performance dmp
    WHERE dmp.store_id = r.store_id
      AND (dmp.period_year * 12 + dmp.period_month) = (p_year * 12 + p_month - 1);
    v_prev_sales := COALESCE(v_prev_sales, 0);
    v_prev_cumulative := COALESCE(v_prev_cumulative, 0);

    SELECT count(DISTINCT date_trunc('day', ls.started_at))
    INTO v_live_days
    FROM public.live_sessions ls
    WHERE ls.store_id = r.store_id
      AND ls.started_at >= period_start AND ls.started_at < period_end
      AND COALESCE(ls.duration_minutes, EXTRACT(EPOCH FROM (COALESCE(ls.ended_at, now()) - ls.started_at)) / 60) >= required_live_hours * 60;
    v_live_compliant := v_live_days >= required_live_days;

    v_penalty := 0;
    v_new_dealer_status := 'ACTIVE';

    IF v_month_number = 1 THEN
      IF v_sales = 0 THEN
        v_status := 'WARNING';
        v_message := 'Bu ay hiç satış yapmadınız. Yardım için bayi destek ekibiyle iletişime geçin.';
        v_new_dealer_status := 'WARNING';
      ELSE
        v_status := 'OK';
        v_message := 'İlk ayınızda satış yaptınız, tebrikler.';
      END IF;

    ELSIF v_month_number = 2 THEN
      IF v_sales = 0 THEN
        v_penalty := -0.5;
        v_status := 'ZERO_SALES';
        v_message := 'İkinci ayda da satış yok. -0.5 ceza puanı uygulandı.';
        v_new_dealer_status := 'WARNING';
      ELSIF v_sales < low_sales_threshold THEN
        v_status := 'LOW_SALES';
        v_message := 'Satışlarınız düşük. Ürün videolarınızı ve canlı yayın sıklığınızı artırmayı deneyin.';
      ELSE
        v_status := 'OK';
        v_message := 'Performansınız normal seyrinde.';
      END IF;

    ELSIF v_month_number BETWEEN 3 AND 5 THEN
      IF v_sales = 0 THEN
        v_penalty := -1;
        v_status := 'ZERO_SALES';
        v_message := format('%s. ayda satış yok. -1 ceza puanı uygulandı.', v_month_number);
        v_new_dealer_status := 'WARNING';
      ELSIF v_sales > v_prev_sales THEN
        v_status := 'IMPROVED';
        v_message := 'Satışlarınız arttı! Güncel bayi sıralamanızı Performans sayfasında görebilirsiniz.';
      ELSE
        v_status := 'OK';
        v_message := 'Performansınız normal seyrinde.';
      END IF;

    ELSE -- month 6+
      IF v_sales = 0 THEN
        v_status := 'SUSPENDED';
        v_message := 'Art arda satış yapılmadığı için bayilik askıya alındı. Giriş devre dışı bırakıldı.';
        v_new_dealer_status := 'SUSPENDED';
      ELSIF v_sales > v_prev_sales THEN
        v_status := 'REWARD_ELIGIBLE';
        v_message := 'Performans gelişimi nedeniyle ödül/çekiliş hakkı kazandınız.';
      ELSE
        v_status := 'OK';
        v_message := 'Performansınız normal seyrinde.';
      END IF;
    END IF;

    -- Live-stream non-compliance additionally downgrades status
    -- (spec §4: "can trigger WARNING / INACTIVE") without overriding an
    -- already-worse SUSPENDED outcome.
    IF NOT v_live_compliant AND v_new_dealer_status NOT IN ('SUSPENDED') THEN
      v_new_dealer_status := CASE WHEN v_new_dealer_status = 'ACTIVE' THEN 'WARNING' ELSE 'INACTIVE' END;
      v_message := v_message || format(' Ayrıca zorunlu canlı yayın gün sayısına (%s/%s gün) ulaşılmadı.', v_live_days, required_live_days);
    END IF;

    INSERT INTO public.dealer_monthly_performance (
      store_id, period_year, period_month, dealer_month_number,
      sales_count, prev_sales_count, live_days, live_days_required, live_compliant,
      penalty_score, cumulative_penalty, status, message, evaluated_at
    ) VALUES (
      r.store_id, p_year, p_month, v_month_number,
      v_sales, v_prev_sales, v_live_days, required_live_days, v_live_compliant,
      v_penalty, v_prev_cumulative + v_penalty, v_status, v_message, now()
    )
    ON CONFLICT (store_id, period_year, period_month) DO UPDATE SET
      dealer_month_number = EXCLUDED.dealer_month_number,
      sales_count = EXCLUDED.sales_count,
      prev_sales_count = EXCLUDED.prev_sales_count,
      live_days = EXCLUDED.live_days,
      live_days_required = EXCLUDED.live_days_required,
      live_compliant = EXCLUDED.live_compliant,
      penalty_score = EXCLUDED.penalty_score,
      cumulative_penalty = EXCLUDED.cumulative_penalty,
      status = EXCLUDED.status,
      message = EXCLUDED.message,
      evaluated_at = now();

    UPDATE public.stores
    SET dealer_status = v_new_dealer_status,
        penalty_score = v_prev_cumulative + v_penalty,
        login_disabled = (v_new_dealer_status = 'SUSPENDED'),
        suspended_at = CASE WHEN v_new_dealer_status = 'SUSPENDED' AND suspended_at IS NULL THEN now() ELSE suspended_at END,
        updated_at = now()
    WHERE id = r.store_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Convenience wrapper: evaluate the just-finished calendar month for
-- everyone. This is what the monthly cron job below calls.
CREATE OR REPLACE FUNCTION public.run_monthly_dealer_evaluation()
RETURNS void AS $$
DECLARE
  target date := date_trunc('month', now() - interval '1 day'); -- last day of previous month → that month
BEGIN
  PERFORM public.evaluate_dealer_monthly_performance(EXTRACT(YEAR FROM target)::int, EXTRACT(MONTH FROM target)::int);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule it, IF pg_cron is enabled on this project (Database →
-- Extensions → pg_cron in the Supabase dashboard). Safe to re-run.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dealer-monthly-evaluation';
    PERFORM cron.schedule('dealer-monthly-evaluation', '0 2 1 * *', $cron$SELECT public.run_monthly_dealer_evaluation();$cron$);
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. ONE-CALL DASHBOARD STATUS — everything the seller UI needs about
--    its own compliance state, in a single round trip.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dealer_dashboard_status(p_store_id uuid)
RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'store', to_jsonb(s.*),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id', cs.category_id,
        'category_name', c.name,
        'total_products', cs.total_products,
        'selected_products', cs.selected_products,
        'selection_ratio', cs.selection_ratio,
        'is_active', cs.is_active
      ) ORDER BY c.name)
      FROM public.store_category_status cs
      JOIN public.categories c ON c.id = cs.category_id
      WHERE cs.store_id = p_store_id
    ), '[]'::jsonb),
    'products_missing_video', COALESCE((
      SELECT count(*) FROM public.store_products WHERE store_id = p_store_id AND NOT has_video
    ), 0),
    'current_month_performance', (
      SELECT to_jsonb(dmp.*) FROM public.dealer_monthly_performance dmp
      WHERE dmp.store_id = p_store_id
      ORDER BY period_year DESC, period_month DESC LIMIT 1
    ),
    'can_go_live', (SELECT allowed FROM public.can_store_go_live(p_store_id)),
    'go_live_block_reason', (SELECT reason FROM public.can_store_go_live(p_store_id))
  ) INTO result
  FROM public.stores s WHERE s.id = p_store_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─────────────────────────────────────────────────────────────────────
-- 8. RLS — catalog is publicly readable (dealers must browse it to
--    select from it); compliance tables are readable by the owning
--    dealer and admins. Mirrors the ownership pattern already used by
--    stores/store_products in this schema.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_products_read ON public.catalog_products;
CREATE POLICY catalog_products_read ON public.catalog_products FOR SELECT USING (is_approved);

ALTER TABLE public.product_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_videos_owner_rw ON public.product_videos;
CREATE POLICY product_videos_owner_rw ON public.product_videos FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.store_products sp JOIN public.stores st ON st.id = sp.store_id
    WHERE sp.id = product_videos.store_product_id AND st.owner_id = auth.uid()
  )
);

ALTER TABLE public.store_category_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_category_status_owner_read ON public.store_category_status;
CREATE POLICY store_category_status_owner_read ON public.store_category_status FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.stores st WHERE st.id = store_category_status.store_id AND st.owner_id = auth.uid())
);

ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS live_sessions_owner_rw ON public.live_sessions;
CREATE POLICY live_sessions_owner_rw ON public.live_sessions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.stores st WHERE st.id = live_sessions.store_id AND st.owner_id = auth.uid())
);

ALTER TABLE public.dealer_monthly_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dealer_monthly_performance_owner_read ON public.dealer_monthly_performance;
CREATE POLICY dealer_monthly_performance_owner_read ON public.dealer_monthly_performance FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.stores st WHERE st.id = dealer_monthly_performance.store_id AND st.owner_id = auth.uid())
);

-- =====================================================================
-- END OF MIGRATION
-- After running: create a Storage bucket named "dealer-videos" (public
-- read) for the live-recorded / uploaded product videos referenced by
-- product_videos.video_url.
-- =====================================================================
