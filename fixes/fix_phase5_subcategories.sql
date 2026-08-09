-- =====================================================================
-- fix_phase5_subcategories.sql
-- ─────────────────────────────────────────────────────────────────────
-- Sektör → Kategori → Alt Kategori zincirini ürün seçimine tam bağlar.
-- subcategories tablosu zaten vardı (category_id FK'lı) ama hiçbir yerde
-- kullanılmıyordu — ne tedarikçi ürün eklerken, ne bayi kataloğa
-- eklerken, ne de müşteri mağaza sayfasında.
--
-- ÇALIŞTIRMA: Supabase SQL Editor'e yapıştır, RUN.
-- =====================================================================

ALTER TABLE public.catalog_products
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.subcategories(id);

ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.subcategories(id);

CREATE INDEX IF NOT EXISTS idx_catalog_products_subcategory ON public.catalog_products(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_store_products_subcategory ON public.store_products(subcategory_id);
