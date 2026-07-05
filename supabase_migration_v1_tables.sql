-- ================================================================
-- DAMPINGVAR — Trade Signals Migration
-- Mevcut trade_subscriptions ve trade_payments tablolarını KULLANIR.
-- Bu tablolar Supabase'de ZATEN VAR.
-- Bu migration sadece eksik olan şeyleri ekler.
-- ================================================================

-- ── Mevcut trade_payments tablosuna eksik kolonlar ekle ────────
-- (Tablo zaten var: id, user_id, plan, amount_usdt, network,
--  wallet_address, tx_hash, status, confirmed_at, notes,
--  created_at, updated_at)
-- expires_at ve memo YOK — uygulama katmanında yönetilecek

-- memo kolonu ekle (opsiyonel, yoksa ekler)
ALTER TABLE public.trade_payments
  ADD COLUMN IF NOT EXISTS memo text;

-- ── RLS Politikaları (idempotent DO bloğu içinde) ─────────────

ALTER TABLE public.trade_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_payments      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN

  -- trade_subscriptions: SELECT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'trade_subscriptions'
      AND policyname = 'trade_subs_user_read'
  ) THEN
    EXECUTE 'CREATE POLICY trade_subs_user_read
      ON public.trade_subscriptions
      FOR SELECT
      USING (auth.uid() = user_id)';
  END IF;

  -- trade_subscriptions: INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'trade_subscriptions'
      AND policyname = 'trade_subs_user_insert'
  ) THEN
    EXECUTE 'CREATE POLICY trade_subs_user_insert
      ON public.trade_subscriptions
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id)';
  END IF;

  -- trade_subscriptions: UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'trade_subscriptions'
      AND policyname = 'trade_subs_user_update'
  ) THEN
    EXECUTE 'CREATE POLICY trade_subs_user_update
      ON public.trade_subscriptions
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)';
  END IF;

  -- trade_payments: SELECT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'trade_payments'
      AND policyname = 'trade_pay_user_read'
  ) THEN
    EXECUTE 'CREATE POLICY trade_pay_user_read
      ON public.trade_payments
      FOR SELECT
      USING (auth.uid() = user_id)';
  END IF;

  -- trade_payments: INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'trade_payments'
      AND policyname = 'trade_pay_user_insert'
  ) THEN
    EXECUTE 'CREATE POLICY trade_pay_user_insert
      ON public.trade_payments
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id)';
  END IF;

  -- trade_payments: UPDATE (tx_hash eklemek için)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'trade_payments'
      AND policyname = 'trade_pay_user_update'
  ) THEN
    EXECUTE 'CREATE POLICY trade_pay_user_update
      ON public.trade_payments
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)';
  END IF;

END $$;

-- ── UPDATED_AT trigger (yoksa ekle) ───────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname   = 'trade_subs_updated_at'
      AND tgrelid  = 'public.trade_subscriptions'::regclass
  ) THEN
    EXECUTE 'CREATE TRIGGER trade_subs_updated_at
      BEFORE UPDATE ON public.trade_subscriptions
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname   = 'trade_pay_updated_at'
      AND tgrelid  = 'public.trade_payments'::regclass
  ) THEN
    EXECUTE 'CREATE TRIGGER trade_pay_updated_at
      BEFORE UPDATE ON public.trade_payments
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()';
  END IF;
END $$;

-- ── Index'ler ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS trade_pay_user_idx
  ON public.trade_payments(user_id);

CREATE INDEX IF NOT EXISTS trade_pay_status_idx
  ON public.trade_payments(status);

CREATE INDEX IF NOT EXISTS trade_pay_hash_idx
  ON public.trade_payments(tx_hash)
  WHERE tx_hash IS NOT NULL;
