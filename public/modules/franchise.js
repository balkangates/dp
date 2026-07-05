/**
 * modules/franchise.js
 * ─────────────────────────────────────────────────────────────────────────
 * FRANCHISE PANEL MODULE — süpervizör rolü.
 *
 * Spec: "Can view: dealers (seller), performance metrics, sales analytics.
 *        Cannot sell directly."
 *
 * Bu yüzden bilinçli olarak:
 *   - Hiçbir yazma (INSERT/UPDATE/DELETE) işlemi YOK — tamamen salt okunur.
 *   - products/auctions/orders oluşturma sayfalarına hiç erişimi yok
 *     (dashboard.html'deki MENUS.franchise dizisinde sadece bu tek sayfa
 *     var, ayrıca navigateTo()'daki requireRole() bunu zaten garanti ediyor).
 *
 * Veri kaynağı: public.seller_stats (seller_id, total_sales, total_revenue,
 * growth, rating — önceden hesaplanmış, gerçek tablo) + public.profiles
 * (bayi listesi için temel bilgiler). Mock/simülasyon YOK.
 */

import { registerModule } from './registry.js';

let sb = null;
let activeTab = 'dealers';

async function fetchDealers() {
  const { data } = await sb.from('profiles')
    .select('id, full_name, company_name, rating, balance, created_at')
    .eq('role', 'dealer')
    .order('rating', { ascending: false });
  return data || [];
}

async function fetchSellerStats() {
  const { data } = await sb.from('seller_stats').select('*').order('total_revenue', { ascending: false });
  return data || [];
}

function fmtMoney(n) { return `₺${Number(n || 0).toLocaleString('tr-TR')}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('tr-TR') : '—'; }

async function renderDealersTab() {
  const dealers = await fetchDealers();
  if (dealers.length === 0) return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Kayıtlı bayi yok.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Bayi</th><th>Puan</th><th>Bakiye</th><th>Katılım</th></tr></thead>
    <tbody>
      ${dealers.map(d => `
        <tr>
          <td>${d.company_name || d.full_name || '—'}</td>
          <td><i class="fas fa-star" style="color:var(--gold);font-size:11px"></i> ${Number(d.rating || 0).toFixed(1)}</td>
          <td class="font-mono">${fmtMoney(d.balance)}</td>
          <td class="font-mono" style="font-size:11px">${fmtDate(d.created_at)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function renderPerformanceTab() {
  const stats = await fetchSellerStats();
  const totalDealers = stats.length;
  const totalRevenue = stats.reduce((s, r) => s + Number(r.total_revenue || 0), 0);
  const totalSales = stats.reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const avgGrowth = totalDealers ? stats.reduce((s, r) => s + Number(r.growth || 0), 0) / totalDealers : 0;

  return `
    <div class="grid-4" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-icon" style="background:rgba(56,189,248,.15);color:var(--blue)"><i class="fas fa-store"></i></div><div><div class="stat-label">TOPLAM BAYİ</div><div class="stat-value">${totalDealers}</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(16,185,129,.15);color:var(--green)"><i class="fas fa-sack-dollar"></i></div><div><div class="stat-label">TOPLAM CİRO</div><div class="stat-value" style="font-size:15px">${fmtMoney(totalRevenue)}</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(212,175,55,.15);color:var(--gold)"><i class="fas fa-receipt"></i></div><div><div class="stat-label">TOPLAM SATIŞ</div><div class="stat-value">${totalSales}</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(167,139,250,.15);color:#A78BFA"><i class="fas fa-arrow-trend-up"></i></div><div><div class="stat-label">ORT. BÜYÜME</div><div class="stat-value">%${avgGrowth.toFixed(1)}</div></div></div>
    </div>
    <div style="color:var(--muted);font-size:11px">Veriler <code>seller_stats</code> tablosundan; bu tablonun güncel kalması ilgili trigger/job'a bağlı.</div>
  `;
}

async function renderAnalyticsTab() {
  const stats = await fetchSellerStats();
  if (stats.length === 0) return `<div style="color:var(--muted);font-size:12px;padding:20px 0">Analitik verisi yok.</div>`;
  const top = stats.slice(0, 10);
  return `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Bayi</th><th>Satış Adedi</th><th>Ciro</th><th>Büyüme</th></tr></thead>
    <tbody>
      ${top.map((s, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${s.seller_name || '—'}</td>
          <td>${s.total_sales || 0}</td>
          <td class="font-mono">${fmtMoney(s.total_revenue)}</td>
          <td style="color:${Number(s.growth) >= 0 ? 'var(--green)' : 'var(--red)'}">${Number(s.growth || 0) >= 0 ? '+' : ''}${Number(s.growth || 0).toFixed(1)}%</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function render(container) {
  const tabs = [
    { id: 'dealers',     label: 'Bayiler',              icon: 'fa-store' },
    { id: 'performance', label: 'Performans Metrikleri', icon: 'fa-gauge-high' },
    { id: 'analytics',   label: 'Satış Analitiği',       icon: 'fa-chart-column' },
  ];

  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-sitemap" style="color:var(--gold)"></i>Franchise Paneli</div>
      <span class="tag tag-gray" style="font-size:10px"><i class="fas fa-eye"></i> Salt okunur — satış işlemi yapılamaz</span>
    </div>
    <div class="pill-tabs" id="frTabs">
      ${tabs.map(t => `<div class="pill-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}"><i class="fas ${t.icon}"></i> ${t.label}</div>`).join('')}
    </div>
    <div class="card" id="frTabBody" style="margin-top:12px"><div style="text-align:center;padding:30px"><i class="fas fa-spinner fa-spin"></i></div></div>
  `;

  container.querySelectorAll('#frTabs .pill-tab').forEach(el => {
    el.onclick = async () => { activeTab = el.dataset.tab; await render(container); };
  });

  const body = container.querySelector('#frTabBody');
  if (activeTab === 'dealers') body.innerHTML = await renderDealersTab();
  else if (activeTab === 'performance') body.innerHTML = await renderPerformanceTab();
  else body.innerHTML = await renderAnalyticsTab();
}

registerModule({
  id: 'franchise',
  label: 'Franchise Paneli',
  icon: 'fa-sitemap',
  roles: ['franchise'],
  async mount(container, ctx) {
    sb = ctx.sb;
    activeTab = 'dealers';
    await render(container);
  },
  unmount() {},
});
