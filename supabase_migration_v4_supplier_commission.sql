-- =====================================================================
-- supabase_migration_v4_supplier_commission.sql
-- MODÜL 3.6 — TEDARİKÇİ, STOK, FATURALAMA VE KOMİSYON SİSTEMİ
-- =====================================================================
-- Run AFTER v1, v2, v3 (dealer_core) migrations.
--
-- MİMARİ KARAR (kullanıcı tarafından verildi, bu migration buna göre
-- kuruldu): bu modül SADECE catalog_products + store_products üzerine
-- kurulur. public.products (eski bireysel ilan modeli) bu modüle HİÇ
-- dahil edilmez. reverse_auctions / supplier_bids / demands mevcut
-- haliyle kullanılır — yeni bir wholesale_auctions/bids tablosu YOK.
--
-- Faturalama notu: "fatura tedarikçi tarafından müşteri adına kesilir"
-- kuralı bir MUHASEBE/ERP süreci — bu migration bunu bir DB kısıtı olarak
-- ZORLAMIYOR (yani "sistemde INSERT'i engelleyen bir trigger" yok), çünkü
-- fatura kesme fiili bir e-fatura entegratörü işi ve bu şemanın dışında.
-- Burada yapılan: her komisyon/kazanç kaydı hangi tedarikçi/kategori/
-- satıştan geldiğini net tutuyor ki muhasebe/entegrator tarafı bu
-- kayıtları güvenilir kaynak olarak kullanabilsin.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. STOK (VARYANT BAZLI) — "Her ürün için stoklar Renk/Beden/Model
--    varyantlarıyla tutulur. Stok takibi tamamen tedarikçi panelinden
--    yapılır."
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  catalog_product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  color text,
  size text,
  model text,
  sku text,
  stock_qty numeric NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_pkey PRIMARY KEY (id),
  CONSTRAINT product_variants_unique UNIQUE (catalog_product_id, color, size, model)
);
CREATE INDEX IF NOT EXISTS idx_product_variants_catalog ON public.product_variants(catalog_product_id);

-- catalog_products'a stok/aktiflik ayrımı: is_approved = admin onayı verdi
-- mi (kalıcı); is_active = ŞU AN satılabilir mi (stok durumuna göre
-- dinamik). İkisi farklı kavram, tek kolonla karışıklık yaratmasın diye
-- ayrı tutuluyor.
ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────────────────────────────
-- 2. STOK=0 → OTOMATİK PASİF + TÜM BAYİ VİTRİNLERİNDEN KALDIRMA
--    (Kritik senaryo — kullanıcının kendi belirttiği akış):
--      UPDATE catalog_products SET is_active=false → cascade →
--      UPDATE store_products SET is_active=false WHERE catalog_product_id=X
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_catalog_product_stock()
RETURNS trigger AS $$
DECLARE
  target_id uuid := COALESCE(NEW.catalog_product_id, OLD.catalog_product_id);
  total_stock numeric;
  was_active boolean;
  now_active boolean;
