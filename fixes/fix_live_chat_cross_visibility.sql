-- =====================================================================
-- fix_live_chat_cross_visibility.sql
-- ─────────────────────────────────────────────────────────────────────
-- SORU: "Müşteri mesaj yazınca hem bayi hem kendi panosuna anlık
-- düşmeli — trigger/filtre engelleme var mı?"
--
-- Realtime FİLTRE tarafı zaten daha önce düzeltilmişti (bkz.
-- LiveStream.tsx içindeki yorum — Supabase Realtime'ın compound
-- "a=eq.X&b=eq.Y" filtresini desteklememesi sorunu, sadece
-- conversation_id'ye göre filtrelenip message_type JS'te kontrol
-- edilerek çözüldü).
--
-- EN OLASI KALAN SEBEP: messages tablosundaki RLS SELECT politikası.
-- messages tablosu muhtemelen 1:1 özel mesajlaşma için tasarlanmış:
--   sender_id = auth.uid() OR receiver_id = auth.uid()
-- CANLI SOHBET mesajlarında receiver_id HER ZAMAN NULL (yayın — tek bir
-- alıcı yok). Yani bu politika ile: mesajı gönderen kişi kendi mesajını
-- (sender_id eşleşir) görür, ama KARŞI TARAF (ne sender ne receiver)
-- O SATIRI HİÇ OKUYAMAZ — ne sayfa yenilemede ne realtime'da (Supabase
-- Realtime de postgres_changes için SELECT RLS'ini uygular). Bu, tam
-- olarak tarif edilen belirtiyle örtüşüyor.
--
-- 1) ÖNCE TEŞHİS: Bunu SQL Editor'de çalıştırıp mevcut SELECT
--    politikalarını görün:
--
--    SELECT polname, qual FROM pg_policies
--    WHERE schemaname='public' AND tablename='messages' AND cmd='SELECT';
--
-- 2) SONRA bu dosyanın geri kalanını çalıştırın — mevcut politikaya
--    DOKUNMUYOR (DROP etmiyor), sadece message_type='live' olan
--    satırlar için EK, İZİN VERİCİ bir SELECT politikası ekliyor.
--    Postgres'te aynı komut (SELECT) için birden fazla "permissive"
--    politika varsa OR'lanır — yani özel mesajlaşmanın gizliliği
--    bozulmadan, sadece canlı sohbet (herkese açık yayın sohbeti)
--    herkese okunur hale geliyor.
-- =====================================================================

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY; -- zaten açıksa etkisiz

DROP POLICY IF EXISTS messages_live_chat_public_read ON public.messages;
CREATE POLICY messages_live_chat_public_read ON public.messages FOR SELECT
USING (
  message_type = 'live'
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.group_category = 'live_auction'
  )
);

-- INSERT tarafında da aynı riskin var olup olmadığını kapatalım —
-- giriş yapmış HERHANGİ bir kullanıcı kendi sender_id'siyle bir live
-- mesajı ekleyebilsin (mevcut politika muhtemelen zaten bunu
-- karşılıyordu çünkü gönderme çalışıyordu, ama garantiye almak için
-- ek/idempotent bir politika daha ekliyoruz).
DROP POLICY IF EXISTS messages_live_chat_insert ON public.messages;
CREATE POLICY messages_live_chat_insert ON public.messages FOR INSERT
WITH CHECK (
  message_type = 'live' AND sender_id = auth.uid()
);

-- Ekstra sigorta: messages tablosu supabase_realtime publication'ında
-- değilse hiçbir realtime event ASLA gitmez (RLS'ten bağımsız, daha
-- temel bir sebep). Tabloda değilse ekler, zaten varsa hata vermez.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
