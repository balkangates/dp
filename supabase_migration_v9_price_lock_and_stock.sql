-- =====================================================================
-- supabase_migration_v9_price_lock_and_stock.sql
-- FİYAT KİLİDİ + GERÇEK SİPARİŞ STOK DÜŞÜMÜ
-- =====================================================================
-- KAPSAM (kullanıcı onayına göre netleştirildi):
--   - İhale (auctions/products) sistemi bu migration'ın KAPSAMI DIŞINDA —
--     dokunulmuyor, kendi fiyatlandırmasıyla devam ediyor.
--   - Sadece YENİ vitrin/catalog akışı (catalog_products → store_products
--     → store_orders) için fiyat kilidi ve gerçek stok düşümü ekleniyor.
--
-- NOT: catalog_products'ta ayrı bir "price" kolonu yok — "suggested_price"
-- kolonu, ürün admin tarafından onaylandıktan (is_approved=true) sonra
-- fiilen MASTER FİYAT olarak kullanılıyor. Ayrı bir "price" kolonu açıp
-- veri çakışması riski almak yerine mevcut kolon bu amaçla kullanıldı.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. FİYAT KİLİDİ — store_products.price HER ZAMAN catalog_products.
--    suggested_price ile aynı olmak ZORUNDA. Bayi kendi fiyatını
--    giremez/değiştiremez — DB seviyesinde ZORLANIYOR (UI'da ayrıca
--    bir fiyat alanı gösterilse bile sunucu tarafı bunu geçersiz kılar).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_store_product_price_lock()
RETURNS trigger AS $$
DECLARE
  v_master_price numeric;
BEGIN
  IF NEW.catalog_product_id IS NOT NULL THEN
    SELECT suggested_price INTO v_master_price
    FROM public.catalog_products WHERE id = NEW.catalog_product_id;

    IF v_master_price IS NOT NULL THEN
      IF NEW.price IS DISTINCT FROM v_master_price THEN
        RAISE NOTICE 'Fiyat kilidi: bayi fiyatı (%) yok sayıldı, master fiyat (%) uygulandı.', NEW.price, v_master_price;
      END IF;
      NEW.price := v_master_price;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_price_lock ON public.store_products;
CREATE TRIGGER trg_enforce_price_lock
BEFORE INSERT OR UPDATE OF price, catalog_product_id ON public.store_products
FOR EACH ROW EXECUTE FUNCTION public.enforce_store_product_price_lock();

-- Master fiyat SONRADAN değişirse (admin/tedarikçi suggested_price'ı
-- günceller), o ürünü vitrininde bulunduran TÜM bayilerin fiyatı da
-- otomatik güncellensin — "ALL dealers must sell SAME price" kalıcı
-- olarak korunsun (sadece ekleme anında değil, her zaman).
CREATE OR REPLACE FUNCTION public.cascade_catalog_price_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.suggested_price IS DISTINCT FROM OLD.suggested_price THEN
    UPDATE public.store_products
    SET price = NEW.suggested_price, updated_at = now()
    WHERE catalog_product_id = NEW.id AND price IS DISTINCT FROM NEW.suggested_price;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cascade_catalog_price ON public.catalog_products;
CREATE TRIGGER trg_cascade_catalog_price
AFTER UPDATE OF suggested_price ON public.catalog_products
FOR EACH ROW EXECUTE FUNCTION public.cascade_catalog_price_change();

-- Geriye dönük düzeltme: bu migration çalıştığı anda zaten var olan ve
-- master fiyattan sapmış store_products satırlarını bir kerelik düzelt.
UPDATE public.store_products sp
SET price = cp.suggested_price
FROM public.catalog_products cp
WHERE sp.catalog_product_id = cp.id
  AND cp.suggested_price IS NOT NULL
  AND sp.price IS DISTINCT FROM cp.suggested_price;

-- ─────────────────────────────────────────────────────────────────────
-- 2. GERÇEK SİPARİŞ STOK DÜŞÜMÜ — store_order_items INSERT edildiğinde
--    store_products.stock_qty gerçekten düşer (önceden bunu yapan HİÇBİR
--    kod yoktu — live-sales.js'teki akış bilinçli olarak simülasyondu).
--    Stok 0'a inerse o bayi ürünü otomatik pasif olur.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_store_product_stock()
RETURNS trigger AS $$
DECLARE
  v_new_stock numeric;
BEGIN
  IF NEW.store_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.store_products
  SET stock_qty = GREATEST(stock_qty - NEW.quantity, 0),
      updated_at = now()
  WHERE id = NEW.store_product_id
  RETURNING stock_qty INTO v_new_stock;

  IF v_new_stock IS NOT NULL AND v_new_stock <= 0 THEN
    UPDATE public.store_products SET is_active = false WHERE id = NEW.store_product_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_decrement_store_stock ON public.store_order_items;
CREATE TRIGGER trg_decrement_store_stock
AFTER INSERT ON public.store_order_items
FOR EACH ROW EXECUTE FUNCTION public.decrement_store_product_stock();

-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS — customer'ın store_orders/store_order_items'a kendi adına
--    INSERT yapabilmesi lazım (modules/customer-stores.js bunu kullanıyor).
--    Eğer bu policy'ler zaten varsa (v3/v5'te tanımlanmış olabilir) bu
--    CREATE POLICY IF NOT EXISTS mantığıyla çakışmaz.
-- ─────────────────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_orders' AND policyname = 'customer_insert_own_order'
  ) THEN
    CREATE POLICY customer_insert_own_order ON public.store_orders
      FOR INSERT WITH CHECK (customer_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_orders' AND policyname = 'customer_read_own_order'
  ) THEN
    CREATE POLICY customer_read_own_order ON public.store_orders
      FOR SELECT USING (customer_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_order_items' AND policyname = 'customer_insert_own_order_item'
  ) THEN
    CREATE POLICY customer_insert_own_order_item ON public.store_order_items
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.store_orders so WHERE so.id = store_order_items.order_id AND so.customer_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'store_order_items' AND policyname = 'customer_read_own_order_item'
  ) THEN
    CREATE POLICY customer_read_own_order_item ON public.store_order_items
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.store_orders so WHERE so.id = store_order_items.order_id AND so.customer_id = auth.uid())
      );
  END IF;
END $do$;

-- =====================================================================
-- DOĞRULAMA (manuel):
-- SELECT sp.id, sp.price, cp.suggested_price FROM store_products sp
--   JOIN catalog_products cp ON cp.id = sp.catalog_product_id
--   WHERE sp.price IS DISTINCT FROM cp.suggested_price;
-- Beklenen: 0 satır.
-- =====================================================================
