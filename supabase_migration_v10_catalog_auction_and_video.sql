-- =====================================================================
-- supabase_migration_v10_catalog_auction_and_video.sql
-- 1) reverse_auctions/demand_aggregates/demands → catalog_products
--    entegrasyonu (serbest metin yerine gerçek FK)
-- 2) store_products → YouTube tanıtım video linki (Storage kullanılmıyor)
-- 3) "Toptan İhale Başlat" RPC'si — SADECE dealer (mağaza sahibi) çağırabilir
-- 4) supplier_bids — SADECE supplier rolü INSERT edebilir (RLS)
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. KATALOG ENTEGRASYONU
-- ─────────────────────────────────────────────────────────────────────
-- ÖNEMLİ NOT: demands/demand_aggregates/reverse_auctions daha önce SADECE
-- serbest metin (product_name/category) ile çalışıyordu — hiçbir tabloya
-- FK'si yoktu (ne eski products'a, ne yeni catalog_products'a). Bu
-- migration'la bunlara catalog_products FK'si EKLENİYOR (nullable —
-- geriye dönük eski/serbest-metin kayıtlar bozulmaz).
ALTER TABLE public.demands
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products(id);

ALTER TABLE public.demand_aggregates
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products(id);

ALTER TABLE public.reverse_auctions
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products(id);

-- ─────────────────────────────────────────────────────────────────────
-- 2. TANITIM VİDEOSU — YouTube linki. store_products'a YENİ bir kolon
--    AÇILMADI — public.product_videos tablosu zaten var ve dealer-catalog.js
--    "has_video" zorunluluğunu bu tablo üzerinden kontrol ediyordu
--    (source: 'live_recording' | 'upload'). Buraya SADECE 'youtube'
--    kaynağını ekliyoruz — Supabase Storage'a video YÜKLEMEK yerine link
--    kaydedilebilsin, has_video mantığı hiç değişmeden çalışmaya devam
--    etsin (aynı tablo, aynı trigger, tek yeni CHECK değeri).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.product_videos DROP CONSTRAINT IF EXISTS product_videos_source_check;
ALTER TABLE public.product_videos ADD CONSTRAINT product_videos_source_check
  CHECK (source = ANY (ARRAY['live_recording'::text, 'upload'::text, 'youtube'::text]));

-- ─────────────────────────────────────────────────────────────────────
-- 3. "TOPTAN İHALE BAŞLAT" — dealer, onaylı katalogdan seçtiği ürün için
--    tek adımda demand_aggregate + demand + reverse_auction oluşturur.
--    NOT: gerçek "çoklu bayi talebi biriktirme" (aggregation) motoru henüz
--    yok — bu fonksiyon her çağrıda kendi tek-bayilik aggregate'ini açıyor
--    (ileride birden fazla bayinin aynı ürüne talebi birleştirilmek
--    istenirse, bu fonksiyon var olan açık bir aggregate'i arayıp ona
--    demand eklemek üzere genişletilebilir — bu migration'ın kapsamı bu
--    değil, sadece "dealer ihale başlatabilsin" istendi).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_wholesale_auction(
  p_catalog_product_id uuid,
  p_quantity numeric,
  p_quantity_unit text,
  p_ceiling_price numeric,
  p_hours_open integer DEFAULT 48
)
RETURNS uuid AS $$
DECLARE
  v_store_id uuid;
  v_role text;
  v_product_name text;
  v_category text;
  v_aggregate_id uuid;
  v_demand_id uuid;
  v_auction_id uuid;
BEGIN
  -- Sadece dealer (ve mağazası olan) çağırabilir — UI'daki role gate'in
  -- YANINDA, DB seviyesinde de zorlanıyor.
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'dealer' THEN
    RAISE EXCEPTION 'Yetkisiz: toptan ihale sadece dealer rolü tarafından başlatılabilir.';
  END IF;

  SELECT id INTO v_store_id FROM public.stores WHERE owner_id = auth.uid();
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Önce bir mağaza oluşturmalısınız.';
  END IF;

  SELECT cp.name, c.name INTO v_product_name, v_category
  FROM public.catalog_products cp
  LEFT JOIN public.categories c ON c.id = cp.category_id
  WHERE cp.id = p_catalog_product_id AND cp.is_approved = true;

  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Ürün bulunamadı veya onaylı değil.';
  END IF;

  INSERT INTO public.demand_aggregates (product_name, category, quantity_unit, total_quantity, ceiling_price, status, catalog_product_id)
  VALUES (v_product_name, v_category, p_quantity_unit, p_quantity, p_ceiling_price, 'auctioned', p_catalog_product_id)
  RETURNING id INTO v_aggregate_id;

  INSERT INTO public.demands (store_id, product_name, category, quantity, quantity_unit, target_price, status, aggregate_id, catalog_product_id)
  VALUES (v_store_id, v_product_name, v_category, p_quantity, p_quantity_unit, p_ceiling_price, 'aggregated', v_aggregate_id, p_catalog_product_id)
  RETURNING id INTO v_demand_id;

  INSERT INTO public.reverse_auctions (aggregate_id, product_name, total_quantity, quantity_unit, ceiling_price, end_time, status, catalog_product_id)
  VALUES (v_aggregate_id, v_product_name, p_quantity, p_quantity_unit, p_ceiling_price, now() + (p_hours_open || ' hours')::interval, 'active', p_catalog_product_id)
  RETURNING id INTO v_auction_id;

  RETURN v_auction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 4. RLS — supplier_bids'e SADECE supplier rolü INSERT edebilir.
--    (supplier.js zaten UI'da bunu supplier menüsüne hapsediyordu, ama
--    "sadece supplier teklif verebilir olmalı" ifadesi DB seviyesinde de
--    zorlanmalı — savunma katmanı.)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.supplier_bids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_bids_supplier_insert ON public.supplier_bids;
CREATE POLICY supplier_bids_supplier_insert ON public.supplier_bids
  FOR INSERT WITH CHECK (
    supplier_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'supplier')
  );

DROP POLICY IF EXISTS supplier_bids_read ON public.supplier_bids;
CREATE POLICY supplier_bids_read ON public.supplier_bids
  FOR SELECT USING (
    supplier_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'dealer'))
  );

-- reverse_auctions/demands/demand_aggregates herkese (giriş yapmış
-- supplier/dealer/admin) okunabilir olmalı ki teklif verme/izleme akışı
-- çalışsın — zaten supplier.js bunu okuyordu, burada sadece dealer'ın
-- KENDİ demand/aggregate'ini oluşturabildiğini garanti ediyoruz:
ALTER TABLE public.demands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demands_dealer_insert ON public.demands;
CREATE POLICY demands_dealer_insert ON public.demands
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores st WHERE st.id = demands.store_id AND st.owner_id = auth.uid())
  );
DROP POLICY IF EXISTS demands_read ON public.demands;
CREATE POLICY demands_read ON public.demands FOR SELECT USING (true);
