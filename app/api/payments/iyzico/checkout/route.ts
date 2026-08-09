// app/api/payments/iyzico/checkout/route.ts
// Müşteri "Online Kredi Kartı ile Öde" deyip siparişi oluşturduktan SONRA
// bu route çağrılır: iyzico Checkout Form başlatılır, dönen paymentPageUrl'e
// yönlendirilir. Kart bilgisi hiçbir zaman bizim sunucumuza gelmez.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { initializeCheckoutForm } from '@/lib/iyzico';

export async function POST(request: Request) {
  const { orderId } = await request.json();
  if (!orderId) return NextResponse.json({ error: 'orderId gerekli' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Giriş yapmalısınız' }, { status: 401 });

  // RLS zaten sadece siparişi veren müşteriye (ya da mağaza sahibi/admin'e)
  // okuma izni veriyor — bu satır yanlışlıkla başkasının siparişine
  // erişimi otomatik engeller.
  const { data: order, error: orderErr } = await supabase
    .from('store_orders')
    .select('id, total_amount, customer_id, delivery_address, store_order_items(product_name, total_price)')
    .eq('id', orderId)
    .eq('customer_id', user.id)
    .single();
  if (orderErr || !order) return NextResponse.json({ error: 'Sipariş bulunamadı' }, { status: 404 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, phone')
    .eq('id', user.id)
    .single();

  const [name, ...rest] = (profile?.full_name || 'Müşteri Bilinmiyor').split(' ');
  const surname = rest.join(' ') || 'Müşteri';
  const price = Number(order.total_amount).toFixed(2);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '85.34.78.112';

  try {
    const result = await initializeCheckoutForm({
      conversationId: order.id, // callback'te siparişi bulmak için — bkz. callback/route.ts
      price,
      paidPrice: price,
      basketId: order.id,
      callbackUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/api/payments/iyzico/callback`,
      buyer: {
        id: user.id,
        name: name || 'Müşteri',
        surname,
        email: profile?.email || user.email || 'musteri@dampingvar.com.tr',
        identityNumber: '11111111111', // TC kimlik alanı zorunlu değilse gerçek değerle değiştirin
        address: order.delivery_address,
        city: 'Istanbul',
        country: 'Turkey',
        ip,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: (order.store_order_items as any[]).map((i, idx) => ({
        id: `item-${idx}`,
        name: i.product_name,
        category1: 'Hırdavat',
        price: Number(i.total_price).toFixed(2),
      })),
    });

    if (result.status !== 'success') {
      return NextResponse.json({ error: result.errorMessage || 'iyzico başlatılamadı' }, { status: 502 });
    }

    return NextResponse.json({ paymentPageUrl: result.paymentPageUrl, token: result.token });
  } catch (e) {
    console.error('[iyzico checkout]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
