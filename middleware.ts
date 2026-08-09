// middleware.ts
// ─────────────────────────────────────────────────────────────────────────
// Eski sistemde rol kontrolü sadece client-side'da (App.tsx içinde
// `profile?.role === 'customer' ? ... : ...`) yapılıyordu — yani bir
// kullanıcı URL'yi bilse /dealer içeriğini (kısa süreliğine, veri
// gelene kadar) görebilirdi. Next.js middleware ile bu artık SUNUCU
// TARAFINDA, sayfa render edilmeden önce kontrol ediliyor.
// ─────────────────────────────────────────────────────────────────────────
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { roleHome } from '@/lib/roles';

const ROUTE_ROLE_PREFIX: Record<string, string[]> = {
  '/dealer': ['dealer', 'admin'],
  '/supplier': ['supplier', 'admin'],
  '/admin': ['admin'],
  '/logistics': ['logistics', 'admin'],
};

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const matchedPrefix = Object.keys(ROUTE_ROLE_PREFIX).find((p) => path.startsWith(p));

  if (matchedPrefix) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirectTo', path);
      return NextResponse.redirect(url);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const allowed = ROUTE_ROLE_PREFIX[matchedPrefix];
    if (!profile || !allowed.includes(profile.role)) {
      const url = request.nextUrl.clone();
      url.pathname = roleHome(profile?.role);
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Zaten giriş yapmış bir kullanıcı /login veya /register'a giderse
  // (ör. sekmede eski bir link, geri tuşu vb.) formu tekrar göstermek yerine
  // doğrudan kendi paneline yönlendir. login/page.tsx zaten başarılı
  // girişten sonra aynı yere gönderiyor — bu, "zaten oturum açık" durumunu
  // sunucu tarafında kapatıyor.
  if ((path === '/login' || path === '/register') && user) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    const url = request.nextUrl.clone();
    url.pathname = roleHome(profile?.role);
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/dealer/:path*',
    '/supplier/:path*',
    '/admin/:path*',
    '/logistics/:path*',
    '/login',
    '/register',
  ],
};
