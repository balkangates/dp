-- =====================================================================
-- fix_phase3_video_call_and_negotiation.sql
-- ─────────────────────────────────────────────────────────────────────
-- FAZ 3: Alıcı ile bayi satış temsilcisinin BİREBİR görüntülü görüşmesi
-- + pazarlık (teklif/karşı teklif) akışı.
--
-- Önceden sistemde SADECE tek yönlü canlı yayın vardı (bayi → herkes
-- izler). Bu migration, müşterinin "Görüntülü Görüş" isteği atıp bayinin
-- kabul ettiği, İKİ TARAFIN DA kamerasını açtığı ayrı bir LiveKit oda
-- modelini yönetecek sinyalleşme tablosunu + ürün bazlı fiyat pazarlığı
-- tablosunu ekliyor.
--
-- ÇALIŞTIRMA: Supabase SQL Editor'e yapıştır, RUN.
-- =====================================================================

-- ── 1. Görüntülü görüşme istekleri (LiveKit oda sinyalleşmesi) ─────────
CREATE TABLE IF NOT EXISTS public.call_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  customer_id uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'rejected', 'ended', 'missed')),
  room_name text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_call_requests_store ON public.call_requests(store_id, status);
CREATE INDEX IF NOT EXISTS idx_call_requests_customer ON public.call_requests(customer_id, status);

ALTER TABLE public.call_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_requests_participants_read ON public.call_requests;
CREATE POLICY call_requests_participants_read ON public.call_requests FOR SELECT USING (
  customer_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.stores st WHERE st.id = call_requests.store_id AND st.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS call_requests_customer_insert ON public.call_requests;
CREATE POLICY call_requests_customer_insert ON public.call_requests FOR INSERT WITH CHECK (
  customer_id = auth.uid()
);

DROP POLICY IF EXISTS call_requests_participants_update ON public.call_requests;
CREATE POLICY call_requests_participants_update ON public.call_requests FOR UPDATE USING (
  customer_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.stores st WHERE st.id = call_requests.store_id AND st.owner_id = auth.uid())
);

-- ── 2. Fiyat pazarlığı (teklif / karşı teklif) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.negotiation_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_product_id uuid NOT NULL REFERENCES public.store_products(id),
  customer_id uuid NOT NULL REFERENCES public.profiles(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  offered_unit_price numeric NOT NULL CHECK (offered_unit_price > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'countered', 'expired')),
  counter_price numeric,
  call_request_id uuid REFERENCES public.call_requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_negotiation_offers_customer ON public.negotiation_offers(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_negotiation_offers_product ON public.negotiation_offers(store_product_id, status);

ALTER TABLE public.negotiation_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS negotiation_offers_participants_read ON public.negotiation_offers;
CREATE POLICY negotiation_offers_participants_read ON public.negotiation_offers FOR SELECT USING (
  customer_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.store_products sp JOIN public.stores st ON st.id = sp.store_id
    WHERE sp.id = negotiation_offers.store_product_id AND st.owner_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS negotiation_offers_customer_insert ON public.negotiation_offers;
CREATE POLICY negotiation_offers_customer_insert ON public.negotiation_offers FOR INSERT WITH CHECK (
  customer_id = auth.uid()
);

DROP POLICY IF EXISTS negotiation_offers_participants_update ON public.negotiation_offers;
CREATE POLICY negotiation_offers_participants_update ON public.negotiation_offers FOR UPDATE USING (
  customer_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.store_products sp JOIN public.stores st ON st.id = sp.store_id
    WHERE sp.id = negotiation_offers.store_product_id AND st.owner_id = auth.uid()
  )
);

-- Realtime yayınına ekle (Supabase varsayılan "supabase_realtime" publication'ı)
-- — script tekrar çalıştırılırsa hata vermesin diye DO bloğuyla sarıldı.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.call_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.negotiation_offers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
