/**
 * modules/dealer-catalog.js
 * ─────────────────────────────────────────────────────────────────────────
 * ÜRÜN SEÇİMİ MODÜLÜ — DEALER rolüne özel (DB değeri: 'dealer', eski adı 'seller').
 *
 * Spec (DEALER CORE SYSTEM §2-3):
 *   - Bayi ürün YARATAMAZ, sadece public.catalog_products (onaylı tedarikçi
 *     havuzu) içinden SEÇER. Seçim, gerçek bir public.store_products satırı
 *     olarak (catalog_product_id ile bağlı) INSERT edilir.
 *   - Her katıldığı kategoride, o kategorideki toplam ürünlerin en az %20'sini
 *     seçmek ZORUNDA — yoksa kategori INACTIVE kalır (100 üründen 20'si gibi).
 *     Bu oran public.store_category_status tablosunda DB tetikleyicisiyle
 *     otomatik hesaplanır; burada sadece gösterilir.
 *   - Seçtiği HER ürün için en az 1 canlı sunum videosu yüklemek ZORUNDA.
 *     Video yoksa ürün is_active=true yapılamaz (DB seviyesinde engellenir).
 *   - En az 1 AKTİF kategori + geçerli seçim yoksa panel kilitli kalır
 *     (bkz. modules/live-sales.js renderLockedDashboard).
 */

import { registerModule } from './registry.js';

let sb = null;
let store = null;
let categories = [];
let catalogByCategory = new Map(); // category_id -> catalog_products[]
let myProducts = [];               // store_products (+catalog_product_id)
let activeCategoryId = null;
let uploadingId = null;

async function ensureStore(ctx) {
  const { data } = await sb.from('stores').select('*').eq('owner_id', ctx.profile.id).maybeSingle();
  return data;
}

async function loadAll() {
  const [{ data: cats }, { data: catalog }, { data: mine }] = await Promise.all([
    sb.from('categories').select('id,name,sector_id').eq('is_active', true).order('name'),
    sb.from('catalog_products').select('*').eq('is_approved', true).order('name'),
    sb.from('store_products').select('*, product_videos(id, video_url, created_at)').eq('store_id', store.id),
  ]);
  categories = cats || [];
  myProducts = mine || [];
  catalogByCategory = new Map();
  for (const p of catalog || []) {
    if (!catalogByCategory.has(p.category_id)) catalogByCategory.set(p.category_id, []);
    catalogByCategory.get(p.category_id).push(p);
  }
  if (!activeCategoryId && categories.length) activeCategoryId = categories[0].id;
}

async function loadCategoryStatus() {
  const { data } = await sb.from('store_category_status').select('*').eq('store_id', store.id);
  return data || [];
}

function myProductFor(catalogProductId) {
  return myProducts.find(p => p.catalog_product_id === catalogProductId);
}

async function selectProduct(catalogProduct) {
  const { error } = await sb.from('store_products').insert({
    store_id: store.id,
    catalog_product_id: catalogProduct.id,
    category_id: catalogProduct.category_id,
    name: catalogProduct.name,
    description: catalogProduct.description,
    image_url: catalogProduct.image_url,
    unit: catalogProduct.unit,
    unit_size: catalogProduct.unit_size,
    price: catalogProduct.suggested_price || 0,
    is_active: false, // video yüklenene kadar pasif kalır — DB de zaten zorunlu kılıyor
  });
  if (error) { alert('Ürün seçilemedi: ' + error.message); return false; }
  return true;
}

async function deselectProduct(storeProductId) {
  const { error } = await sb.from('store_products').delete().eq('id', storeProductId);
  if (error) alert('Kaldırılamadı: ' + error.message);
}

// ═══ MODÜL 3.6 §9 — ÜRÜN ÖNERİSİ + TEDARİKÇİ KAZANDIRMA (+%5 komisyon) ═══
// Bayi beğendiği bir ürünü + tedarikçi bilgisini sisteme önerir. Admin
// kabul edip kataloğa eklerse, bu bayi o üründen yapılan HER satıştan
// (kendisi satmasa bile) +%5 ek komisyon almaya başlar — hesaplama tamamen
// DB tarafında (compute_order_item_commissions), burada sadece öneri INSERT
// ediliyor.
async function proposeProduct(payload) {
  const { error } = await sb.from('product_suggestions').insert({
    suggested_by_store_id: store.id,
    product_name: payload.name,
    category_id: payload.categoryId || null,
    supplier_contact_info: payload.supplierInfo || null,
    notes: payload.notes || null,
  });
  if (error) { alert('Öneri gönderilemedi: ' + error.message); return false; }
  alert('Ürün öneriniz admin incelemesine gönderildi. Kataloğa eklenirse bu üründen yapılan satışlardan +%5 ek komisyon kazanırsınız.');
  return true;
}

