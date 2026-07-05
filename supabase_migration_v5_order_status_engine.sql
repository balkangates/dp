-- =====================================================================
-- supabase_migration_v5_order_status_engine.sql
-- MODÜL 3.7.1 — ORDER STATUS ENGINE
-- =====================================================================
-- Run AFTER v1, v2, v3 (dealer_core), v4 (supplier_commission).
--
-- CONTEXT / DEVIATION NOTE:
-- public.store_orders already had a status column BEFORE this module was
-- requested: text + CHECK IN ('received','preparing','courier','delivered',
-- 'cancelled'). The new 7-state flow you specified (PAYMENT_PENDING →
-- CONFIRMED → PREPARING → READY → SHIPPED → DELIVERED → COMPLETED) does
-- not have a slot for a cancellation outcome, but real orders must be
-- cancellable at any non-terminal point. This migration therefore ADDS
-- 'CANCELLED' as an 8th enum value, reachable from any state except
-- DELIVERED/COMPLETED/CANCELLED itself. Everything else matches your
-- spec exactly.
--
-- Existing rows are migrated, not discarded:
--   'received'  + payment_confirmed=false → PAYMENT_PENDING
--   'received'  + payment_confirmed=true  → CONFIRMED
--   'preparing' → PREPARING
--   'courier'   → SHIPPED
--   'delivered' → DELIVERED
--   'cancelled' → CANCELLED
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. STATUS ENUM
-- ─────────────────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_enum') THEN
    CREATE TYPE public.order_status_enum AS ENUM (
      'PAYMENT_PENDING',
      'CONFIRMED',
      'PREPARING',
      'READY',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
      'CANCELLED'
    );
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. MIGRATE store_orders.status FROM text+CHECK TO THE ENUM
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.store_orders ADD COLUMN IF NOT EXISTS status_v2 public.order_status_enum;

UPDATE public.store_orders SET status_v2 = CASE
  WHEN status = 'received'  AND NOT payment_confirmed THEN 'PAYMENT_PENDING'::public.order_status_enum
  WHEN status = 'received'  AND payment_confirmed      THEN 'CONFIRMED'::public.order_status_enum
  WHEN status = 'preparing' THEN 'PREPARING'::public.order_status_enum
  WHEN status = 'courier'   THEN 'SHIPPED'::public.order_status_enum
  WHEN status = 'delivered' THEN 'DELIVERED'::public.order_status_enum
  WHEN status = 'cancelled' THEN 'CANCELLED'::public.order_status_enum
  ELSE 'PAYMENT_PENDING'::public.order_status_enum
END
WHERE status_v2 IS NULL;

ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_status_check;
ALTER TABLE public.store_orders ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.store_orders DROP COLUMN status;
ALTER TABLE public.store_orders RENAME COLUMN status_v2 TO status;
ALTER TABLE public.store_orders ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.store_orders ALTER COLUMN status SET DEFAULT 'PAYMENT_PENDING';
CREATE INDEX IF NOT EXISTS idx_store_orders_status ON public.store_orders(status);

-- ─────────────────────────────────────────────────────────────────────
-- 3. status_history — full audit trail, one row per transition
--    (including the very first INSERT, logged as NULL → PAYMENT_PENDING).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  from_status public.order_status_enum,
  to_status public.order_status_enum NOT NULL,
  changed_by uuid,               -- auth.uid() of whoever/whatever triggered it (NULL = system/automatic)
  trigger_type text NOT NULL DEFAULT 'manual' CHECK (trigger_type = ANY (ARRAY['manual'::text, 'automatic'::text, 'courier_api'::text, 'waybill'::text])),
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT order_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.store_orders(id) ON DELETE CASCADE,
  CONSTRAINT order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON public.order_status_history(order_id, created_at);

-- ─────────────────────────────────────────────────────────────────────
-- 4. TRANSITION VALIDATION
--    Encodes exactly the allowed edges from your spec, plus the single
--    CANCELLED escape hatch from any non-terminal state.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_valid_order_transition(p_from public.order_status_enum, p_to public.order_status_enum)
RETURNS boolean AS $$
BEGIN
  IF p_from = p_to THEN RETURN true; END IF; -- no-op update, not a transition

  IF p_to = 'CANCELLED' THEN
    RETURN p_from NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED');
  END IF;

  RETURN (p_from, p_to) IN (
    ('PAYMENT_PENDING', 'CONFIRMED'),
    ('CONFIRMED',       'PREPARING'),
    ('PREPARING',       'READY'),
    ('READY',           'SHIPPED'),
    ('SHIPPED',         'DELIVERED'),
    ('DELIVERED',       'COMPLETED')
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- BEFORE trigger: reject any UPDATE that tries to set an illegal status.
CREATE OR REPLACE FUNCTION public.enforce_order_status_transition()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.is_valid_order_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'ORDER_STATUS_INVALID_TRANSITION: % -> % geçişi kurallara aykırı.', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_order_status_transition ON public.store_orders;
CREATE TRIGGER trg_enforce_order_status_transition
BEFORE UPDATE OF status ON public.store_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_status_transition();

-- AFTER trigger: log every real change (and the initial insert) to history.
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, trigger_type, reason)
    VALUES (NEW.id, NULL, NEW.status, auth.uid(), 'manual', 'Sipariş oluşturuldu');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, trigger_type, reason)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid(),
      CASE WHEN auth.uid() IS NULL THEN 'automatic' ELSE 'manual' END,
      NULL);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_order_status_insert ON public.store_orders;
