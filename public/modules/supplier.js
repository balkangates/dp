/**
 * modules/supplier.js
 * ─────────────────────────────────────────────────────────────────────────
 * SUPPLIER PANEL MODULE — TEDARİKÇİ (supplier) rolüne özel.
 *
 * Toptan tedarik akışı (reverse_auctions/supplier_bids/shipments) +
 * MODÜL 3.6 (Stok, Faturalama, Komisyon) eklentileri — supabase_migration_
 * v4_supplier_commission.sql'e bağlı:
 *   - Stok Yönetimi   → product_variants (renk/beden/model + adet).
 *     Stok=0 olan varyantların toplamı sıfırlanınca catalog_products.is_active
 *     ve TÜM bayilerin store_products.is_active'i DB TRIGGER'I ile otomatik
 *     kapanır — burada sadece stok adedi güncellenir, kapatma/açma mantığı
 *     istemci tarafında YOK (tek doğruluk kaynağı DB).
 *   - Yeni Ürün Öner  → catalog_products'a is_approved=false ile INSERT
 *     (RLS bunu zorluyor — tedarikçi kendi ürününü asla onaylı ekleyemez).
 *   - Eksik Siparişler → supplier_order_shortfalls, sadece OKUMA + "Tamamladım"
 *     (mark_shortfall_resolved RPC'si).
 */

import { registerModule } from './registry.js';

let sb = null;
let myId = null;
let activeTab = 'auctions';
let myCatalogProducts = [];
let categories = [];
let sectors = [];
let subcategories = [];

