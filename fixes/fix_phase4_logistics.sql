-- =====================================================================
-- fix_phase4_logistics.sql
-- ─────────────────────────────────────────────────────────────────────
-- FAZ 4: Bayi → müşteri son-mil kargo/teslimat takibi.
--
-- BULGU: public.shipments / shipment_allocations tabloları var ama
-- SADECE tedarikçi → bayi toplu sevkiyatı için (reverse_auctions
-- sonrası). Bayinin kendi müşterisine gönderdiği paketler için AYRI bir
-- tablo yoktu. Bu migration onu ekliyor + kargo firması webhook'unun
-- (Yurtiçi/Aras/MNG vb.) sipariş durumunu otomatik ilerletebilmesi için
-- bir RPC ekliyor.
--
-- ÇALIŞTIRMA: Supabase SQL Editor'e yapıştır, RUN.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.store_order_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.store_orders(id),
  carrier text NOT NULL DEFAULT 'manual'
    CHECK (carrier IN ('manual', 'yurtici', 'aras', 'mng', 'ptt', 'surat')),
  tracking_number text,
  tracking_url text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned')),
  last_webhook_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_order_shipments_tracking
  ON public.store_order_shipments(carrier, tracking_number);

ALTER TABLE public.store_order_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_order_shipments_read ON public.store_order_shipments;
CREATE POLICY store_order_shipments_read ON public.store_order_shipments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.store_orders so JOIN public.stores st ON st.id = so.store_id
    WHERE so.id = store_order_shipments.order_id
      AND (st.owner_id = auth.uid() OR so.customer_id = auth.uid())
  )
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'logistics'))
);

DROP POLICY IF EXISTS store_order_shipments_dealer_write ON public.store_order_shipments;
CREATE POLICY store_order_shipments_dealer_write ON public.store_order_shipments FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.store_orders so JOIN public.stores st ON st.id = so.store_id
    WHERE so.id = store_order_shipments.order_id AND st.owner_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'logistics'))
);

-- Bayi "Kargoya Ver" dediğinde (SHIPPED'a geçiş) hem store_orders.status
-- değişsin hem de kargo kaydı aynı anda açılsın diye tek RPC'de topluyoruz.
CREATE OR REPLACE FUNCTION public.mark_order_shipped(
  p_order_id uuid, p_carrier text, p_tracking_number text, p_tracking_url text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.store_order_shipments (order_id, carrier, tracking_number, tracking_url, status)
  VALUES (p_order_id, p_carrier, p_tracking_number, p_tracking_url, 'picked_up')
  ON CONFLICT (order_id) DO UPDATE
    SET carrier = EXCLUDED.carrier,
        tracking_number = EXCLUDED.tracking_number,
        tracking_url = EXCLUDED.tracking_url,
        status = 'picked_up',
        updated_at = now();

  UPDATE public.store_orders SET status = 'SHIPPED', updated_at = now()
  WHERE id = p_order_id AND status = 'READY';
  -- status='SHIPPED' ataması trg_store_order_finance'i tetikler → irsaliye otomatik kesilir.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.mark_order_shipped(uuid, text, text, text) TO authenticated;

-- Kargo firması webhook'u (Next.js API route → service-role ile) bu RPC'yi
-- çağırarak durumu günceller ve teslim edildiyse siparişi DELIVERED'a taşır.
CREATE OR REPLACE FUNCTION public.update_shipment_status(
  p_order_id uuid, p_status text, p_payload jsonb DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE public.store_order_shipments
  SET status = p_status, last_webhook_payload = COALESCE(p_payload, last_webhook_payload), updated_at = now()
  WHERE order_id = p_order_id;

  IF p_status = 'delivered' THEN
    UPDATE public.store_orders SET status = 'DELIVERED', updated_at = now()
    WHERE id = p_order_id AND status = 'SHIPPED';
    -- DELIVERED sonrası v5 order_status_engine'deki auto_advance_order_status
    -- trigger'ı otomatik olarak COMPLETED'e geçiriyor (mevcut davranış,
    -- değişiklik yok) → bu da escrow'u serbest bırakıyor.
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.update_shipment_status(uuid, text, jsonb) TO service_role;

-- Lojistik rolündeki kullanıcı ya da bayinin KENDİSİ elle "Teslim Edildi"
-- işaretleyebilsin diye — update_shipment_status'tan farklı olarak bu
-- authenticated'a açık ama içeride yetki kontrolü yapıyor (RLS'in UPDATE
-- politikası zaten aynı kontrolü yapıyor ama RPC + tetiklenen sipariş
-- durumu güncellemesini TEK ATOMIK işlemde yapmak için ayrı fonksiyon).
CREATE OR REPLACE FUNCTION public.mark_shipment_delivered_manual(p_order_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.store_orders so JOIN public.stores st ON st.id = so.store_id
    WHERE so.id = p_order_id
      AND (st.owner_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'logistics')))
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.store_order_shipments
  SET status = 'delivered', updated_at = now()
  WHERE order_id = p_order_id;

  UPDATE public.store_orders SET status = 'DELIVERED', updated_at = now()
  WHERE id = p_order_id AND status = 'SHIPPED';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.mark_shipment_delivered_manual(uuid) TO authenticated;

-- profiles.role check constraint'ine 'logistics' değerini ekle (yoksa).
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('customer', 'dealer', 'supplier', 'admin', 'influencer', 'logistics'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'profiles_role_check güncellenemedi — mevcut constraint farklı adlandırılmış olabilir, elle kontrol edin: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.store_order_shipments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
