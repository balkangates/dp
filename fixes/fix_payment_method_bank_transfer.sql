-- =====================================================================
-- fix_payment_method_bank_transfer.sql
-- ─────────────────────────────────────────────────────────────────────
-- store_orders.payment_method CHECK kısıtlaması şu an sadece 'cash',
-- 'card_pos', 'online_card' değerlerine izin veriyor. Sepet ekranında
-- ödeme yöntemleri artık "Havale" (bank_transfer) ve "Online Kart"
-- (online_card) olarak sadeleştirildiği için 'bank_transfer' değerini
-- kısıtlamaya ekliyoruz.
--
-- Kısıtlamanın gerçek adını (otomatik üretilmiş olabileceğinden) elle
-- yazmak yerine pg_constraint üzerinden buluyoruz — hangi isimle
-- oluşturulmuş olursa olsun güvenle çalışır.
--
-- ÇALIŞTIRMA: Supabase SQL Editor'e yapıştır, RUN.
-- =====================================================================

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'store_orders'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%payment_method%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.store_orders DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.store_orders
    ADD CONSTRAINT store_orders_payment_method_check
    CHECK (payment_method = ANY (ARRAY['cash'::text, 'card_pos'::text, 'online_card'::text, 'bank_transfer'::text]));
END $$;
