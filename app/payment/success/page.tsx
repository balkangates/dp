import Link from 'next/link';

export default function PaymentSuccessPage() {
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
      <div className="text-5xl">✅</div>
      <h1 className="text-white font-black text-xl">Ödemeniz Alındı</h1>
      <p className="text-[#5E7090] text-sm font-mono">
        Siparişiniz onaylandı, escrow hesabına alındı. Bayi sipariş durumunu güncelledikçe
        &quot;Siparişlerim&quot; bölümünden takip edebilirsiniz.
      </p>
      <Link href="/" className="inline-block text-[#D4AF37] text-sm font-bold mt-4">
        Ana sayfaya dön
      </Link>
    </main>
  );
}