BEGIN
  SELECT COALESCE(SUM(stock_qty), 0) INTO total_stock
  FROM public.product_variants WHERE catalog_product_id = target_id;

  SELECT is_active INTO was_active FROM public.catalog_products WHERE id = target_id;
  now_active := total_stock > 0;

  IF now_active IS DISTINCT FROM was_active THEN
    UPDATE public.catalog_products SET is_active = now_active, updated_at = now() WHERE id = target_id;

    IF NOT now_active THEN
      -- Stok bitti: TÜM bayilerin vitrininden AYNI ANDA kaldır.
      UPDATE public.store_products SET is_active = false, updated_at = now()
      WHERE catalog_product_id = target_id AND is_active = true;
    ELSE
      -- Stok yeniden eklendi: sadece VİDEOSU OLAN bayi ürünlerini otomatik
      -- aktive et — dealer_core sistemindeki "video yoksa aktif olamaz"
      -- kuralını (enforce_video_before_active trigger'ı) burada da
      -- bilerek koruyoruz, video eksik olanlar pasif kalıp bayiden video
      -- yüklemesini bekler.
      UPDATE public.store_products SET is_active = true, updated_at = now()
      WHERE catalog_product_id = target_id AND is_active = false AND has_video = true;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_catalog_stock ON public.product_variants;
CREATE TRIGGER trg_sync_catalog_stock
AFTER INSERT OR UPDATE OF stock_qty OR DELETE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.sync_catalog_product_stock();

-- ─────────────────────────────────────────────────────────────────────
-- 3. EKSİK SİPARİŞ YÜKÜMLÜLÜĞÜ — "Stokta görünmesine rağmen eksik
--    gönderilen ürünleri tedarikçi tamamlamak zorunda. Loglanır: Eksik
--    Sipariş / Tamamlama Süresi / Ceza-Puan."
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_order_shortfalls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.profiles(id),
  catalog_product_id uuid REFERENCES public.catalog_products(id),
  store_order_item_id uuid REFERENCES public.store_order_items(id),
  shortfall_qty numeric NOT NULL CHECK (shortfall_qty > 0),
  deadline_at timestamp with time zone NOT NULL,
  penalty_points numeric NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open'::text,'resolved'::text,'overdue'::text])),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  CONSTRAINT supplier_order_shortfalls_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_shortfalls_supplier ON public.supplier_order_shortfalls(supplier_id, status);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS supplier_penalty_score numeric NOT NULL DEFAULT 0;

-- Termin geçtiği halde hâlâ 'open' olan kayıtları 'overdue' yapan ve ceza
-- puanını işleyen fonksiyon — günlük cron ile çağrılır (bkz. §8).
CREATE OR REPLACE FUNCTION public.sweep_overdue_shortfalls()
RETURNS void AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM public.supplier_order_shortfalls
    WHERE status = 'open' AND deadline_at < now()
  LOOP
    UPDATE public.supplier_order_shortfalls SET status = 'overdue' WHERE id = r.id;
    UPDATE public.profiles SET supplier_penalty_score = supplier_penalty_score + r.penalty_points WHERE id = r.supplier_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bir eksik sipariş 'resolved' olarak işaretlendiğinde (tedarikçi
-- tamamladı) — deadline geçmişse yine de geç kalınmış olduğu için ceza
-- kalıcıdır (sweep zaten işlemiştir), sadece resolved_at damgalanır.
CREATE OR REPLACE FUNCTION public.mark_shortfall_resolved(p_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.supplier_order_shortfalls
  SET status = 'resolved', resolved_at = now()
  WHERE id = p_id AND status IN ('open', 'overdue');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 4. KATEGORİ KOMİSYON ORANLARI — "kategori_kartlari tablosunda
--    tanımlıdır (%)". MİMARİ KARAR: ayrı bir tablo değil, mevcut
--    public.categories tablosu zaten "kategori kartı" — sadece komisyon
--    oranı kolonu ekleniyor (duplike tablo = veri çakışması riski).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS commission_pct numeric NOT NULL DEFAULT 10
    CHECK (commission_pct >= 0 AND commission_pct <= 100);

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('default_commission_pct',  10, 'Kategoriye özel oran tanımlı değilse kullanılan varsayılan bayi komisyon oranı (%).'),
  ('referral_bonus_pct',       5, 'Bayinin önerdiği ve kataloğa kabul edilen üründen kazandığı EK komisyon oranı (%).')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 5. BAYİ ÜRÜN ÖNERİSİ + TEDARİKÇİ KAZANDIRMA (+%5 EK KOMİSYON)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_suggestions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  suggested_by_store_id uuid NOT NULL REFERENCES public.stores(id),
  product_name text NOT NULL,
  category_id uuid REFERENCES public.categories(id),
  supplier_contact_info text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text,'accepted'::text,'rejected'::text])),
  resulting_catalog_product_id uuid REFERENCES public.catalog_products(id),
  bonus_pct numeric NOT NULL DEFAULT 5,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  CONSTRAINT product_suggestions_pkey PRIMARY KEY (id)
);

-- Admin bir öneriyi kabul edip yeni/var olan bir catalog_product'a
-- bağladığında çağrılır — öneren bayi o üründen satış oldukça referral
-- komisyonu almaya başlar (bkz. §6 compute_order_item_commissions).
CREATE OR REPLACE FUNCTION public.accept_product_suggestion(p_id uuid, p_catalog_product_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.product_suggestions
  SET status = 'accepted', resulting_catalog_product_id = p_catalog_product_id, resolved_at = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 6. KOMİSYON HESAPLAMA — her satışta kategori oranına göre bayi
--    komisyonu + (varsa) öneren bayiye referral bonus. Tetikleyici:
--    store_orders.status → 'delivered' (satış fiilen tamamlandı).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_commissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  store_order_item_id uuid REFERENCES public.store_order_items(id),
  store_id uuid NOT NULL REFERENCES public.stores(id),        -- kazanan bayi (satan VEYA öneren)
  sale_store_id uuid NOT NULL REFERENCES public.stores(id),    -- satışı gerçekleştiren bayi
  catalog_product_id uuid REFERENCES public.catalog_products(id),
  category_id uuid REFERENCES public.categories(id),
  commission_type text NOT NULL DEFAULT 'sale' CHECK (commission_type = ANY (ARRAY['sale'::text,'referral_bonus'::text])),
  sale_amount numeric NOT NULL,
  rate_pct numeric NOT NULL,
  amount numeric NOT NULL,
  period_year integer NOT NULL,
  period_month integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT dealer_commissions_pkey PRIMARY KEY (id),
  CONSTRAINT dealer_commissions_unique UNIQUE (store_order_item_id, store_id, commission_type)
);
CREATE INDEX IF NOT EXISTS idx_dealer_commissions_store_period ON public.dealer_commissions(store_id, period_year, period_month);