CREATE TRIGGER trg_log_order_status_insert
AFTER INSERT ON public.store_orders
FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

DROP TRIGGER IF EXISTS trg_log_order_status_update ON public.store_orders;
CREATE TRIGGER trg_log_order_status_update
AFTER UPDATE OF status ON public.store_orders
FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

-- ─────────────────────────────────────────────────────────────────────
-- 5. AUTOMATIC TRANSITIONS
--    "CONFIRMED → PREPARING (otomatik)" and "DELIVERED → COMPLETED
--    (otomatik)" fire immediately, in the same transaction, the moment
--    those states are reached — no cron/poll needed for these two.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_advance_order_status()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'CONFIRMED' THEN
    UPDATE public.store_orders SET status = 'PREPARING' WHERE id = NEW.id;
  ELSIF NEW.status = 'DELIVERED' THEN
    UPDATE public.store_orders SET status = 'COMPLETED' WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_advance_order_status ON public.store_orders;
CREATE TRIGGER trg_auto_advance_order_status
AFTER UPDATE OF status ON public.store_orders
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION public.auto_advance_order_status();

-- ─────────────────────────────────────────────────────────────────────
-- 6. RPC — the one function client code (dealer panel, courier
--    webhook, waybill flow) should call instead of raw UPDATEs. Adds a
--    light role check per your rule annotations; validation/logging
--    still happens via the triggers above regardless of entry point.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id uuid,
  p_new_status public.order_status_enum,
  p_reason text DEFAULT NULL,
  p_trigger_type text DEFAULT 'manual'
)
RETURNS public.store_orders AS $$
DECLARE
  v_order public.store_orders;
  v_role text;
  v_store_owner uuid;
BEGIN
  SELECT * INTO v_order FROM public.store_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  SELECT owner_id INTO v_store_owner FROM public.stores WHERE id = v_order.store_id;

  -- READY → SHIPPED is meant to happen "irsaliye sonrası" (after the
  -- waybill is issued) — this schema has no waybill table yet, so that
  -- precondition can't be checked here. Wire it in once a waybill/
  -- invoicing table exists; for now this only enforces WHO can call it.
  IF p_new_status = 'SHIPPED' AND v_role NOT IN ('admin', 'seller') AND auth.uid() IS DISTINCT FROM v_store_owner THEN
    RAISE EXCEPTION 'ORDER_STATUS_FORBIDDEN: irsaliye/kargo geçişi sadece bayi veya admin tarafından yapılabilir.' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_status = 'DELIVERED' AND v_role NOT IN ('admin', 'logistics') THEN
    RAISE EXCEPTION 'ORDER_STATUS_FORBIDDEN: teslim onayı sadece kargo/lojistik entegrasyonu veya admin tarafından yapılabilir.' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_status IN ('CONFIRMED', 'READY') AND v_role NOT IN ('admin', 'seller') AND auth.uid() IS DISTINCT FROM v_store_owner THEN
    RAISE EXCEPTION 'ORDER_STATUS_FORBIDDEN: bu geçiş sadece bayi veya admin tarafından yapılabilir.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.store_orders SET status = p_new_status WHERE id = p_order_id;

  IF p_reason IS NOT NULL THEN
    UPDATE public.order_status_history SET reason = p_reason, trigger_type = p_trigger_type
    WHERE id = (SELECT id FROM public.order_status_history WHERE order_id = p_order_id ORDER BY created_at DESC LIMIT 1);
  END IF;

  SELECT * INTO v_order FROM public.store_orders WHERE id = p_order_id;
  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 7. FIX: v3's monthly evaluator referenced the OLD lowercase status
--    values. Redefine it here so a "sale" means an order that actually
--    got confirmed (i.e. reached CONFIRMED or later), not just "not
--    cancelled" — closer to what §1 of the dealer spec intends, and
--    now type-correct against the enum.
-- ─────────────────────────────────────────────────────────────────────
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
    v_month_number := GREATEST(1,
      (EXTRACT(YEAR FROM period_start) - EXTRACT(YEAR FROM r.created_at)) * 12
      + (EXTRACT(MONTH FROM period_start) - EXTRACT(MONTH FROM r.created_at)) + 1);

    SELECT count(*) INTO v_sales
    FROM public.store_orders so
    WHERE so.store_id = r.store_id
      AND so.status NOT IN ('PAYMENT_PENDING', 'CANCELLED')
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

-- ─────────────────────────────────────────────────────────────────────
-- 8. RLS on the new history table — same ownership pattern as the rest
--    of this schema: store owner, the ordering customer, and admins.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_status_history_read ON public.order_status_history;
CREATE POLICY order_status_history_read ON public.order_status_history FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.store_orders so
    JOIN public.stores st ON st.id = so.store_id
    WHERE so.id = order_status_history.order_id
      AND (st.owner_id = auth.uid() OR so.customer_id = auth.uid())
  )
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- =====================================================================
-- END OF MIGRATION
-- Client code should call transition_order_status(order_id, new_status,
-- reason) rather than UPDATE store_orders SET status=... directly —
-- both paths are validated/logged identically, but the RPC also checks
-- who's allowed to make manual transitions.
-- =====================================================================
