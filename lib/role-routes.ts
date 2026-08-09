// lib/role-routes.ts — her rolün kendi paneline nereden gireceğinin TEK
// kaynağı. middleware.ts, login sayfası ve header'daki "Panele Git" linki
// hepsi buradan okuyor — böylece biri güncellenip diğeri unutulmuyor.
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
