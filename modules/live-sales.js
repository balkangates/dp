/**
 * modules/live-sales.js
 * ─────────────────────────────────────────────────────────────────────────
 * LIVE SALES MODULE — DEALER rolüne özel (DB değeri: 'dealer', eski adı 'seller').
 *
 * DEALER CORE SYSTEM finalizasyonu ile birlikte SİMÜLASYON tamamen
 * kaldırıldı. Artık her şey gerçek tablolara bağlı:
 *   ✅ "Canlıya Geç"     → public.start_live_session()/end_live_session() RPC
 *                          (public.live_sessions'a gerçek satır, stores.is_live
 *                          gerçekten güncelleniyor — sahte izleyici sayacı yok)
 *   ✅ Canlıya geçiş     → public.can_store_go_live() ile ENGELLENEBİLİR:
 *      ENGELİ            askıya alınmış bayi / aktif kategori yok / videosuz
 *                        ürün → buton devre dışı, sebep gösteriliyor.
 *   ✅ Ürün vitrini      → public.store_products (video zorunluluğu şart:
 *                          has_video=false olan ürün "Canlıda Göster"e
 *                          alınamıyor — DB tetikleyicisi zaten engelliyor)
 *   ✅ Sipariş akışı     → public.store_orders / store_order_items ÜZERİNDEN
 *                          GERÇEK ZAMANLI (Supabase Realtime) — kurgu satır
 *                          eklenmiyor, spec'in "NO simulation. Only real
 *                          orders." kuralına birebir uyuluyor.
 *   ✅ OFFLINE MODE      → canlı değilken, videosu olan ürünler için
 *                          product_videos kaydı otomatik oynatılabiliyor
 *                          (video player + "Bu ürün offline modda son canlı
 *                          videosuyla gösteriliyor" notu).
 *   ✅ Teşekkür mesajı   → yeni bir store_orders satırı geldiğinde ekranda
 *                          gerçek bir "Sipariş alındı, teşekkürler" bildirimi.
 *
 * Store hiç yoksa gerçek bir INSERT ile store oluşturuluyor (önceki gibi).
 */

import { registerModule } from './registry.js';
import { getYoutubeEmbedUrl } from './youtube-utils.js';
import { Room, Track } from 'livekit-client';

let sb = null;
let store = null;
let dashboardStatus = null; // public.get_dealer_dashboard_status() sonucu
let ordersChannel = null;
let selectedProductId = null; // "canlıda anlatılan ürün" — üstte sabit kart
let liveRoom = null; // LiveKit Room bağlantısı (sadece bu bayi yayın yaparken dolu)
let localStream = null; // getUserMedia sonucu — render() her tetiklendiğinde yeniden istenmesin diye saklanıyor

// Öncelik 1: order_status_enum'daki tek yönlü geçiş sırası. is_valid_order_transition()
// DB'de zaten bunu zorluyor — burada sadece "bir sonraki mantıklı adım" ne, onu gösteriyoruz.
const NEXT_STATUS = {
  PAYMENT_PENDING: 'CONFIRMED',
  CONFIRMED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'SHIPPED',
  SHIPPED: 'DELIVERED',
  DELIVERED: 'COMPLETED',
};
const STATUS_LABEL = {
  PAYMENT_PENDING: 'Ödeme Bekliyor',
  CONFIRMED: 'Onaylandı',
  PREPARING: 'Hazırlanıyor',
  READY: 'Hazır',
  SHIPPED: 'Kargoda',
  DELIVERED: 'Teslim Edildi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
};

async function ensureStore(ctx) {
  const { data } = await sb.from('stores').select('*').eq('owner_id', ctx.profile.id).maybeSingle();
  return data;
}

async function createStore(ctx, name) {
  const { data, error } = await sb.from('stores')
    .insert({ owner_id: ctx.profile.id, name, status: 'active' })
    .select().single();
  if (error) throw error;
  return data;
}

async function loadDashboardStatus() {
  const { data, error } = await sb.rpc('get_dealer_dashboard_status', { p_store_id: store.id });
  if (error) { console.error('[live-sales] dashboard status hatası:', error); return null; }
  return data;
}

async function loadProducts() {
  const { data } = await sb.from('store_products')
    .select('*, product_videos(id, video_url, created_at)')
    .eq('store_id', store.id)
    .order('created_at', { ascending: false });
  return data || [];
}

async function loadRecentOrders() {
  const { data } = await sb.from('store_orders')
    .select('*, store_order_items(*)')
    .eq('store_id', store.id)
    .order('created_at', { ascending: false })
    .limit(10);
  return data || [];
}

