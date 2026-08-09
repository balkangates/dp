// supabase/functions/live-token/index.ts
// ─────────────────────────────────────────────────────────────────────────
// LiveKit oda token'ı üretir. ÜÇ rol destekler:
//
//   role: 'publisher' (varsayılan) — SADECE mağaza sahibi (dealer).
//     Genel canlı yayın odası "store-<store_id>"ya kamerasını yayınlar.
//
//   role: 'viewer' — giriş yapmış herhangi bir müşteri, mağaza
//     is_live=true iken genel yayını SADECE izler (canPublish=false).
//
//   role: 'call' — FAZ 3: BİREBİR görüntülü görüşme. call_request_id
//     zorunlu; sadece o call_requests satırının customer_id'si YA DA
//     ilgili mağazanın owner_id'si token alabilir, VE call_requests.status
//     'accepted' olmalı. Oda adı "call-<call_request_id>" — genel yayın
//     odasından tamamen ayrı, sadece bu iki kişi girebilir, İKİSİ DE
//     canPublish=true (karşılıklı görüntü/ses).
//
// Gerekli secret'lar (Supabase → Edge Functions → Secrets):
// LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, SUPABASE_URL,
// SUPABASE_ANON_KEY.
//
// Deploy: supabase functions deploy live-token
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

const LIVEKIT_URL = Deno.env.get('LIVEKIT_URL')!;
const LIVEKIT_API_KEY = Deno.env.get('LIVEKIT_API_KEY')!;
const LIVEKIT_API_SECRET = Deno.env.get('LIVEKIT_API_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { store_id, role, call_request_id } = await req.json();
    const wantRole: 'publisher' | 'viewer' | 'call' =
      role === 'viewer' ? 'viewer' : role === 'call' ? 'call' : 'publisher';

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user ?? null;

    // ── FAZ 3: birebir görüntülü görüşme ────────────────────────────────
    if (wantRole === 'call') {
      if (!call_request_id) return json({ error: 'call_request_id gerekli' }, 400);
      if (!user) return json({ error: 'Giriş yapmalısınız' }, 401);

      const { data: call, error: callErr } = await supabase
        .from('call_requests')
        .select('id, store_id, customer_id, status, stores(owner_id, name)')
        .eq('id', call_request_id)
        .maybeSingle();
      if (callErr || !call) return json({ error: 'Görüşme isteği bulunamadı' }, 404);
      if (call.status !== 'accepted') return json({ error: 'Görüşme henüz kabul edilmedi' }, 409);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ownerId = (call.stores as any)?.owner_id;
      const isCustomer = user.id === call.customer_id;
      const isDealer = user.id === ownerId;
      if (!isCustomer && !isDealer) {
        return json({ error: 'Bu görüşmeye katılma yetkiniz yok' }, 403);
      }

      const identity = isDealer ? `dealer-${user.id}` : `customer-${user.id}`;
      const roomName = `call-${call.id}`;
      const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity,
        name: isDealer ? 'Satış Temsilcisi' : (user.email ?? 'Müşteri'),
        ttl: '2h',
      });
      // İki taraf da hem yayınlar hem izler — gerçek birebir görüntülü görüşme.
      at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
      const token = await at.toJwt();
      return json({ token, ws_url: LIVEKIT_URL, room: roomName });
    }

    // ── Genel canlı yayın (publisher/viewer) — mevcut davranış ──────────
    if (!store_id) return json({ error: 'store_id gerekli' }, 400);

    const { data: store, error: storeErr } = await supabase
      .from('stores')
      .select('id, owner_id, name, is_live, dealer_status')
      .eq('id', store_id)
      .maybeSingle();
    if (storeErr || !store) return json({ error: 'Mağaza bulunamadı' }, 404);

    let identity: string;
    let name: string;
    let canPublish: boolean;

    if (wantRole === 'publisher') {
      if (!user || user.id !== store.owner_id) {
        return json({ error: 'Sadece mağaza sahibi yayın açabilir' }, 403);
      }
      if (store.dealer_status === 'SUSPENDED') {
        return json({ error: 'Bayilik askıya alınmış' }, 403);
      }
      identity = `dealer-${user.id}`;
      name = 'Bayi';
      canPublish = true;
    } else {
      if (!user) {
        return json({ error: 'İzlemek için giriş yapmalısınız' }, 401);
      }
      if (!store.is_live) {
        return json({ error: 'Bu mağaza şu an canlı yayında değil' }, 409);
      }
      identity = `viewer-${user.id}`;
      name = user.email ?? 'İzleyici';
      canPublish = false;
    }

    const roomName = `store-${store.id}`;
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: '6h' });
    at.addGrant({ room: roomName, roomJoin: true, canPublish, canSubscribe: true, canPublishData: true });
    const token = await at.toJwt();

    return json({ token, ws_url: LIVEKIT_URL, room: roomName });
  } catch (e) {
    console.error('[live-token]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
