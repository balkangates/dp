// app/api/payments/iyzico/callback/route.ts
// iyzico, ödeme sonucundan sonra kullanıcıyı bu URL'e (form POST, "token"
// alanıyla) yönlendirir. Burada token'ı iyzico'ya GERİ SORUP (retrieve)
// gerçek ödeme durumunu doğruluyoruz — client'tan gelen hiçbir bilgiye
// güvenilmiyor, sadece iyzico'nun sunucudan sunucuya cevabına.
import { NextResponse } from 'next/server';
import { retrieveCheckoutForm } from '@/lib/iyzico';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const formData = await request.formData();
  const token = formData.get('token') as string | null;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';

  if (!token) {
    return NextResponse.redirect(`${siteUrl}/payment/failed?reason=no_token`);
  }

  try {
    const result = await retrieveCheckoutForm(token);
    const orderId = result.conversationId; // initialize sırasında order.id olarak set edilmişti

    const admin = createAdminClient();

    if (result.status === 'success' && result.paymentStatus === 'SUCCESS') {
      const { error } = await admin.rpc('confirm_online_payment', {
        p_order_id: orderId,
        p_provider: 'iyzico',
        p_provider_ref: result.paymentId,
        p_provider_status: result.paymentStatus,
      });
      if (error) {
        console.error('[iyzico callback] confirm_online_payment hatası:', error);
        return NextResponse.redirect(`${siteUrl}/payment/failed?reason=confirm_error&order=${orderId}`);
      }
      return NextResponse.redirect(`${siteUrl}/payment/success?order=${orderId}`);
    }

    // Ödeme başarısız/iptal — siparişi PAYMENT_PENDING bırakıyoruz,
    // müşteri tekrar deneyebilir (cash/card_pos'a da geçebilir).
    await admin
      .from('store_orders')
      .update({ payment_provider: 'iyzico', payment_provider_status: result.paymentStatus || result.errorMessage })
      .eq('id', orderId);

    return NextResponse.redirect(`${siteUrl}/payment/failed?reason=declined&order=${orderId}`);
  } catch (e) {
    console.error('[iyzico callback]', e);
    return NextResponse.redirect(`${siteUrl}/payment/failed?reason=exception`);
  }
}

// iyzico bazı akışlarda GET ile de dönebiliyor — güvenlik için sadece
// bilgilendirici bir sayfa göster, POST'u zorunlu kılan asıl mantık yukarıda.
export async function GET() {
  return NextResponse.json({ ok: true, message: 'iyzico callback endpoint — POST bekleniyor.' });
}
