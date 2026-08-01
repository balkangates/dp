-- =====================================================================
-- fix_order_finance_engine.sql
-- ─────────────────────────────────────────────────────────────────────
-- store_orders için: ESCROW (ödeme emanet) / KOMİSYON / FATURA / İRSALİYE
-- akışını GERÇEKTEN çalışır hale getirir.
--
-- BULGU: escrow_transactions, store_order_commissions, dealer_commissions,
-- delivery_notes tabloları veritabanında ZATEN VARDI ama hiçbir yerde
-- bunlara yazan kod yoktu — sipariş durumu ilerlese bile hiçbir mali kayıt
-- oluşmuyordu. Bu migration, v5'teki order_status_engine'in ürettiği HER
-- durum geçişine otomatik olarak kanca atıyor (trigger), bu yüzden istemci
-- tarafı sadece store_orders.status'u güncellemeye devam ediyor — mali
-- kayıtlar arka planda kendiliğinden oluşuyor.
--
-- AKIŞ (store_orders.status'a göre):
--   → CONFIRMED   : escrow_transactions (HELD) + dealer_commissions (satır
--                    bazlı) + store_order_commissions (pending) açılır.
--   → PREPARING   : store_order_invoices (fatura) kesilir.
--   → SHIPPED     : delivery_notes (irsaliye) kesilir (v5'in kendi notu:
--                    "READY → SHIPPED irsaliye sonrası olmalı").
--   → COMPLETED   : escrow RELEASED, komisyon 'released' olur.
--   → CANCELLED   : escrow (varsa) REFUNDED, komisyon 'cancelled' olur.
--
-- Her adım idempotent — aynı siparişe iki kez CONFIRMED/PREPARING/SHIPPED
-- işlenirse (ör. admin'in durum düzeltmesi) ikinci kayıt açılmaz.
--
-- ÇALIŞTIRMA: Supabase → SQL Editor'e yapıştır, RUN.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. FATURA (invoice) — store_orders için hiç tablo yoktu. invoices/
--    commissions/escrow_wallets tabloları var ama HEPSİ eski `orders`
--    tablosuna bağlı (order_id → public.orders) — store_orders'a
--    kullanılamaz, karıştırmamak lazım. Bu yüzden yeni, store_orders'a
--    bağlı bir fatura tablosu.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_order_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.store_orders(id),
  invoice_number text NOT NULL UNIQUE,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  subtotal numeric NOT NULL,
  tax_rate numeric NOT NULL DEFAULT 20,
  tax_amount numeric NOT NULL,
  total_amount numeric NOT NULL,
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_order_invoices_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.store_order_invoice_counters (
  year integer NOT NULL PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Yardımcı: yıl bazlı, çakışmasız sıradaki belge numarasını üretir
--    (hem fatura hem irsaliye için — FOR UPDATE ile race condition yok).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_next_invoice_no()
RETURNS text AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now())::integer;
  v_num integer;
BEGIN
  INSERT INTO public.store_order_invoice_counters (year, last_number)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_number = public.store_order_invoice_counters.last_number + 1
  RETURNING last_number INTO v_num;
  RETURN format('FTR-%s-%s', v_year, lpad(v_num::text, 6, '0'));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.fn_next_delivery_note_no()
RETURNS text AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now())::integer;
  v_num integer;
BEGIN
  INSERT INTO public.delivery_note_counters (year, last_number)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_number = public.delivery_note_counters.last_number + 1
  RETURNING last_number INTO v_num;
  RETURN format('IRS-%s-%s', v_year, lpad(v_num::text, 6, '0'));
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────
-- 3. ANA MOTOR — store_orders.status her değiştiğinde tetiklenir.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_store_order_finance()
RETURNS trigger AS $$
DECLARE
  v_gross numeric;
  v_commission_amount numeric := 0;
  v_item RECORD;
  v_rate numeric;
  v_year integer := EXTRACT(YEAR FROM now())::integer;
  v_month integer := EXTRACT(MONTH FROM now())::integer;
  v_seller_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- ── CONFIRMED: ödeme onaylandı → parayı ESCROW'a al, komisyonu hesapla ──
  IF NEW.status = 'CONFIRMED' THEN
    v_gross := NEW.total_amount;

    -- Sipariş kalemi başına kategori komisyon oranı (categories.commission_pct,
    -- yoksa platform varsayılanı %10) ile satır bazlı komisyon topla.
    FOR v_item IN
      SELECT soi.id, soi.total_price, sp.category_id, sp.id AS store_product_id
      FROM public.store_order_items soi
      LEFT JOIN public.store_products sp ON sp.id = soi.store_product_id
      WHERE soi.order_id = NEW.id
    LOOP
      SELECT COALESCE(c.commission_pct, 10) INTO v_rate
      FROM public.categories c WHERE c.id = v_item.category_id;
      v_rate := COALESCE(v_rate, 10);

      INSERT INTO public.dealer_commissions (
        store_order_item_id, store_id, sale_store_id, catalog_product_id,
        category_id, commission_type, sale_amount, rate_pct, amount,
        period_year, period_month
      )
      SELECT v_item.id, NEW.store_id, NEW.store_id, sp.catalog_product_id,
        v_item.category_id, 'sale', v_item.total_price, v_rate,
        round(v_item.total_price * v_rate / 100, 2), v_year, v_month
      FROM public.store_products sp WHERE sp.id = v_item.store_product_id
      ON CONFLICT DO NOTHING;

      v_commission_amount := v_commission_amount + round(v_item.total_price * v_rate / 100, 2);
    END LOOP;

    -- shipping_fee / dealer_fee: şu an ayrı bir kargo-ücreti veya bayiye
    -- özel ek ücret modeli TANIMLI DEĞİL — 0 olarak bırakıldı (ileride
    -- kargo entegrasyonu eklendiğinde buraya yazılabilir). system_fee tek
    -- başına platformun payı, net_amount bayiye kalan tutar.
    INSERT INTO public.escrow_transactions (
      order_id, total_amount, system_fee, dealer_fee, shipping_fee, net_amount, status
    ) VALUES (
      NEW.id, v_gross, v_commission_amount, 0, 0, v_gross - v_commission_amount, 'HELD'
    )
    ON CONFLICT (order_id) DO NOTHING;

    SELECT owner_id INTO v_seller_id FROM public.stores WHERE id = NEW.store_id;
    INSERT INTO public.store_order_commissions (
      order_id, seller_id, buyer_id, gross_amount, platform_fee_pct, platform_fee, seller_payout, status
    ) VALUES (
      NEW.id, v_seller_id, NEW.customer_id, v_gross,
      CASE WHEN v_gross > 0 THEN round(v_commission_amount / v_gross * 100, 2) ELSE 10 END,
      v_commission_amount, v_gross - v_commission_amount, 'pending'
    )
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  -- ── PREPARING: hazırlanıyor → FATURA kesilir ────────────────────────
  IF NEW.status = 'PREPARING' THEN
    INSERT INTO public.store_order_invoices (order_id, invoice_number, subtotal, tax_rate, tax_amount, total_amount)
    SELECT NEW.id, public.fn_next_invoice_no(),
      round(NEW.total_amount / 1.20, 2), 20,
      NEW.total_amount - round(NEW.total_amount / 1.20, 2), NEW.total_amount
    WHERE NOT EXISTS (SELECT 1 FROM public.store_order_invoices WHERE order_id = NEW.id);
  END IF;

  -- ── SHIPPED: kargoya verildi → İRSALİYE kesilir ─────────────────────
  IF NEW.status = 'SHIPPED' THEN
    INSERT INTO public.delivery_notes (order_id, document_no)
    SELECT NEW.id, public.fn_next_delivery_note_no()
    WHERE NOT EXISTS (SELECT 1 FROM public.delivery_notes WHERE order_id = NEW.id);
  END IF;

  -- ── COMPLETED: teslim onaylandı → ESCROW SERBEST BIRAKILIR ──────────
  IF NEW.status = 'COMPLETED' THEN
    UPDATE public.escrow_transactions
    SET status = 'RELEASED', released_at = now(), updated_at = now()
    WHERE order_id = NEW.id AND status = 'HELD';

    UPDATE public.store_order_commissions
    SET status = 'released', released_at = now(), updated_at = now()
    WHERE order_id = NEW.id AND status = 'pending';
  END IF;

  -- ── CANCELLED: escrow'da tutulan para varsa iade edilir ─────────────
  IF NEW.status = 'CANCELLED' THEN
    UPDATE public.escrow_transactions
    SET status = 'REFUNDED', updated_at = now()
    WHERE order_id = NEW.id AND status = 'HELD';

    UPDATE public.store_order_commissions
    SET status = 'cancelled', updated_at = now()
    WHERE order_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_store_order_finance ON public.store_orders;
CREATE TRIGGER trg_store_order_finance
AFTER UPDATE OF status ON public.store_orders
FOR EACH ROW EXECUTE FUNCTION public.handle_store_order_finance();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Tek bir siparişin TÜM mali durumunu (escrow + komisyon + fatura +
--    irsaliye) tek çağrıda döndüren RPC — dealer paneli ve müşteri
--    "Siparişlerim" ekranı bunu kullanacak.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_store_order_finance(p_order_id uuid)
RETURNS TABLE (
  escrow_status text,
  escrow_net_amount numeric,
  commission_status text,
  invoice_number text,
  invoice_pdf_url text,
  delivery_note_no text,
  delivery_note_date date
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.store_orders so
    JOIN public.stores st ON st.id = so.store_id
    WHERE so.id = p_order_id
      AND (st.owner_id = auth.uid() OR so.customer_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    et.status, et.net_amount,
    soc.status,
    inv.invoice_number, inv.pdf_url,
    dn.document_no, dn.issue_date
  FROM public.store_orders so
  LEFT JOIN public.escrow_transactions et ON et.order_id = so.id
  LEFT JOIN public.store_order_commissions soc ON soc.order_id = so.id
  LEFT JOIN public.store_order_invoices inv ON inv.order_id = so.id
  LEFT JOIN public.delivery_notes dn ON dn.order_id = so.id
  WHERE so.id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.get_store_order_finance(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. RLS — store_order_invoices: mağaza sahibi, siparişi veren müşteri,
--    admin okuyabilir (order_status_history ile aynı desen).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.store_order_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_order_invoices_read ON public.store_order_invoices;
CREATE POLICY store_order_invoices_read ON public.store_order_invoices FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.store_orders so
    JOIN public.stores st ON st.id = so.store_id
    WHERE so.id = store_order_invoices.order_id
      AND (st.owner_id = auth.uid() OR so.customer_id = auth.uid())
  )
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
