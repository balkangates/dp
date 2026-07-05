-- =====================================================================
-- supabase_migration_v8_legacy_freeze_notice.sql
-- ORDERS vs STORE_ORDERS — MİMARİ KARAR (Faz 1)
-- =====================================================================
-- KARAR: store_orders + catalog_products + store_products mimarisi
-- KALICI. public.orders + public.products (bireysel ilan modeli)
-- LEGACY — yeni geliştirme almaz, sadece mevcut veri/entegrasyonlar
-- (fatura, escrow, PDF, muhasebe) için korunuyor.
--
-- Bu migration HİÇBİR VERİYİ DEĞİŞTİRMEZ, HİÇBİR ŞEYİ SİLMEZ/KISITLAMAZ.
-- Sadece COMMENT ON TABLE ile niyeti DB seviyesinde belgeliyor — bundan
-- sonra bu şemaya bakan herkes (insan ya da bir sonraki AI oturumu)
-- hangi tabloyu kullanması gerektiğini migration dosyalarını tek tek
-- okumadan, doğrudan \d+ tablename ile görsün. Bu conversation'da tekrar
-- tekrar yaşanan "paralel, birbirinden habersiz sistem" sorununun kök
-- nedeni koordinasyon eksikliğiydi — bu, ona karşı en ucuz önlem.
-- =====================================================================

COMMENT ON TABLE public.orders IS
  'LEGACY (bireysel ilan modeli). YENİ GELİŞTİRME ALMAZ. store_orders mimarisi kalıcı seçildi (Faz 1). Bu tablo sadece mevcut veri + fatura/escrow/PDF entegrasyonları için korunuyor. Dashboard "Sipariş Listesi" sayfası bunu store_orders ile birlikte, AYRI bir bölümde gösteriyor (bkz. dashboard.html loadStoreOrders()).';

COMMENT ON TABLE public.order_items IS
  'LEGACY — bkz. public.orders yorumu. Yeni satış kalemleri store_order_items üzerinden yönetilmeli.';

COMMENT ON TABLE public.products IS
  'LEGACY (bireysel ürün/ihale modeli). YENİ ürünler catalog_products (merkez) + store_products (bayi vitrini) üzerinden eklenmeli. auctions/auction_bids bu tabloya bağlı kalmaya devam ediyor — ihale özelliği bu kararla KALDIRILMIYOR, sadece "sıradan ürün ekle/satın al" akışı için yeni geliştirme burada durduruldu.';

COMMENT ON TABLE public.store_orders IS
  'KALICI MİMARİ (Faz 1 kararı). Canlı Satış / Bayi Vitrini siparişleri. Yeni sipariş akışlarının tamamı buraya yazılmalı. NOT: şu an escrow/fatura/PDF entegrasyonu YOK — bunlar Faz 2/3 kapsamı.';

COMMENT ON TABLE public.catalog_products IS
  'KALICI MİMARİ (Faz 1 kararı). Merkezi, admin onaylı ürün kataloğu. Yeni tüm ürünler buradan başlamalı (bkz. supplier.js "Yeni Ürün Öner").';

COMMENT ON TABLE public.store_products IS
  'KALICI MİMARİ (Faz 1 kararı). Bayinin catalog_products''tan seçtiği vitrin. Stok=0 olduğunda catalog_products üzerinden otomatik pasif olur (bkz. v4 migration, sync_catalog_product_stock trigger).';

-- =====================================================================
-- Faz 2/3 için AÇIK KALAN sorular (bu migration bunları ÇÖZMÜYOR,
-- sadece kayıt altına alıyor — bir sonraki karar noktası burası olmalı):
--   1. invoices/commissions/escrow_wallets/accounting sayfaları hâlâ
--      sadece orders'a bağlı — store_orders için bir fatura/escrow
--      akışı henüz tasarlanmadı.
--   2. Yeni bayi kaydı olduğunda `products` tablosuna yazma izni hâlâ
--      açık mı, yoksa dealer rolü artık sadece catalog_products'tan mı
--      seçmeli? (RLS düzeyinde henüz zorlanmıyor.)
--   3. auctions/auction_bids'in uzun vadede store_products ile nasıl
--      bir arada çalışacağı (bayi hem vitrin hem ihale açabilir mi?)
--      ayrı bir ürün kararı gerektiriyor.
-- =====================================================================