// ── Canlıya geç / bitir — GERÇEK RPC + GERÇEK video yayını ───────────────
async function toggleLive(ctx, container) {
  try {
    if (store.is_live) {
      disconnectPublisherRoom();
      await sb.rpc('end_live_session', { p_store_id: store.id });
    } else {
      await sb.rpc('start_live_session', { p_store_id: store.id });
      try {
        await connectPublisherRoom();
      } catch (videoErr) {
        console.error('[live-sales] video bağlantısı kurulamadı:', videoErr);
        alert('Canlı oturumu başladı ama video bağlantısı kurulamadı: ' + videoErr.message + '\n(Sipariş/kategori akışı yine de normal çalışır.)');
      }
    }
  } catch (e) {
    // DB, DEALER_CANNOT_GO_LIVE: <reason> şeklinde net bir hata döner.
    alert(explainBlockReason(e?.message || ''));
    return;
  }
  const { data } = await sb.from('stores').select('*').eq('id', store.id).single();
  store = data;
  await refreshAndRender(container, ctx);
}

function explainBlockReason(message) {
  if (message.includes('SUSPENDED')) return 'Bayiliğiniz askıya alındığı için canlıya geçemezsiniz.';
  if (message.includes('NO_ACTIVE_CATEGORY')) return 'Canlıya geçmek için en az 1 AKTİF kategoriniz olmalı (kategori ürünlerinin en az %20\'sini seçmelisiniz).';
  if (message.includes('NO_VIDEO_PRODUCT')) return 'Canlıya geçmek için en az 1 ürününüze YouTube tanıtım video linki eklemiş olmalısınız.';
  return 'Canlıya geçilemedi: ' + message;
}

// ── Öncelik 1: sipariş durumunu ilerlet / iptal et ───────────────────────
// DB trigger'ı (v5) zaten geçersiz geçişleri reddediyor; burada sadece
// "bir sonraki adım"ı sunuyoruz, hata durumunda DB'nin mesajını gösteriyoruz.
async function advanceOrder(orderId, nextStatus, container, ctx) {
  const { error } = await sb.from('store_orders').update({ status: nextStatus }).eq('id', orderId);
  if (error) { alert('Durum güncellenemedi: ' + error.message); return; }
  await render(container, ctx);
}

async function cancelOrder(orderId, container, ctx) {
  if (!confirm('Bu siparişi iptal etmek istediğinize emin misiniz?')) return;
  const { error } = await sb.from('store_orders').update({ status: 'CANCELLED' }).eq('id', orderId);
  if (error) { alert('İptal edilemedi: ' + error.message); return; }
  await render(container, ctx);
}

