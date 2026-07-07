/**
 * modules/customer-stores.js
 * ─────────────────────────────────────────────────────────────────────────
 * CUSTOMER — Mağazalar. Bu revizyondan önce store_orders'a GERÇEK yazan
 * hiçbir yer yoktu (live-sales.js'teki sipariş akışı bilerek SİMÜLASYONdu).
 * Bu modül, "yeni sipariş akışı (dealer vitrini) store_orders'a taşınsın"
 * kararının ilk GERÇEK yazma noktasıdır.
 *
 * Kapsam bilinçli olarak SADE tutuldu (sepet/çoklu ürün YOK): her "Satın Al"
 * tıklaması kendi store_orders + tek store_order_items satırını oluşturuyor.
 * Sepet sistemi ayrı bir modül olarak eklenebilir, bu revizyonun kapsamı
 * "gerçek bir yazma yolu olsun" idi.
 */

import { registerModule } from './registry.js';

let sb = null;
let myId = null;
let activeStoreId = null;

async function fetchActiveStores() {
  const { data } = await sb.from('stores')
    .select('id, name, is_live, live_viewer_count')
    .eq('status', 'active')
    .order('is_live', { ascending: false });
  return data || [];
}

async function fetchStoreProducts(storeId) {
  const { data } = await sb.from('store_products')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .gt('stock_qty', 0)
    .order('name');
  return data || [];
}

async function placeOrder(store, product, quantity, container, ctx) {
  const totalAmount = Number(product.price) * quantity;

  const { data: order, error: orderErr } = await sb.from('store_orders').insert({
    store_id: store.id,
    customer_id: myId,
    status: 'PAYMENT_PENDING',
    payment_method: 'bank',
    payment_confirmed: false,
    total_amount: totalAmount,
  }).select().single();

  if (orderErr) { alert('Sipariş oluşturulamadı: ' + orderErr.message); return; }

  const { error: itemErr } = await sb.from('store_order_items').insert({
    order_id: order.id,
    store_product_id: product.id,
    product_name: product.name,
    unit_price: product.price,
    quantity,
    total_price: totalAmount,
  });
  // DB tetikleyicisi (v9 migration) burada store_products.stock_qty'yi
  // otomatik düşürür — istemci tarafında stok azaltma YAPILMIYOR.

  if (itemErr) { alert('Sipariş kalemi oluşturulamadı: ' + itemErr.message); return; }

  alert(`Siparişiniz alındı! Toplam: ₺${totalAmount.toLocaleString('tr-TR')}\nÖdeme durumu: Bekliyor (banka havalesi).`);
  await renderProducts(store, container, ctx);
}

async function renderProducts(store, container, ctx) {
  const products = await fetchStoreProducts(store.id);
  const body = container.querySelector('#csBody');
  body.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="csBack" style="margin-bottom:12px"><i class="fas fa-arrow-left"></i> Mağazalara Dön</button>
    <div class="section-title" style="margin-bottom:12px">${store.name} ${store.is_live ? '<span class="tag tag-red" style="font-size:10px"><i class="fas fa-circle"></i> CANLI</span>' : ''}</div>
    ${products.length === 0
      ? '<div style="color:var(--muted);font-size:12px;padding:20px 0">Bu mağazada şu an satılık ürün yok.</div>'
      : `<div class="grid-3">
          ${products.map(p => `
            <div class="card">
              <div style="font-weight:700;margin-bottom:6px">${p.name}</div>
              <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${p.description || ''}</div>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-family:'Courier New',monospace;font-weight:900;color:var(--gold)">₺${Number(p.price).toLocaleString('tr-TR')}</span>
                <span style="font-size:11px;color:var(--muted)">Stok: ${p.stock_qty}</span>
              </div>
              <button class="btn btn-gold btn-sm buy-btn" data-product="${p.id}" style="width:100%;justify-content:center;margin-top:10px"><i class="fas fa-cart-plus"></i> Satın Al</button>
            </div>`).join('')}
        </div>`}
  `;

  body.querySelector('#csBack').onclick = () => render(container, ctx);
  body.querySelectorAll('.buy-btn').forEach(btn => {
    btn.onclick = () => {
      const product = products.find(p => p.id === btn.dataset.product);
      const qty = Number(prompt(`Adet girin (stok: ${product.stock_qty}):`, '1'));
      if (!qty || qty <= 0) return;
      if (qty > product.stock_qty) return alert('Stoktan fazla adet giremezsiniz.');
      placeOrder(store, product, qty, container, ctx);
    };
  });
}

async function render(container, ctx) {
  const stores = await fetchActiveStores();
  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-store" style="color:var(--gold)"></i>Mağazalar</div>
    </div>
    <div id="csBody">
      ${stores.length === 0
        ? '<div style="color:var(--muted);font-size:12px;padding:20px 0">Aktif mağaza yok.</div>'
        : `<div class="grid-3">
            ${stores.map(s => `
              <div class="card store-card" data-store="${s.id}" style="cursor:pointer">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div style="font-weight:800">${s.name}</div>
                  ${s.is_live ? `<span class="tag tag-red" style="font-size:10px"><i class="fas fa-circle"></i> CANLI (${s.live_viewer_count})</span>` : ''}
                </div>
              </div>`).join('')}
          </div>`}
    </div>
  `;
  container.querySelectorAll('.store-card').forEach(el => {
    el.onclick = () => {
      const store = stores.find(s => s.id === el.dataset.store);
      activeStoreId = store.id;
      renderProducts(store, container, ctx);
    };
  });
}

registerModule({
  id: 'stores',
  label: 'Mağazalar',
  icon: 'fa-store',
  roles: ['customer'],
  async mount(container, ctx) {
    sb = ctx.sb;
    myId = ctx.profile.id;
    activeStoreId = null;
    await render(container, ctx);
  },
  unmount() {},
});
