-- =====================================================================
-- fix_store_social.sql
-- ─────────────────────────────────────────────────────────────────────
-- Mağaza (store) bazlı sosyal özellikler — TikTok tarzı: Beğeni, Takip,
-- Yorum. (Paylaş, DB'de bir şey tutmuyor — istemci tarafında Web Share
-- API / link kopyalama olarak çözülüyor, bkz. lib/store-social.ts.)
--
-- Mevcut şemada product_likes / product_comments / product_followers var
-- ama STORE bazlı hiçbiri yoktu — bu üçü aynı desenle (id, ..._id,
-- user_id, created_at) yeni ekleniyor, farkla: burada unique(store_id,
-- user_id) constraint'i VAR (like/follow'un tek satır olması gerekiyor —
-- product_likes'ta bu yoktu, muhtemelen "N kere beğen" sayımı için, ama
-- store bazlı like/follow'da TikTok gibi tek durum (beğendim/beğenmedim)
-- istiyoruz, "toggle" mantığıyla).
--
-- Ayrıca fix_store_live_chat.sql'deki get_or_create_store_live_conversation
-- fonksiyonu GÜNCELLENİYOR: artık RPC'yi çağıran HERKESİ (bayi veya
-- müşteri, kim çağırırsa) conversation_participants'a ekliyor. Eğer
-- messages üzerindeki RLS SELECT politikası "sadece participant okuyabilir"
-- şeklindeyse, önceki versiyonda sadece mağaza sahibi (bayi) participant
-- olarak ekleniyordu — müşteriler mesajları hiç OKUYAMAMIŞ olabilirdi.
-- Bu güncelleme, hem bayinin hem müşterinin kendi mesajlaştıkları sohbete
-- participant olarak eklenmesini garanti altına alıyor.
--
-- ÇALIŞTIRMA: Supabase SQL Editor'e yapıştır, RUN.
-- (fix_store_live_chat.sql'i DAHA ÖNCE çalıştırdıysan sorun değil — bu
-- dosya CREATE OR REPLACE ile üzerine yazıyor, güvenle tekrar çalıştırılır.)
-- =====================================================================

-- ── 1. store_likes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_store_likes_store ON public.store_likes(store_id);

ALTER TABLE public.store_likes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_likes_read ON public.store_likes;
CREATE POLICY store_likes_read ON public.store_likes FOR SELECT USING (true);
DROP POLICY IF EXISTS store_likes_write ON public.store_likes;
CREATE POLICY store_likes_write ON public.store_likes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2. store_follows ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_store_follows_store ON public.store_follows(store_id);
CREATE INDEX IF NOT EXISTS idx_store_follows_user ON public.store_follows(user_id);

ALTER TABLE public.store_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_follows_read ON public.store_follows;
CREATE POLICY store_follows_read ON public.store_follows FOR SELECT USING (true);
DROP POLICY IF EXISTS store_follows_write ON public.store_follows;
CREATE POLICY store_follows_write ON public.store_follows FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 3. store_comments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_comments_store ON public.store_comments(store_id, created_at DESC);

ALTER TABLE public.store_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_comments_read ON public.store_comments;
CREATE POLICY store_comments_read ON public.store_comments FOR SELECT USING (true);
DROP POLICY IF EXISTS store_comments_insert ON public.store_comments;
CREATE POLICY store_comments_insert ON public.store_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS store_comments_delete ON public.store_comments;
CREATE POLICY store_comments_delete ON public.store_comments FOR DELETE USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.store_comments;

-- ── 4. Toggle RPC'leri ───────────────────────────────────────────────
-- İstemci "beğenildi mi / beğenilmedi mi" durumunu tek round-trip'te,
-- race condition'a düşmeden değiştirebilsin diye (check-sonra-insert değil,
-- tek atomik işlem).
CREATE OR REPLACE FUNCTION public.toggle_store_like(p_store_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing FROM public.store_likes
  WHERE store_id = p_store_id AND user_id = auth.uid();

  IF v_existing IS NOT NULL THEN
    DELETE FROM public.store_likes WHERE id = v_existing;
    RETURN false;  -- artık beğenilmiyor
  ELSE
    INSERT INTO public.store_likes (store_id, user_id) VALUES (p_store_id, auth.uid());
    RETURN true;   -- beğenildi
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.toggle_store_like(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_store_follow(p_store_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing FROM public.store_follows
  WHERE store_id = p_store_id AND user_id = auth.uid();

  IF v_existing IS NOT NULL THEN
    DELETE FROM public.store_follows WHERE id = v_existing;
    RETURN false;  -- takipten çıkıldı
  ELSE
    INSERT INTO public.store_follows (store_id, user_id) VALUES (p_store_id, auth.uid());
    RETURN true;   -- takip edildi
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.toggle_store_follow(uuid) TO authenticated;

-- ── 5. get_or_create_store_live_conversation — v2 ───────────────────
-- fix_store_live_chat.sql'deki fonksiyonun üzerine yazıyor: artık HER
-- ÇAĞIRAN (bayi ya da müşteri) otomatik olarak conversation_participants'a
-- ekleniyor. Böylece "müşteri mesajları okuyamıyor/yazamıyor" ihtimali,
-- messages üzerindeki RLS participant kontrolüne bağlıysa da ortadan
-- kalkmış oluyor.
CREATE OR REPLACE FUNCTION public.get_or_create_store_live_conversation(p_store_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_owner_id uuid;
  v_caller uuid := auth.uid();
BEGIN
  SELECT id INTO v_conversation_id
  FROM public.conversations
  WHERE store_id = p_store_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    SELECT owner_id INTO v_owner_id FROM public.stores WHERE id = p_store_id;

    INSERT INTO public.conversations (store_id, topic, title, created_by, is_admin_moderated)
    VALUES (p_store_id, 'general', 'Canlı Yayın Sohbeti', v_owner_id, false)
    RETURNING id INTO v_conversation_id;

    IF v_owner_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = v_conversation_id AND user_id = v_owner_id
    ) THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id, role)
      VALUES (v_conversation_id, v_owner_id, 'dealer');
    END IF;
  END IF;

  -- Çağıran kişi (bayi ya da bu sohbete gelen herhangi bir müşteri)
  -- henüz participant değilse ekle.
  IF v_caller IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = v_conversation_id AND user_id = v_caller
  ) THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id, role)
    VALUES (v_conversation_id, v_caller, 'viewer');
  END IF;

  RETURN v_conversation_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_or_create_store_live_conversation(uuid) TO authenticated;
