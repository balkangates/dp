/**
 * modules/live-sales.js
 * ─────────────────────────────────────────────────────────────────────────
 * LIVE SALES MODULE — DEALER (seller) rolüne özel.
 *
 * Neyi GERÇEK yapıyoruz, neyi SİMÜLE ediyoruz (bilinçli bir sınır, "backend'i
 * abartma" kuralına uymak için):
 *   ✅ GERÇEK   — "Canlıya Geç" butonu → public.stores.is_live = true/false
 *                 (schema'da zaten var: stores.is_live, stores.live_viewer_count)
 *   ✅ GERÇEK   — Ürün listesi → public.store_products (dealer'ın gerçek kataloğu)
 *   🎭 SİMÜLE   — "Gerçek zamanlı sipariş" akışı: her birkaç saniyede bir sahte
 *                 sipariş satırı ekleniyor (spec'te açıkça "order SIMULATION"
 *                 isteniyor — store_orders tablosuna gerçek INSERT YAPILMIYOR,
 *                 checkout/ödeme akışı bu modülün kapsamında değil)
 *   🎭 MOCK     — Yorum/chat paneli: sabit bir kullanıcı havuzundan rastgele
 *                 mesaj üretimi + kullanıcının kendi mesajını yerel olarak
 *                 listeye ekleyebilmesi (gerçek bir sohbet altyapısı/tablosu yok)
 *
 * Store hiç yoksa (dealer henüz mağaza açmamışsa) gerçek bir INSERT ile
 * store oluşturuluyor — bu da simüle değil, gerçek bir yazma işlemi.
 */

import { registerModule } from './registry.js';

let sb = null;
let store = null;
let orderInterval = null;
let chatInterval = null;
let orderSeq = 1;

const FAKE_CUSTOMERS = ['Elif K.', 'Mehmet Y.', 'Zeynep A.', 'Burak T.', 'Ayşe D.', 'Can S.', 'Deniz P.'];
const FAKE_COMMENTS = [
  'Fiyat nedir?', 'Kargo ne zaman gelir?', 'Stok var mı?', 'Harika görünüyor 🔥',
  'Kaç adet kaldı?', 'İndirim olur mu?', 'Bunu daha önce almıştım, çok iyi!', 'Canlıya bayıldım 😍',
];

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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

async function toggleLive(ctx, container) {
  const goingLive = !store.is_live;
  const { data, error } = await sb.from('stores')
    .update({ is_live: goingLive, live_viewer_count: goingLive ? Math.floor(Math.random() * 40) + 10 : 0 })
    .eq('id', store.id)
    .select().single();
  if (error) { alert('Canlı durumu güncellenemedi: ' + error.message); return; }
  store = data;
  render(container, ctx);
  if (goingLive) startSimulation(container); else stopSimulation();
}