// ── Öncelik 4: gerçek video yayını (LiveKit) ─────────────────────────────
// DIŞ BAĞIMLILIK: bir LiveKit Cloud projesi + supabase/functions/live-token
// deploy edilmiş olmalı (bkz. o dosyanın başındaki kurulum notu). Bu
// olmadan aşağıdaki fetch 500/hata döner ve video başlamaz — canlıya
// geçiş gating'i (can_store_go_live) yine de normal çalışmaya devam eder.
async function connectPublisherRoom() {
  const { data: sessionData } = await sb.auth.getSession();
  const resp = await fetch(`${sb.supabaseUrl}/functions/v1/live-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData?.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ store_id: store.id }),
  });
  const payload = await resp.json();
  if (!resp.ok) throw new Error(payload.error || 'Yayın token alınamadı');

  liveRoom = new Room();
  await liveRoom.connect(payload.ws_url, payload.token);

  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localStream = stream;
  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];
  if (videoTrack) await liveRoom.localParticipant.publishTrack(videoTrack, { source: Track.Source.Camera });
  if (audioTrack) await liveRoom.localParticipant.publishTrack(audioTrack, { source: Track.Source.Microphone });

  const el = document.getElementById('lsSelfPreview');
  if (el) { el.srcObject = stream; el.play().catch(() => {}); }
}

function disconnectPublisherRoom() {
  if (liveRoom) { liveRoom.disconnect(); liveRoom = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
}

function renderNoStore(container, ctx) {
  container.innerHTML = `
    <div class="card" style="max-width:420px;margin:40px auto;text-align:center">
      <i class="fas fa-store" style="font-size:28px;color:var(--gold);margin-bottom:12px;display:block"></i>
      <div style="font-weight:800;margin-bottom:6px">Henüz bir mağazan yok</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px">Canlı satış yapabilmek için önce mağazanı oluştur.</div>
      <input id="lsStoreName" class="card-sm" style="width:100%;margin-bottom:10px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:9px" placeholder="Mağaza adı (ör. Ahmet'in Bakkalı)" />
      <button class="btn btn-gold" id="lsCreateStoreBtn" style="width:100%;justify-content:center">
        <i class="fas fa-plus"></i> Mağaza Oluştur
      </button>
    </div>`;
  container.querySelector('#lsCreateStoreBtn').onclick = async () => {
    const name = container.querySelector('#lsStoreName').value.trim();
    if (!name) return alert('Mağaza adı gerekli.');
    try {
      store = await createStore(ctx, name);
      await refreshAndRender(container, ctx);
    } catch (e) {
      alert('Mağaza oluşturulamadı: ' + e.message);
    }
  };
}

function renderSuspendedGate(container) {
  container.innerHTML = `
    <div class="card" style="max-width:460px;margin:60px auto;text-align:center">
      <i class="fas fa-ban" style="font-size:28px;color:var(--red);margin-bottom:12px;display:block"></i>
      <div style="font-weight:800;margin-bottom:6px;color:var(--red)">Bayilik Askıya Alındı</div>
      <div style="font-size:12px;color:var(--muted)">Performans kurallarına göre bayiliğiniz askıya alındı. Canlı satış ve girişiniz devre dışı bırakıldı. Detaylar için Performans sayfasına bakın veya destek ile iletişime geçin.</div>
    </div>`;
}

function renderLockedDashboard(container, ctx, status) {
  const cats = status?.categories || [];
  container.innerHTML = `
    <div class="card" style="max-width:640px;margin:40px auto">
      <div style="text-align:center;margin-bottom:16px">
        <i class="fas fa-lock" style="font-size:28px;color:var(--red);margin-bottom:12px;display:block"></i>
        <div style="font-weight:800;margin-bottom:6px">Panel Kilitli</div>
        <div style="font-size:12px;color:var(--muted)">Canlı satışa başlayabilmek için en az 1 AKTİF kategoriniz olmalı. Bir kategori, o kategorideki tüm ürünlerin en az %20'sini seçtiğinizde aktif olur.</div>
      </div>
      ${cats.length === 0
        ? `<div style="text-align:center;color:var(--muted);font-size:12px;padding:16px 0">Henüz hiçbir kategoriden ürün seçmediniz. "Ürün Seçimi" sayfasından başlayın.</div>`
        : `<div class="table-wrap"><table><thead><tr><th>Kategori</th><th>Seçilen</th><th>Gerekli %</th><th>Durum</th></tr></thead><tbody>
            ${cats.map(c => `<tr>
              <td>${c.category_name}</td>
              <td>${c.selected_products}/${c.total_products}</td>
              <td>%${Math.round(c.selection_ratio * 100)} / %20</td>
              <td>${c.is_active ? '<span class="tag tag-green">Aktif</span>' : '<span class="tag tag-red">Yetersiz</span>'}</td>
            </tr>`).join('')}
          </tbody></table></div>`}
      <button class="btn btn-gold" style="width:100%;justify-content:center;margin-top:14px" onclick="sendPromptToDealerCatalog()">
        <i class="fas fa-boxes-stacked"></i> Ürün Seçimi Sayfasına Git
      </button>
    </div>`;
  const btn = container.querySelector('button[onclick="sendPromptToDealerCatalog()"]');
  if (btn) {
    btn.removeAttribute('onclick');
    btn.onclick = () => { if (typeof window.navigateTo === 'function') window.navigateTo('dealer-catalog'); };
  }
}

async function refreshAndRender(container, ctx) {
  dashboardStatus = await loadDashboardStatus();
  await render(container, ctx);
}

async function render(container, ctx) {
  if (!store) { renderNoStore(container, ctx); return; }

  // ── STRICT ENFORCEMENT: askıya alınmış bayi hiçbir şey göremez ─────────
  if (store.dealer_status === 'SUSPENDED' || store.login_disabled) {
    renderSuspendedGate(container);
    return;
  }
  if (store.dashboard_locked) {
    renderLockedDashboard(container, ctx, dashboardStatus);
    return;
  }

  const [products, orders] = await Promise.all([loadProducts(), loadRecentOrders()]);
  const isLive = store.is_live;
  const activeProducts = products.filter(p => p.is_active);
  const missingVideo = products.filter(p => !p.has_video).length;
  const selected = activeProducts.find(p => p.id === selectedProductId) || activeProducts[0] || null;

  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-video" style="color:${isLive ? '#EF4444' : 'var(--gold)'}"></i>Canlı Satış — ${store.name}</div>
      <button id="lsLiveToggle" class="btn ${isLive ? 'btn-red' : 'btn-green'}">
        <i class="fas ${isLive ? 'fa-stop' : 'fa-play'}"></i> ${isLive ? 'Canlıyı Bitir' : 'Canlıya Geç'}
      </button>
    </div>

    ${missingVideo > 0 ? `<div class="card" style="margin-bottom:12px;border:1px solid var(--red);color:var(--red);font-size:12px"><i class="fas fa-triangle-exclamation"></i> ${missingVideo} ürününüzde henüz YouTube tanıtım video linki yok — bu ürünler canlıda gösterilemez ve satılamaz. "Ürün Seçimi" sayfasından ekleyebilirsiniz.</div>` : ''}

    ${isLive ? `
    <div class="card" style="margin-bottom:16px">
      <video id="lsSelfPreview" muted autoplay playsinline style="width:100%;max-height:280px;border-radius:10px;background:#000;object-fit:cover"></video>
      <div style="font-size:10px;color:var(--muted);margin-top:6px"><i class="fas fa-broadcast-tower"></i> Bu, izleyicilerin gördüğü canlı yayının kendi önizlemenizdir.</div>
    </div>
    <div class="grid-3" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-icon" style="background:rgba(239,68,68,.15);color:var(--red)"><i class="fas fa-circle" style="font-size:10px"></i></div><div><div class="stat-label">DURUM</div><div class="stat-value" style="font-size:13px;color:var(--red)">CANLI</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(16,185,129,.15);color:var(--green)"><i class="fas fa-shopping-cart"></i></div><div><div class="stat-label">GÜNCEL SİPARİŞ</div><div class="stat-value">${orders.length}</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(212,175,55,.15);color:var(--gold)"><i class="fas fa-box"></i></div><div><div class="stat-label">VİTRİNDEKİ ÜRÜN</div><div class="stat-value">${activeProducts.length}</div></div></div>
    </div>` : `<div class="card" style="margin-bottom:16px;color:var(--muted);font-size:12px">
      <i class="fas fa-circle-info"></i> Canlı yayın kapalı — OFFLINE MODE aktif. Müşteriler ürünlerinizin son canlı sunum videosunu görür, sipariş akışı gerçek şekilde devam eder.
    </div>`}

    <div class="grid-2">
      <div class="card">
        <div class="section-title" style="font-size:13px;margin-bottom:10px"><i class="fas fa-boxes-stacked" style="color:var(--gold)"></i> Ürün Vitrini (${activeProducts.length})</div>
        ${activeProducts.length === 0
          ? `<div style="color:var(--muted);font-size:12px;padding:16px 0">Vitrinde aktif (videolu) ürün yok.</div>`
          : activeProducts.map(p => `
            <div class="card-sm ls-product-row" data-id="${p.id}" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:pointer;${selected?.id === p.id ? 'border-color:var(--gold)' : ''}">
              <span style="font-size:12px;font-weight:600">${p.name} ${!p.has_video ? '<i class="fas fa-triangle-exclamation" style="color:var(--red)" title="YouTube linki yok"></i>' : ''}</span>
              <span style="font-size:12px;color:var(--gold);font-family:'Courier New',monospace">₺${Number(p.price).toLocaleString('tr-TR')}</span>
            </div>`).join('')}
      </div>

      <div class="card">
        <div class="section-title" style="font-size:13px;margin-bottom:10px"><i class="fas fa-tag" style="color:var(--blue)"></i> Şu An Anlatılan Ürün</div>
        ${selected ? `
          <div style="position:relative">
            <div class="card-sm" style="margin-bottom:10px">
              <div style="font-weight:700;font-size:13px;margin-bottom:4px">${selected.name}</div>
              <div style="font-size:12px;color:var(--gold);font-family:'Courier New',monospace;margin-bottom:8px">₺${Number(selected.price).toLocaleString('tr-TR')}</div>
              ${!isLive && selected.product_videos?.length ? renderOfflineVideo(selected.product_videos[selected.product_videos.length - 1]) : ''}
            </div>
          </div>
        ` : `<div style="color:var(--muted);font-size:12px">Ürün seçmek için soldaki listeden birine tıklayın.</div>`}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title" style="font-size:13px;margin-bottom:10px"><i class="fas fa-shopping-bag" style="color:var(--green)"></i> Gerçek Zamanlı Sipariş Akışı</div>
      <div id="lsOrderFeed" style="min-height:60px">
        ${orders.length === 0
          ? `<div style="color:var(--muted);font-size:12px">Henüz sipariş yok. Gerçek bir sipariş geldiğinde burada anında görünecek.</div>`
          : orders.map(o => renderOrderRow(o)).join('')}
      </div>
    </div>
  `;

  container.querySelector('#lsLiveToggle').onclick = () => toggleLive(ctx, container);
  container.querySelectorAll('.ls-product-row').forEach(row => {
    row.onclick = () => { selectedProductId = row.dataset.id; render(container, ctx); };
  });

  // Realtime tetiklemeli yeniden render, video elementini sıfırlıyor —
  // kamerayı yeniden istemeden mevcut stream'i geri bağla.
  if (isLive && localStream) {
    const previewEl = container.querySelector('#lsSelfPreview');
    if (previewEl) { previewEl.srcObject = localStream; previewEl.play().catch(() => {}); }
  }

  container.querySelectorAll('.order-advance-btn').forEach(btn => {
    btn.onclick = () => advanceOrder(btn.dataset.order, btn.dataset.next, container, ctx);
  });
  container.querySelectorAll('.order-cancel-btn').forEach(btn => {
    btn.onclick = () => cancelOrder(btn.dataset.order, container, ctx);
  });

  subscribeToOrders(container, ctx);
}

// Tanıtım videosu artık bir YouTube linki (bkz. modules/dealer-catalog.js) —
// bu yüzden offline modda <video src="..."> yerine YouTube iframe embed
// kullanıyoruz. Eskiden Storage'a yüklenmiş (source: 'upload'/'live_recording')
// bir kayıt varsa (youtube linki değilse) geriye dönük uyumluluk için yine
// doğrudan <video> etiketiyle oynatılır.
function renderOfflineVideo(video) {
  const embedUrl = getYoutubeEmbedUrl(video.video_url);
  const player = embedUrl
    ? `<div style="position:relative;padding-top:56.25%;border-radius:8px;overflow:hidden">
         <iframe src="${embedUrl}" title="Ürün tanıtım videosu" frameborder="0"
           allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
           allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
       </div>`
    : `<video src="${video.video_url}" controls style="width:100%;border-radius:8px;max-height:200px" poster=""></video>`;
  return `
    ${player}
    <div style="font-size:10px;color:var(--muted);margin-top:6px"><i class="fas fa-circle-play"></i> Offline mod — bayinin YouTube tanıtım videosu gösteriliyor.</div>
  `;
}

function renderOrderRow(order) {
  const itemsSummary = (order.store_order_items || []).map(i => `${i.quantity}× ${i.product_name}`).join(', ');
  const next = NEXT_STATUS[order.status];
  const canCancel = !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(order.status);
  return `<div class="card-sm" style="margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;font-weight:700">${itemsSummary || 'Sipariş'}</span>
      <span class="tag tag-green" style="font-size:10px">₺${Number(order.total_amount).toLocaleString('tr-TR')}</span>
    </div>
    <div style="font-size:10px;color:var(--muted);margin-top:4px">${new Date(order.created_at).toLocaleTimeString('tr-TR')} — Sipariş alındı, teşekkürler! 🎉</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <span class="tag" style="font-size:10px">${STATUS_LABEL[order.status] || order.status}</span>
      <div style="display:flex;gap:6px">
        ${canCancel ? `<button class="btn btn-sm btn-ghost order-cancel-btn" data-order="${order.id}"><i class="fas fa-xmark"></i></button>` : ''}
        ${next ? `<button class="btn btn-sm btn-gold order-advance-btn" data-order="${order.id}" data-next="${next}">${STATUS_LABEL[next]} <i class="fas fa-arrow-right"></i></button>` : ''}
      </div>
    </div>
  </div>`;
}

// ── Gerçek zamanlı sipariş bildirimleri (Realtime) — kurgu YOK ──────────
function subscribeToOrders(container, ctx) {
  if (ordersChannel) { sb.removeChannel(ordersChannel); ordersChannel = null; }
  ordersChannel = sb
    .channel(`store-orders-${store.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_orders', filter: `store_id=eq.${store.id}` },
      () => { render(container, ctx); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'store_orders', filter: `store_id=eq.${store.id}` },
      () => { render(container, ctx); })
    .subscribe();
}

registerModule({
  id: 'live-sales',
  label: 'Canlı Satış',
  icon: 'fa-video',
  roles: ['dealer'],
  async mount(container, ctx) {
    sb = ctx.sb;
    store = await ensureStore(ctx);
    if (store) dashboardStatus = await loadDashboardStatus();
    await render(container, ctx);
  },
  unmount() {
    if (ordersChannel) { sb.removeChannel(ordersChannel); ordersChannel = null; }
    disconnectPublisherRoom();
  },
});
