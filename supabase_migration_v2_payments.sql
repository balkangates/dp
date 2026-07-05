-- ================================================================
-- DAMPINGVAR — Trade Signals Module Migration v2
-- Adds USDT payment columns not in the original migration
-- Run AFTER the first migration (001_extend_dampingvar.sql)
-- ================================================================

-- Add wallet_address column if missing
ALTER TABLE public.trade_payments
  ADD COLUMN IF NOT EXISTS wallet_address text,
  ADD COLUMN IF NOT EXISTS memo           text,
  ADD COLUMN IF NOT EXISTS confirmed_at   timestamptz;

-- Ensure status includes all new states
ALTER TABLE public.trade_payments
  DROP CONSTRAINT IF EXISTS trade_payments_status_check;

ALTER TABLE public.trade_payments
  ADD CONSTRAINT trade_payments_status_check
  CHECK (status IN ('pending','confirming','confirmed','failed','expired'));

-- Index for fast poller lookups
CREATE INDEX IF NOT EXISTS trade_payments_pending
  ON public.trade_payments(user_id, status)
  WHERE status = 'pending';

-- ================================================================
-- ADMIN POLICY: service role can write to all tables
-- (RLS policies for user reads are already set in migration v1)
-- ================================================================

-- Allow service role to INSERT / UPDATE trade_payments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trade_payments' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all"
      ON public.trade_payments
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Allow service role to UPSERT trade_subscriptions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trade_subscriptions' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all"
      ON public.trade_subscriptions
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Allow authenticated users to INSERT their own payment rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trade_payments' AND policyname = 'users_insert_own'
  ) THEN
    CREATE POLICY "users_insert_own"
      ON public.trade_payments
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Allow authenticated users to UPDATE their own payment rows (add TX hash)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trade_payments' AND policyname = 'users_update_own'
  ) THEN
    CREATE POLICY "users_update_own"
      ON public.trade_payments
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Allow authenticated users to INSERT their own subscription rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trade_subscriptions' AND policyname = 'users_upsert_own'
  ) THEN
    CREATE POLICY "users_upsert_own"
      ON public.trade_subscriptions
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "users_update_own_sub"
      ON public.trade_subscriptions
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ================================================================
-- REALTIME: enable realtime on trade_payments for status polling
-- ================================================================
-- Run in Supabase Dashboard → Database → Replication → add table
-- or via SQL:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.trade_payments;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.trade_subscriptions;