function startSimulation(container) {
  stopSimulation();
  orderInterval = setInterval(() => {
    const feed = container.querySelector('#lsOrderFeed');
    if (!feed) return;
    const row = document.createElement('div');
    row.className = 'card-sm';
    row.style.marginBottom = '8px';
    row.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;font-weight:700">${randomFrom(FAKE_CUSTOMERS)}</span>
      <span class="tag tag-green" style="font-size:10px">Sipariş #${orderSeq++}</span>
    </div>`;
    feed.prepend(row);
    while (feed.children.length > 8) feed.removeChild(feed.lastChild);
    const counter = container.querySelector('#lsOrderCount');
    if (counter) counter.textContent = String(orderSeq - 1);
  }, 4000);

  chatInterval = setInterval(() => {
    const chat = container.querySelector('#lsChatFeed');
    if (!chat) return;
    appendChatLine(chat, randomFrom(FAKE_CUSTOMERS), randomFrom(FAKE_COMMENTS));
  }, 3000);
}

function stopSimulation() {
  if (orderInterval) { clearInterval(orderInterval); orderInterval = null; }
  if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
}

function appendChatLine(chatEl, name, text) {
  const line = document.createElement('div');
  line.style.cssText = 'font-size:12px;margin-bottom:6px;line-height:1.4';
  line.innerHTML = `<span style="color:var(--gold);font-weight:700">${name}:</span> <span style="color:var(--muted2)">${text}</span>`;
  chatEl.appendChild(line);
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function loadProducts(ctx) {
  const { data } = await sb.from('store_products').select('*').eq('store_id', store.id).order('created_at', { ascending: false });
  return data || [];
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
      render(container, ctx);
    } catch (e) {
      alert('Mağaza oluşturulamadı: ' + e.message);
    }
  };
}

async function render(container, ctx) {
  if (!store) {
    renderNoStore(container, ctx);
    return;
  }

  const products = await loadProducts(ctx);
  const isLive = store.is_live;

  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-video" style="color:${isLive ? '#EF4444' : 'var(--gold)'}"></i>Canlı Satış — ${store.name}</div>
      <button id="lsLiveToggle" class="btn ${isLive ? 'btn-red' : 'btn-green'}">
        <i class="fas ${isLive ? 'fa-stop' : 'fa-play'}"></i> ${isLive ? 'Canlıyı Bitir' : 'Canlıya Geç'}
      </button>
    </div>

    ${isLive ? `
    <div class="grid-4" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-icon" style="background:rgba(239,68,68,.15);color:var(--red)"><i class="fas fa-circle" style="font-size:10px"></i></div><div><div class="stat-label">DURUM</div><div class="stat-value" style="font-size:13px;color:var(--red)">CANLI</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(56,189,248,.15);color:var(--blue)"><i class="fas fa-eye"></i></div><div><div class="stat-label">İZLEYİCİ</div><div class="stat-value">${store.live_viewer_count}</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(16,185,129,.15);color:var(--green)"><i class="fas fa-shopping-cart"></i></div><div><div class="stat-label">SİPARİŞ (SİMÜLASYON)</div><div class="stat-value" id="lsOrderCount">0</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(212,175,55,.15);color:var(--gold)"><i class="fas fa-box"></i></div><div><div class="stat-label">ÜRÜN</div><div class="stat-value">${products.length}</div></div></div>
    </div>` : `<div class="card" style="margin-bottom:16px;color:var(--muted);font-size:12px">Canlı yayın kapalı. Başlatmak için sağ üstteki butonu kullan — izleyici sayısı, sipariş ve yorum akışı demo amaçlı simüle edilir.</div>`}

    <div class="grid-2">
      <div class="card">
        <div class="section-title" style="font-size:13px;margin-bottom:10px"><i class="fas fa-boxes-stacked" style="color:var(--gold)"></i> Ürün Vitrini (${products.length})</div>
        ${products.length === 0
          ? `<div style="color:var(--muted);font-size:12px;padding:16px 0">Mağazana henüz ürün eklenmemiş. (store_products tablosu — ayrı bir "Ürün Yönetimi" modülünden eklenecek.)</div>`
          : products.map(p => `
            <div class="card-sm" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-size:12px;font-weight:600">${p.name}</span>
              <span style="font-size:12px;color:var(--gold);font-family:'Courier New',monospace">₺${Number(p.price).toLocaleString('tr-TR')}</span>
            </div>`).join('')}
      </div>

      <div class="card" style="display:flex;flex-direction:column">
        <div class="section-title" style="font-size:13px;margin-bottom:10px"><i class="fas fa-comments" style="color:var(--blue)"></i> Canlı Yorumlar ${isLive ? '' : '<span style="font-size:10px;color:var(--muted)">(canlı değilken pasif)</span>'}</div>
        <div id="lsChatFeed" style="flex:1;min-height:160px;max-height:220px;overflow-y:auto;margin-bottom:10px"></div>
        <div style="display:flex;gap:6px">
          <input id="lsChatInput" ${isLive ? '' : 'disabled'} placeholder="Yorum yaz..." style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px;font-size:12px" />
          <button id="lsChatSend" ${isLive ? '' : 'disabled'} class="btn btn-ghost btn-sm"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title" style="font-size:13px;margin-bottom:10px"><i class="fas fa-shopping-bag" style="color:var(--green)"></i> Sipariş Akışı (simülasyon)</div>
      <div id="lsOrderFeed" style="min-height:60px">${isLive ? '' : '<div style="color:var(--muted);font-size:12px">Canlı başlayınca sipariş akışı burada görünecek.</div>'}</div>
    </div>
  `;

  container.querySelector('#lsLiveToggle').onclick = () => toggleLive(ctx, container);

  const chatSend = container.querySelector('#lsChatSend');
  if (chatSend) {
    chatSend.onclick = () => {
      const input = container.querySelector('#lsChatInput');
      const text = input.value.trim();
      if (!text) return;
      appendChatLine(container.querySelector('#lsChatFeed'), ctx.profile.full_name || 'Sen', text);
      input.value = '';
    };
  }

  if (isLive) startSimulation(container); else stopSimulation();
}

registerModule({
  id: 'live-sales',
  label: 'Canlı Satış',
  icon: 'fa-video',
  roles: ['seller'], // DEALER / BAYİ — DB'deki karşılığı 'seller'
  async mount(container, ctx) {
    sb = ctx.sb;
    store = await ensureStore(ctx);
    await render(container, ctx);
  },
  unmount() {
    stopSimulation();
  },
});
