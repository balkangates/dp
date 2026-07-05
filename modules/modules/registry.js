/**
 * modules/registry.js
 * ─────────────────────────────────────────────────────────────────────────
 * MODÜL-DRIVEN DASHBOARD — çekirdek kayıt sistemi.
 *
 * Neden var:
 *   dashboard.html'deki mevcut MENUS / loadPage() yapısı statik .page div'leri
 *   ve büyük bir switch-case ile çalışıyor — 2700+ satırlık, bugün ÇALIŞAN bir
 *   sistem. Onu tek seferde parçalayıp riske atmak yerine, YENİ eklenen her
 *   özelliğin bundan sonra geçeceği tek, tutarlı bir kayıt noktası kuruyoruz.
 *   Eski sayfalar dokunulmadan çalışmaya devam ediyor; yeni modüller
 *   (live-sales, supplier, ileride: analytics, branding, dealer-profile...)
 *   sadece burada tanımlanıp otomatik olarak menüye + router'a bağlanıyor.
 *
 * Bir modül şu sözleşmeye uyar:
 *   {
 *     id:       'live-sales',        // page id — nav-<id> / page-<id> ile eşleşir
 *     label:    'Canlı Satış',
 *     icon:     'fa-video',
 *     roles:    ['seller'],          // bu modülü hangi profiles.role görebilir
 *     badge:    'CANLI' | undefined, // opsiyonel sabit rozet metni
 *     mount(container, ctx),         // sayfa açıldığında bir kere çağrılır
 *     unmount(),                     // sayfadan çıkılırken çağrılır (interval temizliği vs.)
 *   }
 *
 * ctx = { sb, user, profile, q } — dashboard.html'in kendi Supabase client'ı
 * ve o an login olan kullanıcı/profil bilgisi buradan enjekte edilir; modül
 * kendi Supabase client'ını ASLA yeniden yaratmaz (tek instance kuralı).
 */

const modules = new Map();
let activeModuleId = null;

export function registerModule(def) {
  if (!def || !def.id || typeof def.mount !== 'function') {
    console.error('[ModuleRegistry] Geçersiz modül tanımı:', def);
    return;
  }
  modules.set(def.id, def);
}

export function getModule(id) {
  return modules.get(id) || null;
}

export function getModulesForRole(role) {
  return [...modules.values()].filter(m => m.roles.includes(role));
}

export function isRegisteredPage(id) {
  return modules.has(id);
}

/** Bir modülü container'a bas, önceki aktif modülü temiz şekilde kapat. */
export function activateModule(id, container, ctx) {
  const mod = modules.get(id);
  if (!mod) return false;

  if (activeModuleId && activeModuleId !== id) {
    deactivateModule(activeModuleId);
  }

  try {
    mod.mount(container, ctx);
    activeModuleId = id;
  } catch (err) {
    console.error(`[ModuleRegistry] "${id}" mount hatası:`, err);
    container.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--red)">
      <i class="fas fa-triangle-exclamation" style="font-size:24px;margin-bottom:10px;display:block"></i>
      Bu modül yüklenemedi. Konsolu kontrol edin.
    </div>`;
  }
  return true;
}

export function deactivateModule(id) {
  const mod = modules.get(id);
  if (mod && typeof mod.unmount === 'function') {
    try { mod.unmount(); } catch (err) { console.error(`[ModuleRegistry] "${id}" unmount hatası:`, err); }
  }
  if (activeModuleId === id) activeModuleId = null;
}