CREATE OR REPLACE FUNCTION public.compute_order_item_commissions(p_order_id uuid)
RETURNS void AS $$
DECLARE
  it RECORD;
  v_seller_store_id uuid;
  v_category_id uuid;
  v_catalog_id uuid;
  v_rate numeric;
  v_amount numeric;
  v_year int := EXTRACT(YEAR FROM now());
  v_month int := EXTRACT(MONTH FROM now());
  v_suggestion RECORD;
  default_rate numeric := COALESCE((SELECT value FROM public.platform_settings WHERE key = 'default_commission_pct'), 10);
BEGIN
  SELECT store_id INTO v_seller_store_id FROM public.store_orders WHERE id = p_order_id;

  FOR it IN
    SELECT soi.*, sp.catalog_product_id, sp.category_id
    FROM public.store_order_items soi
    LEFT JOIN public.store_products sp ON sp.id = soi.store_product_id
    WHERE soi.order_id = p_order_id
  LOOP
    v_catalog_id := it.catalog_product_id;
    v_category_id := it.category_id;
    SELECT commission_pct INTO v_rate FROM public.categories WHERE id = v_category_id;
    v_rate := COALESCE(v_rate, default_rate);
    v_amount := ROUND(it.total_price * v_rate / 100, 2);

    INSERT INTO public.dealer_commissions
      (store_order_item_id, store_id, sale_store_id, catalog_product_id, category_id, commission_type, sale_amount, rate_pct, amount, period_year, period_month)
    VALUES (it.id, v_seller_store_id, v_seller_store_id, v_catalog_id, v_category_id, 'sale', it.total_price, v_rate, v_amount, v_year, v_month)
    ON CONFLICT (store_order_item_id, store_id, commission_type) DO NOTHING;

    -- Referral bonus: bu ürün kabul edilmiş bir bayi önerisinden geldiyse
    -- VE satışı yapan bayi öneren bayinin kendisi DEĞİLSE, öneren bayiye
    -- +%5 (platform_settings.referral_bonus_pct) ek komisyon yaz.
    IF v_catalog_id IS NOT NULL THEN
      SELECT * INTO v_suggestion FROM public.product_suggestions
      WHERE resulting_catalog_product_id = v_catalog_id AND status = 'accepted'
      LIMIT 1;

      IF v_suggestion.id IS NOT NULL AND v_suggestion.suggested_by_store_id <> v_seller_store_id THEN
        INSERT INTO public.dealer_commissions
          (store_order_item_id, store_id, sale_store_id, catalog_product_id, category_id, commission_type, sale_amount, rate_pct, amount, period_year, period_month)
        VALUES (it.id, v_suggestion.suggested_by_store_id, v_seller_store_id, v_catalog_id, v_category_id, 'referral_bonus',
                it.total_price, v_suggestion.bonus_pct, ROUND(it.total_price * v_suggestion.bonus_pct / 100, 2), v_year, v_month)
        ON CONFLICT (store_order_item_id, store_id, commission_type) DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_store_order_delivered()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    PERFORM public.compute_order_item_commissions(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_store_order_delivered ON public.store_orders;
CREATE TRIGGER trg_store_order_delivered
AFTER UPDATE OF status ON public.store_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_store_order_delivered();

-- ─────────────────────────────────────────────────────────────────────
-- 7. KOMİSYON ÖDEME TAKVİMİ — aylık, sonraki ayın ilk mesai günü.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_earnings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  period_year integer NOT NULL,
  period_month integer NOT NULL,
  gross_commission numeric NOT NULL DEFAULT 0,
  referral_bonus numeric NOT NULL DEFAULT 0,
  total_payable numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status = ANY (ARRAY['pending'::text,'paid'::text])),
  payment_method text CHECK (payment_method = ANY (ARRAY['USDT'::text,'bank'::text,'wallet'::text])),
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT dealer_earnings_pkey PRIMARY KEY (id),
  CONSTRAINT dealer_earnings_unique UNIQUE (store_id, period_year, period_month)
);

