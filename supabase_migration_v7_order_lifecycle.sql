-- ═══════════════════════════════════════════════════════════════════
-- v7: Sipariş yaşam döngüsü — Ödeme Onayı, e-İrsaliye/e-Fatura entegrasyonu,
--     otomatik teslim onayı (7 gün) / alıcı onayı ile escrow serbest bırakma
-- ═══════════════════════════════════════════════════════════════════

-- 1) invoices.invoice_type constraint'i e-irsaliye tiplerini de kabul etsin
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY[
    'sales'::text, 'purchase'::text, 'commission'::text, 'expense'::text, 'credit'::text,
    'e_sales_waybill'::text, 'e_transport_waybill'::text
  ]));

-- 2) Süresi dolan (auto_confirm_at geçmiş) siparişleri otomatik "Teslim Edildi"
--    yapıp escrow'u serbest bırakan fonksiyon (escrow_wallets + orders birlikte günceller)
CREATE OR REPLACE FUNCTION public.release_expired_escrows()
RETURNS TABLE(released_order_id uuid) AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.orders
    WHERE order_status = 'SHIPPED'
      AND buyer_delivery_confirmed = false
      AND auto_confirm_at IS NOT NULL
      AND auto_confirm_at <= now()
  LOOP
    UPDATE public.escrow_wallets
       SET status = 'released', released_at = now(), updated_at = now()
     WHERE order_id = r.id AND status = 'pending';

    UPDATE public.orders
       SET order_status = 'DELIVERED',
           shipping_status = 'DELIVERED',
           escrow_status = 'released',
           buyer_delivery_confirmed = true,
           buyer_delivery_confirmed_at = now(),
           updated_at = now()
     WHERE id = r.id;

    released_order_id := r.id;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════
-- 3) OTOMATİK ÇALIŞTIRMA — pg_cron (opsiyonel ama önerilir)
-- ═══════════════════════════════════════════════════════════════════
-- "schema "cron" does not exist" hatası, pg_cron extension'ının projenizde
-- henüz AÇIK olmadığı anlamına gelir. SQL Editor'den CREATE EXTENSION
-- çoğu zaman yeterli olmuyor çünkü pg_cron sunucu seviyesinde kurulum
-- gerektiriyor. Şu adımları izleyin:
--
--   1) Supabase Dashboard → Database → Extensions
--   2) Arama kutusuna "pg_cron" yazın, toggle'ı açın (Enable)
--   3) Açıldıktan sonra AŞAĞIDAKİ bloğu SQL Editor'de AYRI olarak çalıştırın
--      (yukarıdaki release_expired_escrows() fonksiyonu zaten oluşmuş olacak)
--
-- pg_cron extension'ı bir sebeple açılamıyorsa (bazı ücretsiz/self-host
-- kurulumlarda kısıtlı olabiliyor), en alttaki "ALTERNATİF" bölümüne bakın.

-- create extension if not exists pg_cron;  -- genelde dashboard'dan açmak gerekir, burada da denenebilir

-- Aşağıdaki bloğu pg_cron açıldıktan SONRA çalıştırın:
/*
SELECT cron.schedule(
  'release-expired-escrows-hourly',
  '0 * * * *',
  $$SELECT public.release_expired_escrows()$$
);
*/

-- ═══════════════════════════════════════════════════════════════════
-- ALTERNATİF — pg_cron kullanamıyorsanız
-- ═══════════════════════════════════════════════════════════════════
-- pg_cron'suz da aynı otomasyonu kurabilirsiniz:
--   a) Supabase Dashboard → Edge Functions → yeni bir fonksiyon oluşturup
--      içinde `select public.release_expired_escrows();` çalıştıran bir
--      RPC çağrısı yapın, sonra Dashboard → Database → Cron Jobs (yeni
--      Supabase sürümlerinde "Integrations → Cron" adıyla da geçer) üzerinden
--      bu fonksiyonu saatlik tetikleyin — bu, pg_cron'a ihtiyaç duymadan
--      Supabase'in kendi scheduled trigger altyapısını kullanır.
--   b) Ya da dashboard.html içine, sayfa her açıldığında (örn. admin/finance
--      login olduğunda) `select public.release_expired_escrows();` çağıran
--      bir RPC isteği ekleyebilirsiniz — bu "best effort" bir yedektir,
--      birileri paneli açmadığı sürece tetiklenmez, tek başına yeterli değildir.
