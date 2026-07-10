/**
 * modules/catalog-admin.js
 * ─────────────────────────────────────────────────────────────────────────
 * ADMIN — MODÜL 3.6 yönetim paneli. 4 sekme:
 *   1. Katalog Onayı     → catalog_products (is_approved=false) → onayla/reddet
 *   2. Komisyon Oranları → categories.commission_pct düzenleme
 *   3. Ürün Önerileri    → product_suggestions (pending) → kabul et (katalog
 *      ürünüyle eşle, +%5 referral komisyonu başlar) / reddet
 *   4. Bayi Kazançları   → dealer_earnings — ödeme durumu (pending→paid)
 *
 * Hiçbir hesaplama burada YAPILMAZ — hepsi migration'daki DB fonksiyonlarının
 * (accept_product_suggestion, calculate_monthly_dealer_earnings, ...) UI'ı.
 */

import { registerModule } from './registry.js';

let sb = null;
let activeTab = 'pending-catalog';

async function fetchPendingCatalog() {
  const { data } = await sb.from('catalog_products').select('*, categories(name)').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}
async function fetchCategories() {
  const { data } = await sb.from('categories').select('*').order('name');
  return data || [];
}
async function fetchPendingSuggestions() {
  const { data } = await sb.from('product_suggestions').select('*, stores(name), categories(name)').eq('status', 'pending').order('created_at', { ascending: false });
  return data || [];
}
async function fetchCatalogForSelect() {
  const { data } = await sb.from('catalog_products').select('id,name').eq('is_approved', true).order('name');
  return data || [];
}
async function fetchEarnings() {
  const { data } = await sb.from('dealer_earnings').select('*, stores(name)').order('period_year', { ascending: false }).order('period_month', { ascending: false });
  return data || [];
}

function fmtMoney(n) { return `₺${Number(n || 0).toLocaleString('tr-TR')}`; }
function monthLabel(y, m) { return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }); }

