-- =====================================================================
-- supabase_migration_v11_franchise_supplier_rpc.sql
-- FAZ D: SupplierPanel.tsx'in ihtiyaç duyduğu fn_my_bid_rank() RPC'si
-- FAZ B: dealer dashboard.html'den ihale başlatır, index.html'de müşteri
--        salt-okunur (azalan teklif) görünümü görür — supplier bid detayı
--        müşteriye/dealer'a asla tekil olarak sızmaz, sadece agregat.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 0. GÜVENCE: v10_catalog_auction_and_video.sql henüz çalışmamış olabilir
--    (bir önceki analizde demands/reverse_auctions'ta catalog_product_id
--    kolonlarının olmadığı doğrulanmıştı). Bu ALTER'lar IF NOT EXISTS
--    olduğu için burada TEKRAR çalıştırmak zararsız — hangi migration'ın
--    fiilen uygulandığından bağımsız olarak bu dosya kendi başına yeterli.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.demands
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products(id);
ALTER TABLE public.demand_aggregates
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products(id);
ALTER TABLE public.reverse_auctions
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.catalog_products(id);

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_my_bid_rank — tedarikçinin KENDİ sıralamasını görmesi için.
--    Rakiplerin unit_price'ını asla döndürmez — sadece "kaçıncısın,
--    kaç kişi var, en düşük teklif kaç" (agregat). Bir tedarikçi aynı
--    ihaleye birden fazla teklif verebildiği için (submitBid upsert
--    yapmıyor) her tedarikçinin EN İYİ (en düşük) teklifi baz alınıyor.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_my_bid_rank(p_auction_id uuid, p_supplier_id uuid)
RETURNS TABLE (my_rank int, total_bidders int, lowest_price numeric) AS $$
  WITH best_bids AS (
    SELECT supplier_id, MIN(unit_price) AS best_price
    FROM public.supplier_bids
    WHERE auction_id = p_auction_id AND status <> 'withdrawn'
    GROUP BY supplier_id
  ),
  ranked AS (
    SELECT supplier_id, best_price, RANK() OVER (ORDER BY best_price ASC)::int AS rnk
    FROM best_bids
  )
  SELECT
    (SELECT rnk FROM ranked WHERE supplier_id = p_supplier_id),
    (SELECT COUNT(*)::int FROM ranked),
    (SELECT MIN(best_price) FROM ranked);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 2. FAZ B — MÜŞTERİ TARAFI SALT-OKUNUR İHALE ÖZETİ
--    index.html'de "Mağaza Seçildiğinde Mağazaya ait Canlı İhale Süreci"
--    gösterilecek — ama customer'ın supplier_bids'i DOĞRUDAN okumasına
--    izin YOK (RLS: sadece admin/dealer/kendi supplier'ı okuyabiliyor —
--    bkz. v10_catalog_auction_and_video.sql §4). Bu yüzden customer'a
--    SADECE agregat (kaç teklif, en düşük fiyat) döndüren ayrı, güvenli
--    bir RPC. Tedarikçi kimlikleri/tekil teklifleri asla dönmez.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_public_auction_status(p_reverse_auction_id uuid)
RETURNS TABLE (bid_count int, lowest_price numeric, status text, end_time timestamptz) AS $$
  SELECT
    (SELECT COUNT(*)::int FROM public.supplier_bids sb WHERE sb.auction_id = p_reverse_auction_id AND sb.status <> 'withdrawn'),
    (SELECT MIN(unit_price) FROM public.supplier_bids sb WHERE sb.auction_id = p_reverse_auction_id AND sb.status <> 'withdrawn'),
    ra.status,
    ra.end_time
  FROM public.reverse_auctions ra
  WHERE ra.id = p_reverse_auction_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Bir mağazanın (store_id) o an açık olan toptan ihalelerini listelemek için
-- (demands → aggregate_id → reverse_auctions köprüsü):
CREATE OR REPLACE FUNCTION public.fn_store_active_auctions(p_store_id uuid)
RETURNS TABLE (
  reverse_auction_id uuid, product_name text, total_quantity numeric,
  quantity_unit text, ceiling_price numeric, end_time timestamptz,
  status text, bid_count int, lowest_price numeric
) AS $$
  SELECT
    ra.id, ra.product_name, ra.total_quantity, ra.quantity_unit, ra.ceiling_price, ra.end_time, ra.status,
    (SELECT COUNT(*)::int FROM public.supplier_bids sb WHERE sb.auction_id = ra.id AND sb.status <> 'withdrawn'),
    (SELECT MIN(unit_price) FROM public.supplier_bids sb WHERE sb.auction_id = ra.id AND sb.status <> 'withdrawn')
  FROM public.demands d
  JOIN public.reverse_auctions ra ON ra.aggregate_id = d.aggregate_id
  WHERE d.store_id = p_store_id AND ra.status = 'active'
  ORDER BY ra.end_time ASC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Bu 3 fonksiyon SECURITY DEFINER + sadece agregat döndürdüğü için
-- authenticated herkese EXECUTE izni verilebilir (RLS'i bypass etmiyor,
-- sadece supplier_bids'in HAM satırlarını değil özetini döndürüyor):
GRANT EXECUTE ON FUNCTION public.fn_my_bid_rank(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_auction_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_store_active_auctions(uuid) TO authenticated;
