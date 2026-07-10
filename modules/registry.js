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
  *     roles:    ['dealer'],           // bu modülü hangi profiles.role görebilir
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
  if (role === 'admin') return [...modules.values()];
  return [...modules.values()].filter(m => m.roles.includes(role));
}

export function isRegisteredPage(id) {
  return modules.has(id);
}

/**
 * Bir modülü container'a bas, önceki aktif modülü temiz şekilde kapat.
 * STRICT ROLE GUARD: modül tanımındaki `roles` dizisi burada ZORUNLU olarak
 * kontrol edilir. dashboard.html'deki navigateTo() zaten MENUS bazlı bir
 * guard uyguluyor, ama modüller kendi başlarına da (örn. ileride başka bir
 * yerden mount edilirse) yetkisiz render YAPMAMALI — çift katman savunma.
 */
export function activateModule(id, container, ctx) {
  const mod = modules.get(id);
  if (!mod) return false;

  const role = ctx?.profile?.role;
  const isAdmin = role === 'admin';
  // ADMIN BYPASS: admin her modülü görebilir/açabilir, modülün kendi
  // `roles` dizisinde 'admin' listelenmese bile. Bu, "admin hepsine
  // yetkili olmalı" kararının TEK doğruluk kaynağı — yeni bir modül
  // eklendiğinde her dosyaya 'admin' eklemeyi unutma riskini ortadan
  // kaldırır (bkz. konuşma geçmişi: MENUS.admin + her modülün roles
  // dizisi ayrı ayrı admin'i dışlıyordu).
  if (!Array.isArray(mod.roles) || !role || (!isAdmin && !mod.roles.includes(role))) {
    console.warn(`[ModuleRegistry] "${role || 'bilinmeyen rol'}" için "${id}" modülüne erişim REDDEDİLDİ (izinli: ${mod.roles?.join(', ')})`);
    if (container) {
      container.innerHTML = `<div class="card" style="max-width:420px;margin:60px auto;text-align:center">
        <i class="fas fa-lock" style="font-size:28px;color:var(--red);margin-bottom:12px;display:block"></i>
        <div style="font-weight:800;margin-bottom:6px">Erişim Yetkiniz Yok</div>
        <div style="font-size:12px;color:var(--muted)">Bu modül rolünüze açık değil.</div>
      </div>`;
    }
    return false;
  }

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
