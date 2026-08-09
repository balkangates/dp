-- =====================================================================
-- fix_phase6_live_commerce_triggers.sql
-- ─────────────────────────────────────────────────────────────────────
-- FAZ 6 tamamlama: TikTok-shop tarzı canlı satış yeniden tasarımının
-- (pazarlık kaldırma, BUY NOW, bottom-sheet sepet, StoreSocialBar) HÂLÂ
-- eksik olan "zorunlu psikolojik tetikleyiciler + yayıncı kontrolü"
-- kısmı:
--   - Flash indirim (bayi bir ürüne süreli özel fiyat açabilir)
--   - Spotlight/öne çıkan ürün (bayi hangi ürünü anlatıyorsa müşteri
--     tarafında otomatik öne çıksın — gerçek zamanlı)
--   - Sosyal kanıt ("12 kişi aldı") ve canlı aktivite ("Mehmet az önce
--     satın aldı") — gerçek sipariş verisinden, UYDURULMUŞ SAYI DEĞİL.
--
-- ÇALIŞTIRMA: Supabase SQL Editor'e yapıştır, RUN.
-- =====================================================================

ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS flash_price numeric,
  ADD COLUMN IF NOT EXISTS flash_price_ends_at timestamptz;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS spotlight_product_id uuid REFERENCES public.store_products(id);

-- Gerçek satın alma sayısı (sahte/uydurma değil) — CONFIRMED ve sonrası
-- durumdaki siparişlerden ürün bazlı toplam adet.
CREATE OR REPLACE VIEW public.v_store_product_purchase_counts AS
SELECT
  soi.store_product_id,
  count(DISTINCT so.id) AS order_count,
  coalesce(sum(soi.quantity), 0) AS total_qty
FROM public.store_order_items soi
JOIN public.store_orders so ON so.id = soi.order_id
WHERE so.status NOT IN ('PAYMENT_PENDING', 'CANCELLED')
GROUP BY soi.store_product_id;

GRANT SELECT ON public.v_store_product_purchase_counts TO authenticated, anon;

-- Bayi flash fiyat açtığında/kapattığında kullanılan RPC'ler — sadece
-- mağaza sahibi kendi ürününe uygulayabilir.
CREATE OR REPLACE FUNCTION public.set_flash_price(p_store_product_id uuid, p_price numeric, p_minutes integer)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.store_products sp JOIN public.stores st ON st.id = sp.store_id
    WHERE sp.id = p_store_product_id AND st.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  IF p_price <= 0 THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;

  UPDATE public.store_products
  SET flash_price = p_price, flash_price_ends_at = now() + make_interval(mins => p_minutes)
  WHERE id = p_store_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.clear_flash_price(p_store_product_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.store_products sp JOIN public.stores st ON st.id = sp.store_id
    WHERE sp.id = p_store_product_id AND st.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.store_products SET flash_price = NULL, flash_price_ends_at = NULL WHERE id = p_store_product_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.set_spotlight_product(p_store_id uuid, p_store_product_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.stores SET spotlight_product_id = p_store_product_id WHERE id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_flash_price(uuid, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_flash_price(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_spotlight_product(uuid, uuid) TO authenticated;

-- stores.spotlight_product_id realtime ile dinlenecek — zaten
-- supabase_realtime publication'ında olmalı (stores tablosu genel
-- olarak zaten realtime'a açıktı, is_live için kullanılıyordu).
