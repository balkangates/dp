// lib/supabase/server.ts
// Server Component'lerde, Server Action'larda ve Route Handler'larda
// kullanılacak Supabase istemcisi — kullanıcının oturum çerezini okur.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component içinden çağrılırsa (middleware dışı) cookie
            // set edilemez — middleware zaten oturumu tazeliyor, sorun değil.
          }
        },
      },
    },
  );
}
