// lib/roles.ts — rol → panel ana sayfası eşlemesi. Hem middleware.ts (yetkisiz
// erişimde geri yönlendirme) hem de login/page.tsx (giriş sonrası doğru
// panele yönlendirme) TEK bir kaynaktan okusun diye ayrı dosyaya çıkarıldı —
// iki yerde ayrı ayrı tanımlanırsa (önceki hâlde olduğu gibi) rotalar
// birbirinden sessizce sapabiliyor.
//
// NOT: supplier paneli dashboard.html'deki orijinal tasarımla aynı şekilde
// TEK sayfa + sekmeler olarak (/supplier) taşındı — /supplier/catalog diye
// ayrı bir route YOK. Eskiden middleware'de yanlışlıkla '/supplier/catalog'
// yazıyordu; bu, /admin gibi yetkisiz bir rotaya giren bir tedarikçiyi 404'e
// düşürüyordu.
export const ROLE_HOME: Record<string, string> = {
  customer: '/',
  dealer: '/dealer/live',
  supplier: '/supplier',
  admin: '/admin',
  logistics: '/logistics/dashboard',
};

export function roleHome(role: string | null | undefined): string {
  return ROLE_HOME[role ?? ''] ?? '/';
}
