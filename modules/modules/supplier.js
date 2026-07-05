/**
 * modules/supplier.js
 * ─────────────────────────────────────────────────────────────────────────
 * SUPPLIER PANEL MODULE — TEDARİKÇİ (supplier) rolüne özel.
 *
 * ÖNEMLİ NOT: DB'de profiles.role CHECK constraint'i 'supplier' değerini zaten
 * kabul ediyor ama dashboard.html'in MENUS objesinde 'supplier' için HİÇ giriş
 * yoktu — yani bu rolle giren bir kullanıcı bugüne kadar boş bir menüyle
 * karşılaşıyordu. Bu modül o boşluğu dolduruyor.
 *
 * Tamamen GERÇEK veriye bağlı (mock/simülasyon yok — spec'in "SUPPLIER PANEL
 * MODULE" maddesi mock istemiyor):
 *   - Gelen Talepler   → public.reverse_auctions (status='active')
 *   - Teklif Ver       → public.supplier_bids (INSERT)
 *   - Sevkiyat Durumu  → public.shipments (kendi supplier_id'sine ait)
 *
 * Üç alt-sekme tek modül içinde yönetiliyor (ayrı route açmaya gerek yok).
 */

import { registerModule } from './registry.js';

let sb = null;
let myId = null;
let activeTab = 'auctions';

async function fetchOpenAuctions() {
  const { data } = await sb.from('reverse_auctions')
    .select('*')
    .eq('status', 'active')
    .order('end_time', { ascending: true });
  return data || [];
}

async function fetchMyBids() {
  const { data } = await sb.from('supplier_bids')
    .select('*, reverse_auctions(product_name, ceiling_price, status)')
    .eq('supplier_id', myId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function fetchMyShipments() {
  const { data } = await sb.from('shipments')
    .select('*, reverse_auctions(product_name)')
    .eq('supplier_id', myId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function submitBid(auctionId, price, notes, container, ctx) {
  const { error } = await sb.from('supplier_bids').insert({
    auction_id: auctionId,
    supplier_id: myId,
    unit_price: price,
    notes: notes || null,
  });
  if (error) { alert('Teklif gönderilemedi: ' + error.message); return; }
  activeTab = 'bids';
  await render(container, ctx);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function statusTag(status) {
  const map = {
    active: 'tag-blue', submitted: 'tag-blue', winning: 'tag-green', lost: 'tag-red',
    withdrawn: 'tag-gray', preparing: 'tag-amber', in_transit: 'tag-blue', delivered: 'tag-green',
  };
  return `<span class="tag ${map[status] || 'tag-gray'}">${status}</span>`;
}

async function renderAuctionsTab(ctx) {
  const auctions = await fetchOpenAuctions();
  if (auctions.length === 0) {
    return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Şu anda açık talep yok.</div>`;
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Ürün</th><th>Toplam Miktar</th><th>Tavan Fiyat</th><th>Bitiş</th><th>İşlem</th></tr></thead>
    <tbody>
      ${auctions.map(a => `
        <tr>
          <td>${a.product_name}</td>
          <td>${a.total_quantity} ${a.quantity_unit}</td>
          <td>₺${Number(a.ceiling_price).toLocaleString('tr-TR')}</td>
          <td class="font-mono" style="font-size:11px">${fmtDate(a.end_time)}</td>
          <td><button class="btn btn-gold btn-sm" onclick="window.__supplierBidPrompt('${a.id}', ${a.ceiling_price})"><i class="fas fa-hand-holding-dollar"></i> Teklif Ver</button></td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function renderBidsTab() {
  const bids = await fetchMyBids();
  if (bids.length === 0) {
    return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Henüz teklif vermediniz.</div>`;
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Ürün</th><th>Teklifim</th><th>Tavan Fiyat</th><th>Durum</th><th>Tarih</th></tr></thead>
    <tbody>
      ${bids.map(b => `
        <tr>
          <td>${b.reverse_auctions?.product_name || '—'}</td>
          <td>₺${Number(b.unit_price).toLocaleString('tr-TR')}</td>
          <td>₺${b.reverse_auctions?.ceiling_price ? Number(b.reverse_auctions.ceiling_price).toLocaleString('tr-TR') : '—'}</td>
          <td>${statusTag(b.status)}</td>
          <td class="font-mono" style="font-size:11px">${fmtDate(b.created_at)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function renderShipmentsTab() {
  const shipments = await fetchMyShipments();
  if (shipments.length === 0) {
    return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Aktif sevkiyatınız yok.</div>`;
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Ürün</th><th>Durum</th><th>Not</th><th>Güncelleme</th></tr></thead>
    <tbody>
      ${shipments.map(s => `
        <tr>
          <td>${s.reverse_auctions?.product_name || '—'}</td>
          <td>${statusTag(s.status)}</td>
          <td style="font-size:11px;color:var(--muted)">${s.tracking_note || '—'}</td>
          <td class="font-mono" style="font-size:11px">${fmtDate(s.updated_at)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function render(container, ctx) {
  const tabs = [
    { id: 'auctions', label: 'Gelen Talepler', icon: 'fa-bullhorn' },
    { id: 'bids', label: 'Tekliflerim', icon: 'fa-hand-holding-dollar' },
    { id: 'shipments', label: 'Sevkiyat Durumu', icon: 'fa-truck-fast' },
  ];

  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-industry" style="color:var(--gold)"></i>Tedarikçi Paneli</div>
    </div>
    <div class="pill-tabs" id="supTabs">
      ${tabs.map(t => `<div class="pill-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}"><i class="fas ${t.icon}"></i> ${t.label}</div>`).join('')}
    </div>
    <div class="card" id="supTabBody" style="margin-top:12px">
      <div style="text-align:center;padding:30px"><i class="fas fa-spinner fa-spin"></i></div>
    </div>
  `;

  container.querySelectorAll('#supTabs .pill-tab').forEach(el => {
    el.onclick = async () => {
      activeTab = el.dataset.tab;
      await render(container, ctx);
    };
  });

  const body = container.querySelector('#supTabBody');
  if (activeTab === 'auctions') body.innerHTML = await renderAuctionsTab(ctx);
  else if (activeTab === 'bids') body.innerHTML = await renderBidsTab(ctx);
  else body.innerHTML = await renderShipmentsTab(ctx);

  // Global prompt köprüsü — inline onclick'ten (tablo satırları dinamik olduğu için
  // event delegation yerine basit bir global fonksiyon kullanıldı, mevcut
  // dashboard.html'deki diğer sayfalarla aynı desen — bkz. openProductModal() vb.)
  window.__supplierBidPrompt = (auctionId, ceiling) => {
    const price = prompt(`Birim fiyat teklifiniz (tavan: ₺${ceiling}):`);
    if (price === null) return;
    const num = Number(price);
    if (!num || num <= 0) return alert('Geçerli bir fiyat girin.');
    if (num > ceiling) return alert('Teklif tavan fiyatın üzerinde olamaz.');
    const notes = prompt('Not (opsiyonel):') || '';
    submitBid(auctionId, num, notes, container, ctx);
  };
}

registerModule({
  id: 'supplier',
  label: 'Tedarikçi Paneli',
  icon: 'fa-industry',
  roles: ['supplier'],
  async mount(container, ctx) {
    sb = ctx.sb;
    myId = ctx.profile.id;
    activeTab = 'auctions';
    await render(container, ctx);
  },
  unmount() {
    delete window.__supplierBidPrompt;
  },
});
