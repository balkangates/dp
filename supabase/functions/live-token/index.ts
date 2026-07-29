// supabase/functions/live-token/index.ts
// ─────────────────────────────────────────────────────────────────────────
// LiveKit oda token'ı üretir. İKİ rol destekler:
//
//   role: 'publisher' (varsayılan, param verilmezse) — SADECE mağaza sahibi
//     (dealer) çağırabilir. dashboard.html → modules/live-sales.js
//     "Canlıya Geç" butonuna basıldığında bunu çağırır, kamerasını
//     "store-<store_id>" odasına yayınlar.
//
//   role: 'viewer' — giriş yapmış herhangi bir müşteri çağırabilir, SADECE
//     mağaza gerçekten canlıdaysa (stores.is_live = true) token üretir.
//     src/lib/supabase.ts → getLiveViewerToken() bunu çağırır
//     (CustomerHome.tsx → StoreLiveViewer.tsx).
//
// Gerekli secret'lar (zaten Supabase → Edge Functions → Secrets altında
// tanımlı): LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL.
// Ek olarak SUPABASE_URL / SUPABASE_ANON_KEY (Supabase Edge Functions'ta
// bunlar otomatik olarak ortam değişkeni olarak sağlanır).
//
// Deploy:
//   supabase functions deploy live-token
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
    const { store_id, role } = await req.json();
    if (!store_id) return json({ error: 'store_id gerekli' }, 400);
    const wantRole: 'publisher' | 'viewer' = role === 'viewer' ? 'viewer' : 'publisher';

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user ?? null;

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
      // Sadece mağaza sahibi yayın açabilir — DB seviyesinde de (RLS/RPC) zorlanıyor,
      // burada ayrıca kontrol ediyoruz çünkü LiveKit token'ı DB'nin bilmediği bir yetki.
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
      // İzleyici — giriş yapmış olmalı (misafir izleme şu an desteklenmiyor,
      // müşteri akışı zaten role='customer' girişini zorunlu kılıyor).
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
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name,
      ttl: '6h',
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();

    return json({ token, ws_url: LIVEKIT_URL, room: roomName });
  } catch (e) {
    console.error('[live-token]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
