-- =====================================================================
-- fix_ambiguous_id_go_live.sql
-- "Canlıya geçilemedi: column reference "id" is ambiguous" hatasını
-- kesin çözer.
--
-- Neden: can_store_go_live() içinde "s public.stores;" adlı bir satır
-- (row) değişkeni kullanılıyor ve sorguda "id" bare (tabloya
-- nitelenmemiş) şekilde referans ediliyor. PL/pgSQL, "s" değişkeninin
-- alanlarını (s.id dahil) sorgu içindeki isim çözümlemesine dahil
-- edebiliyor — bu durumda "id" hem public.stores.id hem de örtük
-- "s.id" olarak yorumlanabiliyor ve Postgres bunu belirsiz buluyor.
-- (Supabase'de fonksiyon canlıda muhtemelen bu repodaki dosyadan
-- az farklı/elle düzenlenmiş bir haldeydi — bu dosya, hangi hâlde
-- olursa olsun üzerine güvenli, tamamen nitelenmiş bir sürüm yazar.)
--
-- ÇALIŞTIRMA: Supabase → SQL Editor'e yapıştır, RUN.
-- Geriye dönük UYUMLU: aynı imza (aynı parametre/dönüş tipleri),
-- dashboard.html / modules/live-sales.js tarafında HİÇBİR değişiklik
-- gerekmiyor.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.can_store_go_live(p_store_id uuid)
RETURNS TABLE(allowed boolean, reason text) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores st WHERE st.id = p_store_id) THEN
    RETURN QUERY SELECT false, 'STORE_NOT_FOUND';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stores st
    WHERE st.id = p_store_id AND (st.dealer_status = 'SUSPENDED' OR st.login_disabled)
  ) THEN
    RETURN QUERY SELECT false, 'SUSPENDED';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stores st
    WHERE st.id = p_store_id AND st.dashboard_locked
  ) THEN
    RETURN QUERY SELECT false, 'NO_ACTIVE_CATEGORY';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.store_products sp
    WHERE sp.store_id = p_store_id AND sp.is_active AND sp.has_video
  ) THEN
    RETURN QUERY SELECT false, 'NO_VIDEO_PRODUCT';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'OK';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.start_live_session(p_store_id uuid)
RETURNS uuid AS $$
DECLARE
  v_allowed boolean;
  v_reason text;
  v_session_id uuid;
BEGIN
  SELECT g.allowed, g.reason INTO v_allowed, v_reason
  FROM public.can_store_go_live(p_store_id) AS g;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'DEALER_CANNOT_GO_LIVE: %', v_reason USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.live_sessions (store_id, started_at)
  VALUES (p_store_id, now())
  RETURNING live_sessions.id INTO v_session_id;

  UPDATE public.stores st SET is_live = true, updated_at = now() WHERE st.id = p_store_id;

  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.end_live_session(p_store_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.live_sessions ls
  SET ended_at = now(),
      duration_minutes = GREATEST(0, EXTRACT(EPOCH FROM (now() - ls.started_at)) / 60)::integer
  WHERE ls.store_id = p_store_id AND ls.ended_at IS NULL;

  UPDATE public.stores st SET is_live = false, live_viewer_count = 0, updated_at = now() WHERE st.id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.can_store_go_live(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_live_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_live_session(uuid) TO authenticated;