// Önceden BÜTÜN platformdaki bütün aktif reverse_auctions'lar HER
// tedarikçiye gösteriliyordu — kendi ürün kategorisiyle hiç alakası
// olmayan talepler dahil. reverse_auctions.catalog_product_id, hangi
// onaylı ürüne ait olduğunu tutuyor (v10/v11 migration) — artık sadece
// KENDİ kataloğundaki ürünlerle eşleşen (+ henüz bir ürüne
// bağlanmamış/eski, catalog_product_id NULL olan) talepler gösteriliyor.
async function fetchOpenAuctions() {
  const myProductIds = myCatalogProducts.map(p => p.id);
  let query = sb.from('reverse_auctions')
    .select('*')
    .eq('status', 'active');

  query = myProductIds.length > 0
    ? query.or(`catalog_product_id.in.(${myProductIds.join(',')}),catalog_product_id.is.null`)
    : query.is('catalog_product_id', null);

  const { data, error } = await query.order('end_time', { ascending: true });
  if (error) { console.error('[supplier] ihaleler yüklenemedi:', error); return []; }
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

async function fetchMyCatalogProducts() {
  const { data } = await sb.from('catalog_products')
    .select('*, product_variants(*)')
    .eq('supplier_id', myId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function fetchSectors() {
  const { data } = await sb.from('sectors').select('id,label').eq('is_active', true).order('sort_order');
  return data || [];
}

async function fetchCategories() {
  const { data } = await sb.from('categories').select('id,name,sector_id').eq('is_active', true).order('name');
  return data || [];
}

async function fetchSubcategories() {
  const { data } = await sb.from('subcategories').select('id,name,category_id').eq('is_active', true).order('name');
  return data || [];
}

async function fetchMyShortfalls() {
  const { data } = await sb.from('supplier_order_shortfalls')
    .select('*, catalog_products(name)')
    .eq('supplier_id', myId)
    .order('deadline_at', { ascending: true });
  return data || [];
}

async function addVariant(catalogProductId, color, size, model, stockQty, container, ctx) {
  const { error } = await sb.from('product_variants').insert({
    catalog_product_id: catalogProductId,
    color: color || null, size: size || null, model: model || null,
    stock_qty: stockQty,
  });
  if (error) { alert('Varyant eklenemedi: ' + error.message); return; }
  myCatalogProducts = await fetchMyCatalogProducts();
  await render(container, ctx);
}

async function updateVariantStock(variantId, newQty, container, ctx) {
  const { error } = await sb.from('product_variants').update({ stock_qty: newQty }).eq('id', variantId);
  if (error) { alert('Stok güncellenemedi: ' + error.message); return; }
  myCatalogProducts = await fetchMyCatalogProducts();
  await render(container, ctx);
}

async function proposeNewProduct(payload, container, ctx) {
  const { error } = await sb.from('catalog_products').insert({
    ...payload, supplier_id: myId, is_approved: false, is_active: false,
  });
  if (error) { alert('Ürün önerisi gönderilemedi: ' + error.message); return; }
  alert('Ürün öneriniz admin onayına gönderildi.');
  myCatalogProducts = await fetchMyCatalogProducts();
  activeTab = 'stock';
  await render(container, ctx);
}

async function resolveShortfall(id, container, ctx) {
  if (!confirm('Bu eksik siparişi tamamladığınızı onaylıyor musunuz?')) return;
  const { error } = await sb.rpc('mark_shortfall_resolved', { p_id: id });
  if (error) { alert('İşlem başarısız: ' + error.message); return; }
  await render(container, ctx);
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

// ═══ MODÜL 3.6 — STOK YÖNETİMİ ═══════════════════════════════════════
function renderStockTab(container, ctx) {
  if (myCatalogProducts.length === 0) {
    return `<div style="color:var(--muted);font-size:12px;padding:20px 0">
      Henüz onaylı bir ürününüz yok. "Yeni Ürün Öner" sekmesinden admin onayına ürün gönderebilirsiniz.
    </div>`;
  }
  return myCatalogProducts.map(cp => {
    const totalStock = (cp.product_variants || []).reduce((s, v) => s + Number(v.stock_qty || 0), 0);
    return `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:800">${cp.name} ${!cp.is_approved ? '<span class="tag tag-amber" style="font-size:10px">Onay Bekliyor</span>' : ''}</div>
        <span class="tag ${totalStock > 0 ? 'tag-green' : 'tag-red'}" style="font-size:10px">
          <i class="fas ${totalStock > 0 ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> Toplam Stok: ${totalStock}
        </span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Renk</th><th>Beden</th><th>Model</th><th>Stok</th><th></th></tr></thead>
        <tbody>
          ${(cp.product_variants || []).length === 0
            ? `<tr><td colspan="5" style="color:var(--muted);font-size:11px">Varyant tanımlanmamış.</td></tr>`
            : cp.product_variants.map(v => `
              <tr>
                <td>${v.color || '—'}</td><td>${v.size || '—'}</td><td>${v.model || '—'}</td>
                <td><input type="number" min="0" value="${v.stock_qty}" class="stock-input" data-variant="${v.id}" style="width:70px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:6px" /></td>
                <td><button class="btn btn-sm btn-ghost stock-save" data-variant="${v.id}"><i class="fas fa-check"></i></button></td>
              </tr>`).join('')}
        </tbody>
      </table></div>
      <button class="btn btn-sm btn-ghost" style="margin-top:8px" onclick="window.__addVariantPrompt('${cp.id}')"><i class="fas fa-plus"></i> Varyant Ekle</button>
    </div>`;
  }).join('');
}

// ═══ MODÜL 3.6 — YENİ ÜRÜN ÖNER ═══════════════════════════════════════
function renderProposeTab() {
  return `
    <div style="max-width:480px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
        Önerdiğiniz ürün admin onayından geçmeden kataloğa görünmez ve satılamaz.
      </div>
      <label style="font-size:11px;color:var(--muted2)">Ürün Adı</label>
      <input id="npName" style="width:100%;margin-bottom:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px" />

      <label style="font-size:11px;color:var(--muted2)">Sektör</label>
      <select id="npSector" style="width:100%;margin-bottom:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px">
        <option value="">Sektör seçin…</option>
        ${sectors.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
      </select>

      <label style="font-size:11px;color:var(--muted2)">Kategori</label>
      <select id="npCategory" style="width:100%;margin-bottom:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px" disabled>
        <option value="">Önce sektör seçin…</option>
      </select>

      <label style="font-size:11px;color:var(--muted2)">Alt Kategori</label>
      <select id="npSubcategory" style="width:100%;margin-bottom:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px" disabled>
        <option value="">Önce kategori seçin…</option>
      </select>

      <label style="font-size:11px;color:var(--muted2)">Teklif Fiyatı (₺)</label>
      <input id="npPrice" type="number" min="0" style="width:100%;margin-bottom:12px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px" />
      <button class="btn btn-gold" id="npSubmit" style="width:100%;justify-content:center"><i class="fas fa-paper-plane"></i> Onaya Gönder</button>
    </div>
  `;
}

// ═══ MODÜL 3.6 — EKSİK SİPARİŞLER ═══════════════════════════════════════
async function renderShortfallsTab(container, ctx) {
  const shortfalls = await fetchMyShortfalls();
  if (shortfalls.length === 0) {
    return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Eksik siparişiniz yok.</div>`;
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Ürün</th><th>Eksik Adet</th><th>Termin</th><th>Ceza Puanı</th><th>Durum</th><th></th></tr></thead>
    <tbody>
      ${shortfalls.map(s => `
        <tr>
          <td>${s.catalog_products?.name || '—'}</td>
          <td>${s.shortfall_qty}</td>
          <td class="font-mono" style="font-size:11px;color:${new Date(s.deadline_at) < new Date() && s.status === 'open' ? 'var(--red)' : 'var(--text)'}">${fmtDate(s.deadline_at)}</td>
          <td style="color:var(--red)">${s.penalty_points}</td>
          <td>${statusTag(s.status)}</td>
          <td>${s.status !== 'resolved' ? `<button class="btn btn-sm btn-green" onclick="window.__resolveShortfall('${s.id}')"><i class="fas fa-check"></i> Tamamladım</button>` : ''}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ═══ MODÜL 9 — TEDARİKÇİ ÖZET İSTATİSTİKLERİ ═══════════════════════════
async function fetchSupplierStats() {
  const totalProducts = myCatalogProducts.length;
  const approved = myCatalogProducts.filter(p => p.is_approved).length;
  const pending = totalProducts - approved;

  // Gelen sipariş + ciro: bu tedarikçinin ürünlerini içeren store_order_items
  const catalogIds = myCatalogProducts.map(p => p.id);
  let incomingOrders = 0, revenue = 0;
  if (catalogIds.length > 0) {
    const { data: storeProductRows } = await sb.from('store_products').select('id').in('catalog_product_id', catalogIds);
    const storeProductIds = (storeProductRows || []).map(r => r.id);
    if (storeProductIds.length > 0) {
      const { data: items } = await sb.from('store_order_items').select('total_price').in('store_product_id', storeProductIds);
      incomingOrders = (items || []).length;
      revenue = (items || []).reduce((s, i) => s + Number(i.total_price || 0), 0);
    }
  }
  return { totalProducts, approved, pending, incomingOrders, revenue };
}

function renderSupplierStatsBar(stats) {
  return `
    <div class="grid-4" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-icon" style="background:rgba(56,189,248,.15);color:var(--blue)"><i class="fas fa-boxes"></i></div><div><div class="stat-label">TOPLAM ÜRÜN</div><div class="stat-value">${stats.totalProducts}</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(16,185,129,.15);color:var(--green)"><i class="fas fa-circle-check"></i></div><div><div class="stat-label">ONAYLI</div><div class="stat-value">${stats.approved}</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(245,158,11,.15);color:var(--amber, #F59E0B)"><i class="fas fa-hourglass-half"></i></div><div><div class="stat-label">ONAY BEKLEYEN</div><div class="stat-value">${stats.pending}</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(212,175,55,.15);color:var(--gold)"><i class="fas fa-sack-dollar"></i></div><div><div class="stat-label">GELEN SİPARİŞ / CİRO</div><div class="stat-value" style="font-size:14px">${stats.incomingOrders} / ₺${stats.revenue.toLocaleString('tr-TR')}</div></div></div>
    </div>
  `;
}

async function render(container, ctx) {
  const tabs = [
    { id: 'auctions', label: 'Gelen Talepler', icon: 'fa-bullhorn' },
    { id: 'bids', label: 'Tekliflerim', icon: 'fa-hand-holding-dollar' },
    { id: 'shipments', label: 'Sevkiyat Durumu', icon: 'fa-truck-fast' },
    { id: 'stock', label: 'Stok Yönetimi', icon: 'fa-warehouse' },
    { id: 'propose', label: 'Yeni Ürün Öner', icon: 'fa-plus' },
    { id: 'shortfalls', label: 'Eksik Siparişler', icon: 'fa-triangle-exclamation' },
  ];
  const stats = await fetchSupplierStats();

  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-industry" style="color:var(--gold)"></i>Tedarikçi Paneli</div>
    </div>
    ${renderSupplierStatsBar(stats)}
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
  else if (activeTab === 'shipments') body.innerHTML = await renderShipmentsTab(ctx);
  else if (activeTab === 'stock') body.innerHTML = renderStockTab(container, ctx);
  else if (activeTab === 'propose') body.innerHTML = renderProposeTab();
  else body.innerHTML = await renderShortfallsTab(container, ctx);

  // Global köprüler — inline onclick'ten (tablo satırları dinamik olduğu için
  // event delegation yerine basit global fonksiyonlar kullanıldı, mevcut
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

  window.__addVariantPrompt = (catalogProductId) => {
    const color = prompt('Renk (opsiyonel):') || '';
    const size = prompt('Beden (opsiyonel):') || '';
    const model = prompt('Model (opsiyonel):') || '';
    const qty = Number(prompt('Stok adedi:', '0') || 0);
    if (!color && !size && !model) return alert('En az bir varyant özelliği (renk/beden/model) girmelisiniz.');
    addVariant(catalogProductId, color, size, model, qty, container, ctx);
  };

  window.__resolveShortfall = (id) => resolveShortfall(id, container, ctx);

  if (activeTab === 'stock') {
    body.querySelectorAll('.stock-save').forEach(btn => {
      btn.onclick = () => {
        const input = body.querySelector(`.stock-input[data-variant="${btn.dataset.variant}"]`);
        updateVariantStock(btn.dataset.variant, Number(input.value), container, ctx);
      };
    });
  }

  if (activeTab === 'propose') {
    const sectorEl = body.querySelector('#npSector');
    const categoryEl = body.querySelector('#npCategory');
    const subcategoryEl = body.querySelector('#npSubcategory');

    const fillCategories = (sectorId) => {
      const opts = categories.filter(c => c.sector_id === sectorId);
      categoryEl.innerHTML = opts.length
        ? `<option value="">Kategori seçin…</option>${opts.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}`
        : `<option value="">Bu sektörde kategori yok</option>`;
      categoryEl.disabled = opts.length === 0;
      subcategoryEl.innerHTML = `<option value="">Önce kategori seçin…</option>`;
      subcategoryEl.disabled = true;
    };
    const fillSubcategories = (categoryId) => {
      const opts = subcategories.filter(s => s.category_id === categoryId);
      subcategoryEl.innerHTML = opts.length
        ? `<option value="">Alt kategori seçin (opsiyonel)</option>${opts.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}`
        : `<option value="">Bu kategoride alt kategori yok</option>`;
      subcategoryEl.disabled = opts.length === 0;
    };

    sectorEl.onchange = () => fillCategories(sectorEl.value);
    categoryEl.onchange = () => fillSubcategories(categoryEl.value);

    body.querySelector('#npSubmit').onclick = () => {
      const name = body.querySelector('#npName').value.trim();
      const category_id = categoryEl.value;
      const subcategory_id = subcategoryEl.value || null;
      const suggested_price = Number(body.querySelector('#npPrice').value);
      if (!name) return alert('Ürün adı gerekli.');
      if (!category_id) return alert('Sektör ve kategori seçin.');
      if (!suggested_price || suggested_price <= 0) return alert('Geçerli bir fiyat girin.');
      proposeNewProduct({ name, category_id, subcategory_id, suggested_price }, container, ctx);
    };
  }
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
    [myCatalogProducts, categories, sectors, subcategories] = await Promise.all([
      fetchMyCatalogProducts(), fetchCategories(), fetchSectors(), fetchSubcategories(),
    ]);
    await render(container, ctx);
  },
  unmount() {
    delete window.__supplierBidPrompt;
    delete window.__addVariantPrompt;
    delete window.__resolveShortfall;
  },
});
