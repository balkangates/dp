-- =====================================================================
-- fix_phase5_admin_approvals.sql
-- ─────────────────────────────────────────────────────────────────────
-- FAZ 5: Admin onay akışları.
--
-- BULGU: reverse_auctions tablosunda winning_bid_id / winning_supplier_id
-- / winning_unit_price kolonları, shipments / shipment_allocations
-- tabloları ZATEN VARDI — açıkça bu akış için tasarlanmış ama hiçbir
-- yerde bunu dolduran kod yoktu. İhale süresi dolduğunda hiçbir şey
-- olmuyordu, kazanan seçilmiyordu, tedarikçiye sevkiyat açılmıyordu.
--
-- Bu migration ekliyor:
--   1) close_expired_auctions() — süresi dolmuş 'active' ihaleleri
--      'closed' yapar (admin panelinden ya da bir cron job'dan çağrılır).
--   2) admin_approve_auction_winner(auction_id) — en düşük teklifi
--      kazanan ilan eder, shipments + shipment_allocations oluşturur
--      (talebi giren her mağazaya kendi miktarınca pay ayırır), ilgili
--      demands'ı 'fulfilled' yapar.
--   3) admin_cancel_auction(auction_id, reason) — ihaleyi iptal eder,
--      demands'ı tekrar 'open' yapar (yeniden gruplanabilsin diye).
--
-- ÇALIŞTIRMA: Supabase SQL Editor'e yapıştır, RUN.
-- =====================================================================

CREATE OR REPLACE FUNCTION public._is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.close_expired_auctions()
RETURNS integer AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public._is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.reverse_auctions
  SET status = 'closed'
  WHERE status = 'active' AND end_time < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_approve_auction_winner(p_auction_id uuid)
RETURNS uuid AS $$
DECLARE
  v_auction public.reverse_auctions;
  v_winning_bid public.supplier_bids;
  v_shipment_id uuid;
  v_demand RECORD;
BEGIN
  IF NOT public._is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auction FROM public.reverse_auctions WHERE id = p_auction_id;
  IF v_auction IS NULL THEN
    RAISE EXCEPTION 'AUCTION_NOT_FOUND';
  END IF;
  IF v_auction.status NOT IN ('active', 'closed') THEN
    RAISE EXCEPTION 'AUCTION_ALREADY_RESOLVED: %', v_auction.status;
  END IF;

  SELECT * INTO v_winning_bid
  FROM public.supplier_bids
  WHERE auction_id = p_auction_id AND status = 'submitted'
  ORDER BY unit_price ASC, created_at ASC
  LIMIT 1;

  IF v_winning_bid IS NULL THEN
    RAISE EXCEPTION 'NO_BIDS';
  END IF;

  -- İhaleyi kazananla işaretle
  UPDATE public.reverse_auctions
  SET status = 'awarded',
      winning_bid_id = v_winning_bid.id,
      winning_supplier_id = v_winning_bid.supplier_id,
      winning_unit_price = v_winning_bid.unit_price
  WHERE id = p_auction_id;

  UPDATE public.supplier_bids SET status = 'winning' WHERE id = v_winning_bid.id;
  UPDATE public.supplier_bids SET status = 'lost' WHERE auction_id = p_auction_id AND id <> v_winning_bid.id AND status = 'submitted';

  -- Sevkiyatı aç
  INSERT INTO public.shipments (auction_id, supplier_id, status)
  VALUES (p_auction_id, v_winning_bid.supplier_id, 'preparing')
  RETURNING id INTO v_shipment_id;

  -- Bu ihaleye katkı veren her mağazanın talebi kadar pay ayır
  FOR v_demand IN
    SELECT d.id, d.store_id, d.quantity
    FROM public.demands d
    WHERE d.aggregate_id = v_auction.aggregate_id AND d.status IN ('open', 'aggregated')
  LOOP
    INSERT INTO public.shipment_allocations (shipment_id, store_id, demand_id, quantity, unit_price, status)
    VALUES (v_shipment_id, v_demand.store_id, v_demand.id, v_demand.quantity, v_winning_bid.unit_price, 'pending');

    UPDATE public.demands SET status = 'fulfilled' WHERE id = v_demand.id;
  END LOOP;

  UPDATE public.demand_aggregates SET status = 'closed' WHERE id = v_auction.aggregate_id;

  RETURN v_shipment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_cancel_auction(p_auction_id uuid, p_reason text DEFAULT NULL)
RETURNS void AS $$
DECLARE v_auction public.reverse_auctions;
BEGIN
  IF NOT public._is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_auction FROM public.reverse_auctions WHERE id = p_auction_id;
  IF v_auction IS NULL THEN RAISE EXCEPTION 'AUCTION_NOT_FOUND'; END IF;
  IF v_auction.status = 'awarded' THEN RAISE EXCEPTION 'ALREADY_AWARDED'; END IF;

  UPDATE public.reverse_auctions SET status = 'cancelled' WHERE id = p_auction_id;
  UPDATE public.demands SET status = 'open', aggregate_id = NULL WHERE aggregate_id = v_auction.aggregate_id;
  UPDATE public.demand_aggregates SET status = 'open' WHERE id = v_auction.aggregate_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.close_expired_auctions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_auction_winner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_auction(uuid, text) TO authenticated;

-- Admin'e özet muhasebe raporu için tek sorguluk view.
CREATE OR REPLACE VIEW public.v_admin_finance_summary AS
SELECT
  st.id AS store_id,
  st.name AS store_name,
  count(DISTINCT so.id) AS order_count,
  coalesce(sum(so.total_amount), 0) AS gross_sales,
  coalesce(sum(soc.platform_fee), 0) AS platform_commission,
  coalesce(sum(soc.seller_payout), 0) AS dealer_payout,
  coalesce(sum(CASE WHEN et.status = 'HELD' THEN et.net_amount ELSE 0 END), 0) AS escrow_held,
  coalesce(sum(CASE WHEN et.status = 'RELEASED' THEN et.net_amount ELSE 0 END), 0) AS escrow_released
FROM public.stores st
LEFT JOIN public.store_orders so ON so.store_id = st.id
LEFT JOIN public.store_order_commissions soc ON soc.order_id = so.id
LEFT JOIN public.escrow_transactions et ON et.order_id = so.id
GROUP BY st.id, st.name;

GRANT SELECT ON public.v_admin_finance_summary TO authenticated;
