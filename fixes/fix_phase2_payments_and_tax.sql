-- =====================================================================
-- fix_phase2_payments_and_tax.sql
-- ─────────────────────────────────────────────────────────────────────
-- FAZ 2: Gerçek kredi kartı tahsilatı (iyzico) + satır bazlı KDV/indirim.
--
-- BULGU: store_orders.payment_method zaten var ama sadece 'cash' /
-- 'card_pos' (kapıda ödeme) destekliyor — platform hiçbir zaman parayı
-- ELİNDE TUTMUYOR, bu yüzden mevcut "escrow" kaydı sadece muhasebe
-- notuydu, gerçek bir emanet değildi. Bu migration:
--   1) 'online_card' adında üçüncü bir ödeme yöntemi ekliyor — iyzico
--      Checkout Form ile ÖNCEDEN tahsilat yapılıyor, para gerçekten
--      platformda (iyzico alt hesabında) bekliyor, ESCROW artık gerçek.
--   2) store_order_items'a satır bazlı KDV/indirim ekliyor (fatura için
--      şart — önceden sadece toplam tutar vardı).
--   3) handle_store_order_finance() motorunu (fix_order_finance_engine.sql)
--      bu yeni alanları kullanacak şekilde günceliyor: komisyon artık
--      KDV HARİÇ net satış tutarı üzerinden hesaplanıyor (KDV devlete
--      gidiyor, platformun/bayinin geliri değil — önceki sürüm bunu
--      ayırmıyordu, KDV dahil tutar üzerinden komisyon alıyordu).
--
-- ÇALIŞTIRMA: fix_order_finance_engine.sql'den SONRA, Supabase SQL
-- Editor'e yapıştır, RUN.
-- =====================================================================

-- ── 1. Ödeme yöntemi: online_card eklendi ──────────────────────────────
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_payment_method_check;
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_payment_method_check
  CHECK (payment_method = ANY (ARRAY['cash'::text, 'card_pos'::text, 'online_card'::text]));

-- iyzico ödeme takibi için
ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS payment_provider text,               -- 'iyzico'
  ADD COLUMN IF NOT EXISTS payment_provider_ref text,            -- iyzico paymentId / conversationId
  ADD COLUMN IF NOT EXISTS payment_provider_status text;         -- iyzico'nun döndürdüğü ham durum

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_orders_payment_ref
  ON public.store_orders(payment_provider_ref) WHERE payment_provider_ref IS NOT NULL;

-- ── 2. Satır bazlı KDV / indirim ────────────────────────────────────────
ALTER TABLE public.store_order_items
  ADD COLUMN IF NOT EXISTS discount_pct numeric NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 20 CHECK (tax_rate >= 0),
  -- net_price: indirim uygulanmış, KDV HARİÇ birim fiyat × adet
  ADD COLUMN IF NOT EXISTS net_price numeric,
  -- tax_amount: bu satırın KDV tutarı (net_price üzerinden)
  ADD COLUMN IF NOT EXISTS tax_amount numeric;

-- Mevcut kayıtlar için net_price/tax_amount'ı geriye dönük doldur
-- (varsayım: total_price zaten KDV dahildi, %20 KDV ile geri hesapla).
UPDATE public.store_order_items
SET net_price = round(total_price / 1.20, 2),
    tax_amount = total_price - round(total_price / 1.20, 2)
WHERE net_price IS NULL;