async function renderPendingCatalogTab(container, ctx) {
  const items = await fetchPendingCatalog();
  if (items.length === 0) return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Onay bekleyen ürün yok.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Ürün</th><th>Kategori</th><th>Tedarikçi Teklifi</th><th>Nihai Satış Fiyatı</th><th>İşlem</th></tr></thead>
    <tbody>
      ${items.map(p => `
        <tr>
          <td>${p.name}</td>
          <td>${p.categories?.name || '—'}</td>
          <td class="font-mono" style="color:var(--muted)">${fmtMoney(p.suggested_price)}</td>
          <td>
            <input type="number" min="0" step="0.01" value="${p.suggested_price || 0}" class="final-price-input" data-catalog="${p.id}"
              style="width:110px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:6px" />
          </td>
          <td>
            <button class="btn btn-sm btn-green" data-approve="${p.id}"><i class="fas fa-check"></i> Onayla</button>
            <button class="btn btn-sm btn-red" data-reject="${p.id}"><i class="fas fa-xmark"></i> Reddet</button>
          </td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function renderCommissionRatesTab() {
  const cats = await fetchCategories();
  return `<div class="table-wrap"><table>
    <thead><tr><th>Kategori</th><th>Komisyon Oranı (%)</th><th></th></tr></thead>
    <tbody>
      ${cats.map(c => `
        <tr>
          <td>${c.name}</td>
          <td><input type="number" min="0" max="100" step="0.5" value="${c.commission_pct}" class="rate-input" data-cat="${c.id}" style="width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:6px" /></td>
          <td><button class="btn btn-sm btn-ghost rate-save" data-cat="${c.id}"><i class="fas fa-check"></i> Kaydet</button></td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function renderSuggestionsTab() {
  const suggestions = await fetchPendingSuggestions();
  if (suggestions.length === 0) return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Bekleyen ürün önerisi yok.</div>`;
  const catalogOptions = await fetchCatalogForSelect();
  return `<div class="table-wrap"><table>
    <thead><tr><th>Öneren Bayi</th><th>Ürün</th><th>Kategori</th><th>Tedarikçi Bilgisi</th><th>İşlem</th></tr></thead>
    <tbody>
      ${suggestions.map(s => `
        <tr>
          <td>${s.stores?.name || '—'}</td>
          <td>${s.product_name}</td>
          <td>${s.categories?.name || '—'}</td>
          <td style="font-size:11px;color:var(--muted)">${s.supplier_contact_info || '—'}</td>
          <td>
            <select class="accept-select" data-suggestion="${s.id}" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:6px;font-size:11px">
              <option value="">— katalog ürünü seç —</option>
              ${catalogOptions.map(cp => `<option value="${cp.id}">${cp.name}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-green accept-suggestion" data-suggestion="${s.id}"><i class="fas fa-check"></i> Kabul Et</button>
            <button class="btn btn-sm btn-red" onclick="window.__rejectSuggestion('${s.id}')"><i class="fas fa-xmark"></i> Reddet</button>
          </td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function renderEarningsTab() {
  const rows = await fetchEarnings();
  if (rows.length === 0) return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Henüz hesaplanmış bir dönem yok (her ayın ilk iş günü otomatik hesaplanır).</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Bayi</th><th>Dönem</th><th>Satış Komisyonu</th><th>Referral Bonus</th><th>Toplam</th><th>Durum</th><th></th></tr></thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${r.stores?.name || '—'}</td>
          <td>${monthLabel(r.period_year, r.period_month)}</td>
          <td class="font-mono">${fmtMoney(r.gross_commission)}</td>
          <td class="font-mono" style="color:var(--gold)">${fmtMoney(r.referral_bonus)}</td>
          <td class="font-mono" style="font-weight:800">${fmtMoney(r.total_payable)}</td>
          <td><span class="tag ${r.payment_status === 'paid' ? 'tag-green' : 'tag-amber'}">${r.payment_status === 'paid' ? 'Ödendi' : 'Bekliyor'}</span></td>
          <td>${r.payment_status === 'pending' ? `<button class="btn btn-sm btn-green" onclick="window.__markPaid('${r.id}')"><i class="fas fa-money-bill"></i> Ödendi İşaretle</button>` : `<span style="font-size:10px;color:var(--muted)">${r.payment_method || ''}</span>`}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function render(container, ctx) {
  const tabs = [
    { id: 'pending-catalog', label: 'Katalog Onayı', icon: 'fa-clipboard-check' },
    { id: 'commission-rates', label: 'Komisyon Oranları', icon: 'fa-percent' },
    { id: 'suggestions', label: 'Ürün Önerileri', icon: 'fa-lightbulb' },
    { id: 'earnings', label: 'Bayi Kazançları', icon: 'fa-sack-dollar' },
  ];

  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-truck-ramp-box" style="color:var(--gold)"></i>Tedarik & Komisyon Yönetimi</div>
    </div>
    <div class="pill-tabs" id="caTabs">
      ${tabs.map(t => `<div class="pill-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}"><i class="fas ${t.icon}"></i> ${t.label}</div>`).join('')}
    </div>
    <div class="card" id="caTabBody" style="margin-top:12px"><div style="text-align:center;padding:30px"><i class="fas fa-spinner fa-spin"></i></div></div>
  `;

  container.querySelectorAll('#caTabs .pill-tab').forEach(el => {
    el.onclick = async () => { activeTab = el.dataset.tab; await render(container, ctx); };
  });

  const body = container.querySelector('#caTabBody');
  if (activeTab === 'pending-catalog') body.innerHTML = await renderPendingCatalogTab(container, ctx);
  else if (activeTab === 'commission-rates') body.innerHTML = await renderCommissionRatesTab();
  else if (activeTab === 'suggestions') body.innerHTML = await renderSuggestionsTab();
  else body.innerHTML = await renderEarningsTab();

  // Onayla: admin nihai satış fiyatını girer (supplier'ın önerisiyle aynı
  // olabilir ya da değiştirilebilir) — status='approved' olunca
  // sync_catalog_is_approved trigger'ı is_approved/is_active'i otomatik true yapar.
  window.__approveCatalog = async (id, finalPrice) => {
    const { error } = await sb.from('catalog_products')
      .update({ status: 'approved', suggested_price: finalPrice, reviewed_by: ctx.user.id })
      .eq('id', id);
    if (error) return alert('Onaylanamadı: ' + error.message);
    await render(container, ctx);
  };
  // Reddet: SİLMEZ — supplier'ın yeniden fiyat girip gönderebilmesi için
  // status='rejected' + sebep kaydedilir. Supplier kendi panelinden
  // (rejected sekmesi) yeni fiyatla tekrar 'pending'e çekebilir.
  window.__rejectCatalog = async (id) => {
    const reason = prompt('Red sebebi (tedarikçi bu mesajı görecek):');
    if (reason === null) return;
    const { error } = await sb.from('catalog_products')
      .update({ status: 'rejected', rejection_reason: reason, rejected_at: new Date().toISOString(), reviewed_by: ctx.user.id })
      .eq('id', id);
    if (error) return alert('İşlem başarısız: ' + error.message);
    await render(container, ctx);
  };
  window.__rejectSuggestion = async (id) => {
    const { error } = await sb.from('product_suggestions').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) return alert('İşlem başarısız: ' + error.message);
    await render(container, ctx);
  };
  window.__markPaid = async (id) => {
    const method = prompt('Ödeme yöntemi (USDT / bank / wallet):', 'USDT');
    if (!method) return;
    const { error } = await sb.from('dealer_earnings').update({ payment_status: 'paid', payment_method: method, paid_at: new Date().toISOString() }).eq('id', id);
    if (error) return alert('İşlem başarısız: ' + error.message);
    await render(container, ctx);
  };

  if (activeTab === 'pending-catalog') {
    body.querySelectorAll('[data-approve]').forEach(btn => {
      btn.onclick = async () => {
        const input = body.querySelector(`.final-price-input[data-catalog="${btn.dataset.approve}"]`);
        const price = Number(input?.value || 0);
        if (!price || price <= 0) return alert('Geçerli bir nihai satış fiyatı girin.');
        await window.__approveCatalog(btn.dataset.approve, price);
      };
    });
    body.querySelectorAll('[data-reject]').forEach(btn => {
      btn.onclick = () => window.__rejectCatalog(btn.dataset.reject);
    });
  }

  if (activeTab === 'commission-rates') {
    body.querySelectorAll('.rate-save').forEach(btn => {
      btn.onclick = async () => {
        const input = body.querySelector(`.rate-input[data-cat="${btn.dataset.cat}"]`);
        const { error } = await sb.from('categories').update({ commission_pct: Number(input.value) }).eq('id', btn.dataset.cat);
        if (error) return alert('Kaydedilemedi: ' + error.message);
        btn.innerHTML = '<i class="fas fa-check" style="color:var(--green)"></i>';
      };
    });
  }

  if (activeTab === 'suggestions') {
    body.querySelectorAll('.accept-suggestion').forEach(btn => {
      btn.onclick = async () => {
        const select = body.querySelector(`.accept-select[data-suggestion="${btn.dataset.suggestion}"]`);
        const catalogId = select.value;
        if (!catalogId) return alert('Önce bu öneriyi hangi katalog ürününe bağlayacağınızı seçin.');
        const { error } = await sb.rpc('accept_product_suggestion', { p_id: btn.dataset.suggestion, p_catalog_product_id: catalogId });
        if (error) return alert('İşlem başarısız: ' + error.message);
        await render(container, ctx);
      };
    });
  }
}

registerModule({
  id: 'catalog-admin',
  label: 'Tedarik & Komisyon',
  icon: 'fa-truck-ramp-box',
  roles: ['admin'],
  async mount(container, ctx) {
    sb = ctx.sb;
    activeTab = 'pending-catalog';
    await render(container, ctx);
  },
  unmount() {
    delete window.__approveCatalog;
    delete window.__rejectCatalog;
    delete window.__rejectSuggestion;
    delete window.__markPaid;
  },
});
