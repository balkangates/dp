// lib/supabase/admin.ts
// SADECE sunucu tarafında (API route/webhook) kullanılır — SERVICE_ROLE_KEY
// tüm RLS'i bypass eder, asla client'a/tarayıcıya sızdırılmamalı. Bu dosya
// 'use client' İÇERMEZ ve sadece Node.js route handler'lardan import edilir.
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