async function uploadVideo(storeProductId, file, container, ctx) {
  uploadingId = storeProductId;
  render(container, ctx);
  try {
    const path = `${store.id}/${storeProductId}/${Date.now()}-${file.name}`;
    const { error: upErr } = await sb.storage.from('dealer-videos').upload(path, file, { upsert: false });
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from('dealer-videos').getPublicUrl(path);
    const { error: insErr } = await sb.from('product_videos').insert({
      store_product_id: storeProductId,
      video_url: pub.publicUrl,
      source: 'live_recording',
    });
    if (insErr) throw insErr;
    // Video var artık — ürünü aktive et (DB tetikleyicisi has_video=true görüp izin verir).
    await sb.from('store_products').update({ is_active: true }).eq('id', storeProductId);
  } catch (e) {
    alert('Video yüklenemedi: ' + e.message);
  } finally {
    uploadingId = null;
    await loadAll();
    render(container, ctx);
  }
}

function progressColor(ratio) {
  if (ratio >= 0.20) return 'var(--green)';
  if (ratio >= 0.10) return 'var(--gold)';
  return 'var(--red)';
}

async function render(container, ctx) {
  if (!store) {
    container.innerHTML = `<div class="card" style="max-width:420px;margin:40px auto;text-align:center;color:var(--muted);font-size:12px">
      Önce "Canlı Satış" sayfasından mağazanızı oluşturun.</div>`;
    return;
  }

  const catStatus = await loadCategoryStatus();
  const statusByCat = new Map(catStatus.map(c => [c.category_id, c]));

  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-boxes-stacked" style="color:var(--gold)"></i> Ürün Seçimi (Onaylı Katalog)</div>
      <button class="btn btn-ghost btn-sm" id="dcProposeBtn"><i class="fas fa-lightbulb"></i> Ürün Öner (+%5 Komisyon)</button>
    </div>
    <div class="card" style="margin-bottom:16px;font-size:12px;color:var(--muted)">
      Ürünleri kendiniz oluşturamazsınız — yalnızca onaylı tedarikçi kataloğundan seçebilirsiniz.
      Her kategoride ürünlerin en az <b style="color:var(--gold)">%20</b>'sini seçmeniz gerekir, aksi halde kategori pasif kalır.
      Seçtiğiniz her ürün için en az <b style="color:var(--gold)">1 canlı sunum videosu</b> yüklemelisiniz — yoksa ürün canlıda gösterilemez ve satılamaz.
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${categories.map(c => {
        const st = statusByCat.get(c.id);
        const ratio = st ? st.selection_ratio : 0;
        const isActiveTab = c.id === activeCategoryId;
        return `<button class="btn btn-sm dc-cat-btn ${isActiveTab ? 'btn-gold' : 'btn-ghost'}" data-cat="${c.id}">
          ${c.name} ${st ? `<span style="font-size:10px;color:${progressColor(ratio)}">(%${Math.round(ratio * 100)})</span>` : ''}
        </button>`;
      }).join('')}
    </div>

    <div id="dcCategoryBody"></div>
  `;

  container.querySelectorAll('.dc-cat-btn').forEach(btn => {
    btn.onclick = () => { activeCategoryId = btn.dataset.cat; render(container, ctx); };
  });

  container.querySelector('#dcProposeBtn').onclick = () => {
    const name = prompt('Önerdiğiniz ürünün adı:');
    if (!name) return;
    const supplierInfo = prompt('Tedarikçi bilgisi (opsiyonel — firma adı, iletişim vb.):') || '';
    const notes = prompt('Not (opsiyonel):') || '';
    proposeProduct({ name, categoryId: activeCategoryId, supplierInfo, notes });
  };

  renderCategoryBody(container, ctx, statusByCat);
}

function renderCategoryBody(container, ctx, statusByCat) {
  const body = container.querySelector('#dcCategoryBody');
  if (!body) return;
  const catalog = catalogByCategory.get(activeCategoryId) || [];
  const st = statusByCat.get(activeCategoryId);
  const ratio = st ? st.selection_ratio : 0;
  const need = Math.max(0, Math.ceil(catalog.length * 0.20) - (st?.selected_products || 0));

  body.innerHTML = `
    ${catalog.length > 0 ? `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
        <span>Seçim oranı: <b style="color:${progressColor(ratio)}">%${Math.round(ratio * 100)}</b> / %20 gerekli</span>
        <span>${st?.selected_products || 0} / ${catalog.length} ürün</span>
      </div>
      <div style="height:8px;background:var(--bg);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${Math.min(100, ratio * 100)}%;background:${progressColor(ratio)}"></div>
      </div>
      ${need > 0 ? `<div style="font-size:11px;color:var(--red);margin-top:6px">Kategoriyi aktifleştirmek için ${need} ürün daha seçmelisiniz.</div>` : `<div style="font-size:11px;color:var(--green);margin-top:6px"><i class="fas fa-circle-check"></i> Kategori aktif.</div>`}
    </div>` : ''}

    <div class="table-wrap"><table>
      <thead><tr><th>Ürün</th><th>Önerilen Fiyat</th><th>Seçim</th><th>Video</th><th>Toptan Alım</th></tr></thead>
      <tbody>
        ${catalog.length === 0
          ? `<tr><td colspan="5" style="color:var(--muted);font-size:12px">Bu kategoride onaylı katalog ürünü yok.</td></tr>`
          : catalog.map(cp => {
            const mine = myProductFor(cp.id);
            return `<tr>
              <td>${cp.name}</td>
              <td class="font-mono">₺${Number(cp.suggested_price || 0).toLocaleString('tr-TR')}</td>
              <td>
                ${mine
                  ? `<button class="btn btn-sm btn-red dc-deselect" data-store-product="${mine.id}"><i class="fas fa-xmark"></i> Kaldır</button>`
                  : `<button class="btn btn-sm btn-green dc-select" data-catalog="${cp.id}"><i class="fas fa-plus"></i> Seç</button>`}
              </td>
              <td>
                ${!mine ? '—' : mine.has_video
                  ? `<span class="tag tag-green" style="font-size:10px"><i class="fas fa-circle-check"></i> Yüklendi</span>`
                  : uploadingId === mine.id
                    ? `<span style="font-size:11px;color:var(--muted)">Yükleniyor...</span>`
                    : `<label class="btn btn-sm btn-ghost" style="cursor:pointer">
                        <i class="fas fa-video"></i> Video Yükle
                        <input type="file" accept="video/*" class="dc-video-input" data-store-product="${mine.id}" style="display:none">
                      </label>`}
              </td>
              <td>
                <button class="btn btn-sm btn-ghost dc-start-auction" data-catalog="${cp.id}" data-name="${cp.name}" data-ceiling="${cp.suggested_price || 0}">
                  <i class="fas fa-gavel"></i> İhale Başlat
                </button>
              </td>
            </tr>`;
          }).join('')}
      </tbody>
    </table></div>
  `;

  // FAZ B — Toptan (azalan teklif) ihale başlat. Onaylı katalog ürününden
  // start_wholesale_auction() RPC'sini çağırır (sadece dealer çağırabilir —
  // DB tarafında da zorlanıyor). Kazananı SADECE tedarikçiler belirleyebilir
  // (supplier_bids RLS'i bunu ayrıca garanti ediyor).
  body.querySelectorAll('.dc-start-auction').forEach(btn => {
    btn.onclick = async () => {
      const qty = Number(prompt(`"${btn.dataset.name}" için toplam miktar:`, '100'));
      if (!qty || qty <= 0) return;
      const unit = prompt('Miktar birimi (kg, adet, koli...):', 'kg') || 'kg';
      const ceiling = Number(prompt('Tavan birim fiyat (₺):', btn.dataset.ceiling) || 0);
      if (!ceiling || ceiling <= 0) return alert('Geçerli bir tavan fiyat girin.');
      const hours = Number(prompt('İhale kaç saat açık kalsın?', '48') || 48);

      const { data, error } = await sb.rpc('start_wholesale_auction', {
        p_catalog_product_id: btn.dataset.catalog,
        p_quantity: qty,
        p_quantity_unit: unit,
        p_ceiling_price: ceiling,
        p_hours_open: hours,
      });
      if (error) return alert('İhale başlatılamadı: ' + error.message);
      alert('Toptan alım ihalesi başlatıldı. Tedarikçiler teklif verebilir.');
    };
  });

  body.querySelectorAll('.dc-select').forEach(btn => {
    btn.onclick = async () => {
      const cp = catalog.find(c => c.id === btn.dataset.catalog);
      if (cp && await selectProduct(cp)) { await loadAll(); render(container, ctx); }
    };
  });
  body.querySelectorAll('.dc-deselect').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Bu ürünü seçiminizden kaldırmak istediğinize emin misiniz?')) return;
      await deselectProduct(btn.dataset.storeProduct);
      await loadAll(); render(container, ctx);
    };
  });
  body.querySelectorAll('.dc-video-input').forEach(input => {
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) uploadVideo(input.dataset.storeProduct, file, container, ctx);
    };
  });
}

registerModule({
  id: 'dealer-catalog',
  label: 'Ürün Seçimi',
  icon: 'fa-list-check',
  roles: ['dealer'],
  async mount(container, ctx) {
    sb = ctx.sb;
    store = await ensureStore(ctx);
    if (store) await loadAll();
    await render(container, ctx);
  },
  unmount() {},
});
