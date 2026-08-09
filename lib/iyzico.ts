// lib/iyzico.ts — SADECE sunucu tarafında kullanılır (API route'lar).
// iyzico Checkout Form: müşteri iyzico'nun kendi (PCI-DSS uyumlu) ödeme
// sayfasına yönlendirilir, kart bilgisi hiçbir zaman bizim sunucumuza/
// veritabanımıza dokunmaz — bu yüzden bu entegrasyon şekli tercih edildi.
//
// Gerekli env değişkenleri (.env.local / Vercel):
//   IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL
//   (sandbox: https://sandbox-api.iyzipay.com, prod: https://api.iyzipay.com)
//
// iyzico hesabı + API anahtarları: https://merchant.iyzipay.com (sandbox
// için https://sandbox-merchant.iyzipay.com üzerinden ayrı test hesabı).
import Iyzipay from 'iyzipay';

function getClient() {
  return new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY!,
    secretKey: process.env.IYZICO_SECRET_KEY!,
    uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com',
  });
}

export interface CheckoutFormItem {
  id: string;
  name: string;
  category1: string;
  price: string; // "10.00" formatında string — iyzico bunu bekliyor
}

export interface CheckoutFormBuyer {
  id: string;
  name: string;
  surname: string;
  email: string;
  identityNumber: string; // TC kimlik no yoksa '11111111111' (iyzico sandbox kuralı)
  address: string;
  city: string;
  country: string;
  ip: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function initializeCheckoutForm(params: {
  conversationId: string;
  price: string;
  paidPrice: string;
  basketId: string;
  callbackUrl: string;
  buyer: CheckoutFormBuyer;
  items: CheckoutFormItem[];
}): Promise<any> {
  const iyzipay = getClient();
  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId: params.conversationId,
    price: params.price,
    paidPrice: params.paidPrice,
    currency: Iyzipay.CURRENCY.TRY,
    basketId: params.basketId,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl: params.callbackUrl,
    buyer: params.buyer,
    shippingAddress: {
      contactName: `${params.buyer.name} ${params.buyer.surname}`,
      city: params.buyer.city,
      country: params.buyer.country,
      address: params.buyer.address,
    },
    billingAddress: {
      contactName: `${params.buyer.name} ${params.buyer.surname}`,
      city: params.buyer.city,
      country: params.buyer.country,
      address: params.buyer.address,
    },
    basketItems: params.items.map((i) => ({
      id: i.id,
      name: i.name,
      category1: i.category1,
      itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
      price: i.price,
    })),
  };

  return new Promise((resolve, reject) => {
    // @types/iyzipay bu çağrı için yanlış bir request tipi (3DS ödeme tipiyle
    // karışmış) tanımlıyor — gerçek iyzico REST API'si Checkout Form için
    // aşağıdaki alanları bekliyor, bu yüzden burada bilinçli olarak `any`
    // kullanılıyor (community types paketinin bir hatası, kodun kendisi doğru).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    iyzipay.checkoutFormInitialize.create(request as any, (err: unknown, result: unknown) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// conversationId parametresi iyzico'nun isteğinde opsiyonel (sadece
// loglama amaçlı yankılanıyor) — asıl önemli olan, DÖNEN result.conversationId
// (bunu initialize sırasında order.id olarak ayarlıyoruz, callback'te
// hangi siparişe ait olduğunu buradan buluyoruz).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function retrieveCheckoutForm(token: string): Promise<any> {
  const iyzipay = getClient();
  return new Promise((resolve, reject) => {
    iyzipay.checkoutForm.retrieve(
      { locale: Iyzipay.LOCALE.TR, conversationId: '', token },
      (err: unknown, result: unknown) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
}
