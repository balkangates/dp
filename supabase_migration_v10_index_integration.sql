-- ═══════════════════════════════════════════════════════════════════
-- v10: index.html (müşteri/canlı satış SPA) entegrasyonu
--   1) product_videos: YouTube linki desteği
--   2) auctions: "descending" (azalan/toptan alım) ihaleler artık onaylı
--      ürün kataloğuna (catalog_products) bağlanabiliyor — eski 'products'
--      tablosuna zorunlu bağımlılık kaldırıldı, ikisinden biri yeterli.
--   3) auction_bids: "descending" tipteki ihalelere SADECE supplier
--      rolündeki kullanıcılar teklif verebilir (DB seviyesinde zorunlu).
--      Normal (ascending) tüketici ihaleleri etkilenmez, herkese açık kalır.
--   4) store_leaderboard: canlı liderlik tablosu için bayi mağaza sıralaması
-- ═══════════════════════════════════════════════════════════════════

-- 1) YouTube video kaynağı desteklenir hale getir
ALTER TABLE public.product_videos DROP CONSTRAINT IF EXISTS product_videos_source_check;
ALTER TABLE public.product_videos ADD CONSTRAINT product_videos_source_check
  CHECK (source = ANY (ARRAY['live_recording'::text, 'upload'::text, 'youtube'::text]));

-- 2) auctions: eski 'products' zorunluluğunu kaldır, onaylı katalog bağlantısı ekle
ALTER TABLE public.auctions ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS catalog_product_id uuid
  REFERENCES public.catalog_products(id);
ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_one_product_ref;
ALTER TABLE public.auctions ADD CONSTRAINT auctions_one_product_ref
  CHECK (product_id IS NOT NULL OR catalog_product_id IS NOT NULL);

-- 3) "descending" (toptan alım) ihalelerde sadece tedarikçi teklif verebilir
CREATE OR REPLACE FUNCTION public.enforce_descending_auction_supplier_only()
RETURNS TRIGGER AS $$
DECLARE
  a_type text;
  bidder_role text;
BEGIN
  SELECT auction_type INTO a_type FROM public.auctions WHERE id = NEW.auction_id;
  IF a_type = 'descending' THEN
    SELECT role INTO bidder_role FROM public.profiles WHERE id = NEW.bidder_id;
    IF bidder_role IS DISTINCT FROM 'supplier' THEN
      RAISE EXCEPTION 'Toptan alım ihalelerine sadece tedarikçi (supplier) rolündeki kullanıcılar teklif verebilir';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_descending_auction_supplier_only ON public.auction_bids;
CREATE TRIGGER trg_enforce_descending_auction_supplier_only
  BEFORE INSERT ON public.auction_bids
  FOR EACH ROW EXECUTE FUNCTION public.enforce_descending_auction_supplier_only();

-- 4) Canlı Liderlik Tablosu — bayi mağazalarını bu ayki ciroya göre sıralar
CREATE OR REPLACE VIEW public.store_leaderboard AS
SELECT
  s.id,
  s.name,
  s.logo_url,
  s.is_live,
  s.city,
  COALESCE(SUM(so.total_amount) FILTER (
    WHERE so.status IS DISTINCT FROM 'CANCELLED'
      AND so.created_at >= date_trunc('month', now())
  ), 0) AS total_revenue,
  COUNT(so.id) FILTER (
    WHERE so.status IS DISTINCT FROM 'CANCELLED'
      AND so.created_at >= date_trunc('month', now())
  ) AS total_sales
FROM public.stores s
LEFT JOIN public.store_orders so ON so.store_id = s.id
WHERE s.status = 'active'
GROUP BY s.id;