CREATE OR REPLACE FUNCTION public.calculate_monthly_dealer_earnings(p_year integer, p_month integer)
RETURNS void AS $$
BEGIN
  INSERT INTO public.dealer_earnings (store_id, period_year, period_month, gross_commission, referral_bonus, total_payable, payment_status)
  SELECT
    store_id, p_year, p_month,
    COALESCE(SUM(amount) FILTER (WHERE commission_type = 'sale'), 0),
    COALESCE(SUM(amount) FILTER (WHERE commission_type = 'referral_bonus'), 0),
    COALESCE(SUM(amount), 0),
    'pending'
  FROM public.dealer_commissions
  WHERE period_year = p_year AND period_month = p_month
  GROUP BY store_id
  ON CONFLICT (store_id, period_year, period_month) DO UPDATE SET
    gross_commission = EXCLUDED.gross_commission,
    referral_bonus = EXCLUDED.referral_bonus,
    total_payable = EXCLUDED.total_payable;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- pg_cron sabit tarih/saat çalışır, "ayın ilk MESAİ günü" hafta sonunu
-- atlamayı gerektirir — bu yüzden HER GÜN 03:00'te tetiklenip, bugünün
-- gerçekten o ayın ilk iş günü olup olmadığını kendi içinde kontrol eden
-- bir sarmalayıcı kullanılıyor (pg_cron'un kendisi "iş günü" bilmiyor).
CREATE OR REPLACE FUNCTION public.run_monthly_commission_if_due()
RETURNS void AS $$
DECLARE
  today date := now()::date;
  first_of_month date := date_trunc('month', today)::date;
  dow int := EXTRACT(DOW FROM first_of_month); -- 0=Pazar, 6=Cumartesi
  first_business_day date := CASE
    WHEN dow = 0 THEN first_of_month + 1
    WHEN dow = 6 THEN first_of_month + 2
    ELSE first_of_month
  END;
  target date;
BEGIN
  IF today = first_business_day THEN
    target := (first_of_month - interval '1 month')::date;
    PERFORM public.calculate_monthly_dealer_earnings(EXTRACT(YEAR FROM target)::int, EXTRACT(MONTH FROM target)::int);
  END IF;
  PERFORM public.sweep_overdue_shortfalls();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'monthly-commission-and-shortfall-sweep';
    PERFORM cron.schedule('monthly-commission-and-shortfall-sweep', '0 3 * * *', $cron$SELECT public.run_monthly_commission_if_due();$cron$);
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────
-- 8. RLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_variants_supplier_rw ON public.product_variants;
CREATE POLICY product_variants_supplier_rw ON public.product_variants FOR ALL USING (
  EXISTS (SELECT 1 FROM public.catalog_products cp WHERE cp.id = product_variants.catalog_product_id AND cp.supplier_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

ALTER TABLE public.supplier_order_shortfalls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shortfalls_supplier_rw ON public.supplier_order_shortfalls;
CREATE POLICY shortfalls_supplier_rw ON public.supplier_order_shortfalls FOR ALL USING (
  supplier_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

ALTER TABLE public.product_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_suggestions_dealer_rw ON public.product_suggestions;
CREATE POLICY product_suggestions_dealer_rw ON public.product_suggestions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.stores st WHERE st.id = product_suggestions.suggested_by_store_id AND st.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

ALTER TABLE public.dealer_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dealer_commissions_owner_read ON public.dealer_commissions;
CREATE POLICY dealer_commissions_owner_read ON public.dealer_commissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.stores st WHERE st.id = dealer_commissions.store_id AND st.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

ALTER TABLE public.dealer_earnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dealer_earnings_owner_read ON public.dealer_earnings;
CREATE POLICY dealer_earnings_owner_read ON public.dealer_earnings FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.stores st WHERE st.id = dealer_earnings.store_id AND st.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
DROP POLICY IF EXISTS dealer_earnings_admin_write ON public.dealer_earnings;
CREATE POLICY dealer_earnings_admin_write ON public.dealer_earnings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- Tedarikçi kendi yeni ürün TEKLİFİNİ ekleyebilir ama is_approved=true
-- OLARAK KENDİSİ EKLEYEMEZ — admin onayı zorunlu (spec §4).
DROP POLICY IF EXISTS catalog_products_supplier_insert ON public.catalog_products;
CREATE POLICY catalog_products_supplier_insert ON public.catalog_products FOR INSERT WITH CHECK (
  supplier_id = auth.uid() AND is_approved = false
);
DROP POLICY IF EXISTS catalog_products_admin_all ON public.catalog_products;
CREATE POLICY catalog_products_admin_all ON public.catalog_products FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- =====================================================================
-- END OF MIGRATION
-- =====================================================================
