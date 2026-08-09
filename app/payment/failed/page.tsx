'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function FailedContent() {
  const params = useSearchParams();
  const reason = params.get('reason');
  const messages: Record<string, string> = {
    declined: 'Kartınız reddedildi ya da ödeme tamamlanmadı.',
    no_token: 'Ödeme oturumu geçersiz.',
    confirm_error: 'Ödeme alındı ama sipariş onaylanamadı — lütfen destek ile iletişime geçin.',
    exception: 'Beklenmeyen bir hata oluştu.',
  };
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
      <div className="text-5xl">⚠️</div>
      <h1 className="text-white font-black text-xl">Ödeme Tamamlanamadı</h1>
      <p className="text-[#5E7090] text-sm font-mono">
        {messages[reason ?? ''] ?? 'Ödeme başarısız oldu.'}
      </p>
      <Link href="/" className="inline-block text-[#D4AF37] text-sm font-bold mt-4">
        Ana sayfaya dön ve tekrar dene
      </Link>
    </main>
  );
}

export default function PaymentFailedPage() {
  return (
    <Suspense fallback={null}>
      <FailedContent />
    </Suspense>
  );
}
