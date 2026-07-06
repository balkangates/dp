/**
 * modules/dealer-performance.js
 * ─────────────────────────────────────────────────────────────────────────
 * PASİF BAYİ PERFORMANS TAKİBİ — DEALER rolüne özel (DB değeri: 'dealer', eski adı 'seller').
 *
 * Spec (DEALER CORE SYSTEM §1): aylık bazda hesaplanan gerçek performans.
 * Hesaplama tamamen DB tarafında yapılır (bkz. supabase_migration_v3_dealer_core.sql
 * → evaluate_dealer_monthly_performance()); bu modül SADECE
 * public.dealer_monthly_performance satırlarını okuyup gösterir — istemci
 * tarafında hiçbir puan/ceza hesaplaması YAPILMAZ (spec'in "no fake data,
 * no simulation" kuralına uygun, tek kaynak DB'dir).
 */

import { registerModule } from './registry.js';

let sb = null;
let store = null;

async function ensureStore(ctx) {
  const { data } = await sb.from('stores').select('*').eq('owner_id', ctx.profile.id).maybeSingle();
  return data;
}

async function loadHistory() {
  const { data } = await sb.from('dealer_monthly_performance')
    .select('*')
    .eq('store_id', store.id)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  return data || [];
}

async function loadRanking() {
  // Bu ay en çok satış yapan bayiler — "success + ranking" gösterimi için.
  const now = new Date();
  const { data } = await sb.from('dealer_monthly_performance')
    .select('store_id, sales_count, stores(name)')
    .eq('period_year', now.getFullYear())
    .eq('period_month', now.getMonth() + 1)
    .order('sales_count', { ascending: false })
    .limit(10);
  return data || [];
}

const STATUS_META = {
  OK:               { color: 'var(--green)', icon: 'fa-circle-check', label: 'Normal' },
  WARNING:          { color: 'var(--gold)',  icon: 'fa-triangle-exclamation', label: 'Uyarı' },
  LOW_SALES:        { color: 'var(--gold)',  icon: 'fa-arrow-trend-down', label: 'Düşük Satış' },
  ZERO_SALES:       { color: 'var(--red)',   icon: 'fa-xmark', label: 'Satış Yok' },
  IMPROVED:         { color: 'var(--green)', icon: 'fa-arrow-trend-up', label: 'Gelişti' },
  REWARD_ELIGIBLE:  { color: 'var(--gold)',  icon: 'fa-trophy', label: 'Ödüle Hak Kazandı' },
  SUSPENDED:        { color: 'var(--red)',   icon: 'fa-ban', label: 'Askıya Alındı' },
};

function monthLabel(y, m) {
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

async function render(container, ctx) {
  if (!store) {
    container.innerHTML = `<div class="card" style="max-width:420px;margin:40px auto;text-align:center;color:var(--muted);font-size:12px">
      Önce "Canlı Satış" sayfasından mağazanızı oluşturun.</div>`;
    return;
  }

  const [history, ranking] = await Promise.all([loadHistory(), loadRanking()]);
  const current = history[0];
  const meta = current ? (STATUS_META[current.status] || STATUS_META.OK) : null;
  const showRanking = current && ['IMPROVED', 'OK', 'REWARD_ELIGIBLE'].includes(current.status) && current.dealer_month_number >= 3;

  container.innerHTML = `
    <div class="section-head">
      <div class="section-title"><i class="fas fa-chart-line" style="color:var(--gold)"></i> Bayi Performansı</div>
    </div>

    ${!current ? `
      <div class="card" style="color:var(--muted);font-size:12px">Henüz değerlendirilmiş bir ay yok. İlk değerlendirme, mağazanızın kurulduğu ayın sonunda yapılır.</div>
    ` : `
      <div class="card" style="margin-bottom:16px;border-left:4px solid ${meta.color}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:800;font-size:14px"><i class="fas ${meta.icon}" style="color:${meta.color}"></i> ${monthLabel(current.period_year, current.period_month)} — ${current.dealer_month_number}. Ay</div>
          <span class="tag" style="background:${meta.color}22;color:${meta.color};border:1px solid ${meta.color}55">${meta.label}</span>
        </div>
        <div style="font-size:12px;color:var(--muted2);margin-bottom:12px">${current.message}</div>
        <div class="grid-4">
          <div class="stat-card"><div class="stat-label">SATIŞ</div><div class="stat-value">${current.sales_count}</div></div>
          <div class="stat-card"><div class="stat-label">GEÇEN AY</div><div class="stat-value">${current.prev_sales_count}</div></div>
          <div class="stat-card"><div class="stat-label">CANLI GÜN</div><div class="stat-value" style="color:${current.live_compliant ? 'var(--green)' : 'var(--red)'}">${current.live_days}/${current.live_days_required}</div></div>
          <div class="stat-card"><div class="stat-label">TOPLAM CEZA PUANI</div><div class="stat-value" style="color:${current.cumulative_penalty < 0 ? 'var(--red)' : 'var(--text)'}">${current.cumulative_penalty}</div></div>
        </div>
      </div>
    `}

    ${showRanking ? `
      <div class="card" style="margin-bottom:16px">
        <div class="section-title" style="font-size:13px;margin-bottom:10px"><i class="fas fa-ranking-star" style="color:var(--gold)"></i> Bu Ay Bayi Sıralaması</div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Bayi</th><th>Satış</th></tr></thead><tbody>
          ${ranking.map((r, i) => `<tr style="${r.store_id === store.id ? 'font-weight:800;color:var(--gold)' : ''}">
            <td>${i + 1}</td><td>${r.stores?.name || '—'}</td><td>${r.sales_count}</td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>
    ` : ''}

    <div class="card">
      <div class="section-title" style="font-size:13px;margin-bottom:10px"><i class="fas fa-clock-rotate-left" style="color:var(--blue)"></i> Geçmiş</div>
      <div class="table-wrap"><table><thead><tr><th>Ay</th><th>Satış</th><th>Canlı Gün</th><th>Ceza</th><th>Durum</th></tr></thead><tbody>
        ${history.length === 0 ? `<tr><td colspan="5" style="color:var(--muted);font-size:12px">Kayıt yok.</td></tr>` :
          history.map(h => {
            const m = STATUS_META[h.status] || STATUS_META.OK;
            return `<tr>
              <td>${monthLabel(h.period_year, h.period_month)}</td>
              <td>${h.sales_count}</td>
              <td>${h.live_days}/${h.live_days_required}</td>
              <td style="color:${h.penalty_score < 0 ? 'var(--red)' : 'var(--text)'}">${h.penalty_score}</td>
              <td><span class="tag" style="background:${m.color}22;color:${m.color}">${m.label}</span></td>
            </tr>`;
          }).join('')}
      </tbody></table></div>
    </div>
  `;
}

registerModule({
  id: 'dealer-performance',
  label: 'Performans',
  icon: 'fa-chart-line',
  roles: ['dealer'],
  async mount(container, ctx) {
    sb = ctx.sb;
    store = await ensureStore(ctx);
    await render(container, ctx);
  },
  unmount() {},
});
