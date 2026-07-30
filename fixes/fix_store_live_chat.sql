-- =====================================================================
-- fix_store_live_chat.sql
-- LiveStream.tsx (ana sayfadaki emoji/sohbet widget'ı) önceden TEK ve
-- SABİT bir conversation_id (LIVE_CONV_ID) kullanıyordu — hangi bayi
-- seçilirse seçilsin herkes AYNI genel sohbeti görüyordu. Bu, her
-- mağaza için KENDİ canlı sohbet conversation'ını üretip döndüren bir
-- RPC ekliyor; conversations tablosuna (yoksa) bir store_id kolonu
-- ekliyor.
--
-- ÇALIŞTIRMA: Supabase → SQL Editor'e yapıştır, RUN.
-- =====================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id);

CREATE INDEX IF NOT EXISTS idx_conversations_store_id ON public.conversations(store_id);

-- SECURITY DEFINER: conversations/messages üzerindeki RLS ne olursa
-- olsun (bu repoda tracked değil, muhtemelen elle kurulmuş), bu
-- fonksiyon güvenle select/insert yapabilsin diye definer ile çalışır.
-- Sadece "bul ya da oluştur" yapar, kimseye ekstra bir okuma/yazma
-- yetkisi VERMEZ — sadece conversation id'sini döndürür.
CREATE OR REPLACE FUNCTION public.get_or_create_store_live_conversation(p_store_id uuid)
RETURNS uuid AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  WHERE c.store_id = p_store_id AND c.group_category = 'live_auction'
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (store_id, topic, group_category, title, is_admin_moderated)
    VALUES (p_store_id, 'general', 'live_auction', 'Canlı Yayın Sohbeti', false)
    RETURNING id INTO v_conv_id;
  END IF;

  RETURN v_conv_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_or_create_store_live_conversation(uuid) TO authenticated;
