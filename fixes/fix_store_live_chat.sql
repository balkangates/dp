-- =====================================================================
-- fix_store_live_chat.sql
-- ─────────────────────────────────────────────────────────────────────
-- BULGU: components/LiveStream.tsx, "fixes/fix_store_live_chat.sql" ile
-- eklendiği varsayılan public.get_or_create_store_live_conversation(uuid)
-- RPC'sini çağırıyor. Bu dosya repoda hiç yoktu — fonksiyon ya DB'de hiç
-- yok, ya da elle/başka bir yerde oluşturulmuş ama conversations tablosuna
-- gerçek bir satır INSERT etmeden bir id döndürüyor. Her iki durumda da
-- messages.insert() sırasında "conversation_id boş bir conversations
-- satırını gösteriyor" hatası (FK violation) veya "Sohbet hazırlanıyor"
-- takılması ortaya çıkıyor.
--
-- Bu migration RPC'yi doğru şekilde (CREATE OR REPLACE ile, DB'de bozuk
-- bir versiyon varsa üzerine yazarak) tanımlıyor: mağaza için mevcut bir
-- sohbet varsa onu döndürür, yoksa conversations'a gerçekten bir satır
-- INSERT edip mağaza sahibini (bayi) katılımcı olarak ekler.
--
-- Ayrıca storeId verilmediğinde (eski genel hero bölümü) kullanılan sabit
-- LEGACY_GLOBAL_CONV_ID'nin de conversations tablosunda var olduğundan
-- emin oluyor — aynı FK hatası orada da yaşanabilirdi.
--
-- ÇALIŞTIRMA: Supabase SQL Editor'e yapıştır, RUN.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_or_create_store_live_conversation(p_store_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_owner_id uuid;
BEGIN
  -- Bu mağaza için zaten bir sohbet var mı? (LiveStream dışında hiçbir
  -- yer conversations.store_id'yi set etmiyor, bu yüzden tek başına
  -- store_id filtresi güvenli.)
  SELECT id INTO v_conversation_id
  FROM public.conversations
  WHERE store_id = p_store_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.stores WHERE id = p_store_id;

  INSERT INTO public.conversations (store_id, topic, title, created_by, is_admin_moderated)
  VALUES (p_store_id, 'general', 'Canlı Yayın Sohbeti', v_owner_id, false)
  RETURNING id INTO v_conversation_id;

  -- Mağaza sahibini (bayi) katılımcı olarak ekle ki kendi sohbetini görsün.
  IF v_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = v_conversation_id AND user_id = v_owner_id
  ) THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id, role)
    VALUES (v_conversation_id, v_owner_id, 'dealer');
  END IF;

  RETURN v_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_store_live_conversation(uuid) TO authenticated;

-- storeId verilmediğinde kullanılan sabit ID — yoksa oluştur, varsa dokunma.
INSERT INTO public.conversations (id, topic, title, is_admin_moderated)
VALUES ('e3fc6ac0-5e8f-4bb6-9aa1-ca1d84ddaf73', 'general', 'Genel Canlı Yayın Sohbeti', false)
ON CONFLICT (id) DO NOTHING;
