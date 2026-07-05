-- =====================================================================
-- supabase_migration_v6_role_rename.sql
-- ROL SİSTEMİ REVİZYONU: buyer → customer, seller → dealer
-- =====================================================================
-- KRİTİK: Bu migration CANLI VERİYİ değiştirir (profiles.role kolonundaki
-- mevcut satırlar). Çalıştırmadan önce mutlaka bir DB YEDEĞİ alın
-- (Supabase Dashboard → Database → Backups, ya da pg_dump).
--
-- Neden 3 AYRI ADIM (tek ALTER + tek UPDATE değil):
--   CHECK constraint'i direkt "buyer/seller'ı çıkar, dealer/customer'ı
--   ekle" şeklinde değiştirirseniz, UPDATE satırı çalışırken bir an için
--   ne eski ne yeni değer birlikte geçerli olmaz ve constraint UPDATE'i
--   reddedebilir (sıralamaya göre). Bu yüzden:
--     ADIM 1: constraint'i GENİŞLET (eski+yeni union) → hiçbir satır asla
--             ihlal etmez
--     ADIM 2: veriyi taşı (UPDATE)
--     ADIM 3: constraint'i DARALT (sadece yeni değerler) → eski isimler
--             bir daha asla yazılamaz
--
-- NOT (kullanıcı kararı): 'finance' ve 'franchise' rolleri hedef listede
-- açıkça yoktu ama şu an aktif kullanıcısı olmadığı için SİLİNMEDİ, sadece
-- korundu — bu istemsiz bir veri kaybını önlemek için bilinçli bir karar.
-- İsterseniz ayrı bir migration ile kaldırılabilir.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- ADIM 1 — CONSTRAINT'İ GENİŞLET (eski + yeni roller birlikte geçerli)
-- ─────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_constraint_name text;
BEGIN
  -- profiles.role üzerindeki CHECK constraint'in gerçek adını dinamik
  -- bul (elle "profiles_role_check" diye tahmin etmek yerine) — dosyalarda
  -- bu constraint'in orijinal CREATE TABLE'ı hiç görülmediği için isim
  -- kesin bilinmiyor.
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'profiles' AND att.attname = 'role' AND con.contype = 'c'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_constraint_name);
  ELSE
    RAISE NOTICE 'profiles.role üzerinde mevcut bir CHECK constraint bulunamadı — devam ediliyor.';
  END IF;

  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role = ANY (ARRAY[
      'buyer'::text, 'seller'::text,               -- ESKİ (geçiş için geçici, ADIM 3'te kaldırılacak)
      'customer'::text, 'dealer'::text,             -- YENİ
      'admin'::text, 'supplier'::text, 'logistics'::text, 'influencer'::text,
      'franchise'::text, 'finance'::text            -- korunanlar
    ]));
END $do$;

-- ─────────────────────────────────────────────────────────────────────
-- ADIM 2 — VERİYİ TAŞI
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.profiles SET role = 'customer' WHERE role = 'buyer';
UPDATE public.profiles SET role = 'dealer'   WHERE role = 'seller';

-- Eğer profiles dışında role bilgisini kopyalayan/önbelleğe alan başka bir
-- tablo/kolon varsa (bu şemada görülmedi) onu da burada güncelleyin.

-- ─────────────────────────────────────────────────────────────────────
-- ADIM 3 — CONSTRAINT'İ DARALT (eski isimler artık YASAK)
-- ─────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_leftover int;
BEGIN
  SELECT count(*) INTO v_leftover FROM public.profiles WHERE role IN ('buyer', 'seller');
  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'ADIM 2 tam tamamlanmadı: hâlâ % satırda eski rol (buyer/seller) var. ADIM 3 iptal edildi — önce bunları inceleyin.', v_leftover;
  END IF;

  ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role = ANY (ARRAY[
      'customer'::text, 'dealer'::text, 'admin'::text, 'supplier'::text,
      'logistics'::text, 'influencer'::text, 'franchise'::text, 'finance'::text
    ]));
END $do$;

-- ─────────────────────────────────────────────────────────────────────
-- DOĞRULAMA — bu migration'ı çalıştırdıktan sonra manuel kontrol edin:
-- ─────────────────────────────────────────────────────────────────────
-- SELECT role, count(*) FROM public.profiles GROUP BY role ORDER BY role;
-- Beklenen: 'buyer' ve 'seller' hiç görünmemeli.

-- =====================================================================
-- END OF MIGRATION
-- =====================================================================