-- ── 3. Escrow/komisyon hesabını KDV-HARİÇ net tutar üzerinden yapacak
--    şekilde motoru güncelle (fix_order_finance_engine.sql'deki
--    handle_store_order_finance()'in CONFIRMED bloğu değişti) ──────────
CREATE OR REPLACE FUNCTION public.handle_store_order_finance()
RETURNS trigger AS $$
DECLARE
  v_gross numeric;       -- KDV dahil toplam (müşterinin ödediği)
  v_net_sales numeric := 0;   -- KDV hariç toplam (komisyon tabanı)
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

  IF NEW.status = 'CONFIRMED' THEN
    v_gross := NEW.total_amount;

    FOR v_item IN
      SELECT soi.id, soi.total_price, soi.net_price, sp.category_id, sp.id AS store_product_id
      FROM public.store_order_items soi
      LEFT JOIN public.store_products sp ON sp.id = soi.store_product_id
      WHERE soi.order_id = NEW.id
    LOOP
      SELECT COALESCE(c.commission_pct, 10) INTO v_rate
      FROM public.categories c WHERE c.id = v_item.category_id;
      v_rate := COALESCE(v_rate, 10);

      -- Komisyon tabanı: net_price varsa onu kullan (KDV hariç), yoksa
      -- (eski kayıt/manuel insert) total_price'a geri düş.
      DECLARE v_base numeric := COALESCE(v_item.net_price, v_item.total_price);
      BEGIN
        v_net_sales := v_net_sales + v_base;

        INSERT INTO public.dealer_commissions (
          store_order_item_id, store_id, sale_store_id, catalog_product_id,
          category_id, commission_type, sale_amount, rate_pct, amount,
          period_year, period_month
        )
        SELECT v_item.id, NEW.store_id, NEW.store_id, sp.catalog_product_id,
          v_item.category_id, 'sale', v_base, v_rate,
          round(v_base * v_rate / 100, 2), v_year, v_month
        FROM public.store_products sp WHERE sp.id = v_item.store_product_id
        ON CONFLICT DO NOTHING;

        v_commission_amount := v_commission_amount + round(v_base * v_rate / 100, 2);
      END;
    END LOOP;

    INSERT INTO public.escrow_transactions (
      order_id, total_amount, system_fee, dealer_fee, shipping_fee, net_amount, status
    ) VALUES (
      NEW.id, v_gross, v_commission_amount, 0, COALESCE(NEW.shipping_fee, 0),
      v_gross - v_commission_amount - COALESCE(NEW.shipping_fee, 0), 'HELD'
    )
    ON CONFLICT (order_id) DO NOTHING;

    SELECT owner_id INTO v_seller_id FROM public.stores WHERE id = NEW.store_id;
    INSERT INTO public.store_order_commissions (
      order_id, seller_id, buyer_id, gross_amount, platform_fee_pct, platform_fee, seller_payout, status
    ) VALUES (
      NEW.id, v_seller_id, NEW.customer_id, v_gross,
      CASE WHEN v_net_sales > 0 THEN round(v_commission_amount / v_net_sales * 100, 2) ELSE 10 END,
      v_commission_amount, v_gross - v_commission_amount, 'pending'
    )
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  IF NEW.status = 'PREPARING' THEN
    INSERT INTO public.store_order_invoices (order_id, invoice_number, subtotal, tax_rate, tax_amount, total_amount)
    SELECT NEW.id, public.fn_next_invoice_no(),
      COALESCE((SELECT sum(net_price) FROM public.store_order_items WHERE order_id = NEW.id), round(NEW.total_amount / 1.20, 2)),
      20,
      COALESCE((SELECT sum(tax_amount) FROM public.store_order_items WHERE order_id = NEW.id), NEW.total_amount - round(NEW.total_amount / 1.20, 2)),
      NEW.total_amount
    WHERE NOT EXISTS (SELECT 1 FROM public.store_order_invoices WHERE order_id = NEW.id);
  END IF;

  IF NEW.status = 'SHIPPED' THEN
    INSERT INTO public.delivery_notes (order_id, document_no)
    SELECT NEW.id, public.fn_next_delivery_note_no()
    WHERE NOT EXISTS (SELECT 1 FROM public.delivery_notes WHERE order_id = NEW.id);
  END IF;

  IF NEW.status = 'COMPLETED' THEN
    UPDATE public.escrow_transactions
    SET status = 'RELEASED', released_at = now(), updated_at = now()
    WHERE order_id = NEW.id AND status = 'HELD';

    UPDATE public.store_order_commissions
    SET status = 'released', released_at = now(), updated_at = now()
    WHERE order_id = NEW.id AND status = 'pending';
  END IF;

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
-- (trigger tanımı fix_order_finance_engine.sql'de zaten kuruldu, fonksiyon
--  gövdesi CREATE OR REPLACE ile güncellendiği için trigger'ı yeniden
--  oluşturmaya gerek yok.)

-- ── 4. iyzico webhook'unun ödeme onayında çağıracağı RPC ────────────────
-- Next.js API route (app/api/payments/iyzico/webhook/route.ts) iyzico'dan
-- gelen sonucu doğruladıktan SONRA bunu çağırır — SECURITY DEFINER
-- olduğu için service-role gerekmeden, sadece bu RPC üzerinden ödeme
-- onayı işlenebiliyor (ödeme sağlayıcısı doğrulaması API route'ta yapılır).
CREATE OR REPLACE FUNCTION public.confirm_online_payment(
  p_order_id uuid, p_provider text, p_provider_ref text, p_provider_status text
)
RETURNS void AS $$
BEGIN
  UPDATE public.store_orders
  SET payment_confirmed = true,
      payment_provider = p_provider,
      payment_provider_ref = p_provider_ref,
      payment_provider_status = p_provider_status,
      status = 'CONFIRMED',
      updated_at = now()
  WHERE id = p_order_id AND status = 'PAYMENT_PENDING';
  -- status = 'CONFIRMED' ataması yukarıdaki trg_store_order_finance
  -- trigger'ını otomatik tetikler → escrow HELD olur.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.confirm_online_payment(uuid, text, text, text) TO service_role;
