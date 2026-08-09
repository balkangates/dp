# DampingVar — Next.js (Faz 1)

Bu, `dp-main` (Vite SPA + `dashboard.html` vanilla-JS panelleri) sisteminin
Next.js App Router'a taşınmasının **Faz 1** çıktısıdır. Detaylı plan için
`DampingVar-Sistem-Plani-NextJS.md` dosyasına bakın.

## Kurulum

```bash
npm install
cp .env.local.example .env.local   # gerekirse değerleri güncelleyin
npm run dev
```

## Bu pakette TAMAMLANMIŞ olanlar

- **Proje iskeleti**: Next.js 15 App Router, Tailwind 4, TypeScript.
- **Supabase SSR entegrasyonu**: `lib/supabase/client.ts` (tarayıcı),
  `lib/supabase/server.ts` (Server Component/Action), `middleware.ts`
  (rol bazlı route koruması — artık **sunucu tarafında**, eski sistemde
  sadece client-side'daydı).
- **Auth**: `/login`, `/register` (Supabase Auth, email+şifre).
- **Müşteri mağaza deneyimi** (`/` → mağaza seç → `/store/[storeId]`):
  canlı yayın izleme (LiveKit), mağaza bazlı sohbet, sektör/kategori
  filtreli ürün kartları, sepete ekleyince ürün videosu spot ışığı,
  sepet/checkout, siparişlerim (escrow/fatura/irsaliye rozetleriyle).
  Bunlar Vite uygulamasındaki `CustomerHome.tsx` ve ilişkili
  bileşenlerin birebir (mantık olarak) taşınmış hâli.
- **Bayi paneli** (`/dealer/live`, `/dealer/catalog`, `/dealer/orders`):
  canlıya geçme (LiveKit yayıncı bağlantısı dahil), sipariş durumu
  ilerletme/iptal (escrow/fatura/irsaliye rozetleriyle), ürün seçimi
  (onaylı katalogdan), stok girişi, YouTube tanıtım linki ekleme.
  Bunlar `modules/live-sales.js` ve `modules/dealer-catalog.js`'in
  (vanilla JS → React) yeniden yazılmış hâli.
- **FAZ 2 — Gerçek kredi kartı tahsilatı (iyzico)**: `/api/payments/iyzico/checkout`
  (Checkout Form başlatma), `/api/payments/iyzico/callback` (sunucudan
  sunucuya doğrulanan ödeme onayı → `confirm_online_payment` RPC),
  `/payment/success`, `/payment/failed`. Sepette üçüncü ödeme seçeneği
  olarak "🔒 Online Kart" eklendi. Kart bilgisi hiçbir zaman platform
  sunucusuna dokunmuyor (iyzico'nun kendi PCI-DSS uyumlu sayfası).
- **FAZ 2 — Satır bazlı KDV/indirim**: `store_order_items`'a
  `discount_pct`, `tax_rate`, `net_price`, `tax_amount` eklendi;
  `placeOrder()` artık her satır için bunları hesaplayıp kaydediyor;
  finans motoru (escrow/komisyon) artık **KDV HARİÇ net tutar**
  üzerinden hesaplıyor (önceki sürüm yanlışlıkla KDV dahil tutar
  üzerinden komisyon alıyordu).

- **FAZ 3 — Birebir görüntülü görüşme + pazarlık**: Müşteri mağaza
  sayfasında "Görüntülü Görüş" isteği atıyor (`call_requests`), bayi
  `/dealer/live`'da anlık bildirim alıp kabul/reddediyor, kabul edilince
  her iki taraf da `VideoCallModal` ile ayrı, birebir bir LiveKit odasına
  (`call-<call_request_id>`) bağlanıyor — genel canlı yayından tamamen
  izole, ikisi de karşılıklı görüntü/ses paylaşıyor. Ayrıca müşteri ürün
  bazlı fiyat teklifi verebiliyor (`negotiation_offers`), bayi
  kabul/red/karşı teklif verebiliyor, müşteri karşı teklifi kabul ederse
  o fiyat kendi teklifine yazılıyor.

- **FAZ 4 — Kargo/teslimat takibi**: Bayi siparişi "Kargoda"ya ilerletirken
  artık taşıyıcı + takip numarası giriyor (`mark_order_shipped` RPC —
  hem `store_orders.status`'u hem `store_order_shipments`'ı tek atomik
  işlemde günceller). `/logistics/dashboard` artık gerçek bir panel:
  teslim edilmemiş tüm sevkiyatları listeliyor, "Teslim Edildi" butonu
  otomatik olarak siparişi `DELIVERED`'a taşıyor (bu da escrow'u serbest
  bırakan mevcut motoru tetikliyor). Müşteri "Siparişlerim"de takip
  numarasını görüyor.

## Bu pakette HENÜZ TAŞINMAMIŞ / YAPILMAMIŞ olanlar (dürüstçe işaretlendi)

- **FAZ 6 — Canlı satış yayıncı kontrolü (flash fiyat + öne çıkan ürün) +
  gerçek sosyal kanıt — TAMAMLANDI**: Backend
  (`fix_phase6_live_commerce_triggers.sql`) daha önce yazılmıştı ama
  hiçbir arayüze bağlanmamıştı — bu turda tamamlandı:
  - **Öne çıkan ürün (spotlight)**: `/dealer/live`'da her ürünün yanında
    "Öne Çıkar" butonu — bayi hangi ürünü anlatıyorsa tıklıyor,
    `stores.spotlight_product_id` güncelleniyor, müşteri tarafında
    (`StoreShopOverlay` → ürün şeridi) o ürün **gerçek zamanlı** öne
    kayıp altın çerçeveyle ("ŞU AN CANLI ANLATILIYOR") vurgulanıyor.
  - **Flash indirim**: Bayi bir ürüne süreli özel fiyat açabiliyor
    (fiyat + süre dakika) — müşteri tarafında üstü çizili eski fiyat +
    yeni fiyat + **canlı mm:ss geri sayım** gösteriliyor, süre dolunca
    otomatik normale dönüyor.
  - **Gerçek sosyal kanıt**: "X kişi bu ürünü aldı" rozeti artık
    `v_store_product_purchase_counts` view'ından — **gerçek** onaylanmış
    sipariş verisinden geliyor, uydurma/sahte sayı DEĞİL.
- **Canlı sohbet çapraz görünürlük** (`fix_live_chat_cross_visibility.sql`):
  "müşteri mesaj yazınca hem kendi hem bayi panosuna anlık düşmeli"
  sorusu araştırıldı. En olası sebep bulundu: `messages` tablosunun RLS
  SELECT politikası muhtemelen 1:1 özel mesajlaşma için tasarlanmış
  (`sender_id=auth.uid() OR receiver_id=auth.uid()`). Canlı sohbet
  mesajlarında `receiver_id` HER ZAMAN NULL (yayın, tek alıcı yok) —
  yani bu politikayla mesajı YALNIZCA GÖNDEREN görebiliyor, KARŞI TARAF
  hiçbir zaman göremiyor (ne sayfa yenilemede ne realtime'da). Bu
  dosya, mevcut politikaya dokunmadan (silmeden), canlı sohbet
  mesajları için EK bir okuma izni ekliyor. **Not:** Veritabanına
  doğrudan bağlanamadığım için bu teşhisi koddaki izlerden ve şemadan
  çıkardım — dosyanın içindeki teşhis sorgusunu SQL Editor'de çalıştırıp
  mevcut politikaları görerek kesin doğrulamanız iyi olur.

- `/supplier`, `/admin` — şu an sadece "bu sayfa henüz taşınmadı" bilgi
  kartı gösteriyor. Gerçek işlevsellik hâlâ `dashboard.html` →
  `modules/supplier.js` / `modules/catalog-admin.js` üzerinden çalışıyor
  durumda — BUNLARI SİLMEDİM, sistem çalışmaya devam ediyor, sadece
  Next.js'e henüz kopyalanmadı.
- **Kargo firması OTOMATİK API entegrasyonu YOK ve bilinçli olarak
  eklenmedi** — Yurtiçi/Aras/MNG kargo firmalarının hiçbiri herkese açık
  bir sandbox/test API'si sunmuyor, kurumsal bayilik sözleşmesi + özel
  kullanıcı adı/şifre gerektiriyor (pazarlama temsilcinizden alınıyor).
  Gerçek bir hesabınız olmadan bu entegrasyonu yazıp "çalışıyor" demek
  test edilemeyen, muhtemelen hatalı kod anlamına gelirdi. Bunun yerine
  **hemen çalışan manuel takip modeli** kuruldu (yukarıya bakın). Gerçek
  bir kargo firması hesabınız olduğunda: `app/api/webhooks/shipping/route.ts`
  (yeni bir route) oluşturup firmanın webhook'unu `update_shipment_status`
  RPC'sine bağlamanız yeterli — `lib/logistics.ts`'te bu RPC zaten hazır
  (`service_role` yetkili).
- iyzico entegrasyonu **test edilmedi** (gerçek API anahtarı yok).
- Kabul edilen pazarlık teklifinin otomatik sepete yansıması henüz yok.

## Faz 6 kurulum adımları

1. `fixes/fix_phase6_live_commerce_triggers.sql`'i çalıştırın (henüz
   çalıştırmadıysanız — flash fiyat/spotlight kolonlarını ve
   `v_store_product_purchase_counts` view'ını ekliyor).
2. `fixes/fix_live_chat_cross_visibility.sql`'i çalıştırın — canlı
   sohbetin karşı tarafa da anlık düşmesi için.
3. Test: bayi `/dealer/live`'da bir ürünü "Öne Çıkar"a bassın →
   müşteri tarafında (aynı anda açık bir sekmede) o ürünün öne
   kayıp altın çerçeveyle vurgulandığını doğrulayın. "Flash İndirim"
   ile bir ürüne 5 dakikalık kampanya açıp geri sayımın çalıştığını
   görün. Bir sipariş TAMAMLANDI durumuna geldikten sonra o ürünün
   kartında "X kişi aldı" rozetinin arttığını doğrulayın.
4. Sohbet testi: iki farklı tarayıcıda (biri müşteri, biri bayi) aynı
   mağazanın canlı sohbetini açın, her iki taraftan da mesaj yazıp
   KARŞI tarafın panosunda anlık göründüğünü doğrulayın.

## Faz 4 kurulum adımları

1. `fixes/fix_phase4_logistics.sql`'i Supabase SQL Editor'de çalıştır.
2. Bir kullanıcıyı `logistics` rolüne geçir (Supabase → Table Editor →
   `profiles` → ilgili satırın `role`'ünü `logistics` yap) — ya da admin
   olarak `/logistics/dashboard`'a erişebilirsin.
3. Test: bir siparişi dealer panelinde "Kargoda"ya ilerlet (taşıyıcı +
   takip no gir) → `/logistics/dashboard`'da görünmeli → "Teslim Edildi"
   de → sipariş otomatik `DELIVERED`'a geçmeli, escrow serbest kalmalı.

## Faz 3 kurulum adımları

1. `fixes/fix_phase3_video_call_and_negotiation.sql`'i Supabase SQL
   Editor'de çalıştır.
2. `supabase/functions/live-token/index.ts`'i **yeniden deploy et**
   (`supabase functions deploy live-token`) — 1:1 görüşme rolü eklendi,
   eski deploy edilmiş sürüm bunu bilmiyor.
3. Test: iki farklı tarayıcıda (biri müşteri, biri bayi hesabı) mağaza
   sayfasını ve `/dealer/live`'ı aç, müşteri "Görüntülü Görüş"e bas, bayi
   tarafında anlık bildirim çıkmalı, kabul edince ikisi de kameralarını
   görmeli.

## Faz 2 kurulum adımları

1. `fixes/fix_phase2_payments_and_tax.sql`'i Supabase SQL Editor'de
   çalıştır (bunun ÖNCESİNDE `fix_order_finance_engine.sql` çalıştırılmış
   olmalı).
2. [sandbox-merchant.iyzipay.com](https://sandbox-merchant.iyzipay.com)
   üzerinden bir TEST hesabı aç, API Key + Secret Key al.
3. Vercel → Settings → Environment Variables'a ekle:
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API →
   `service_role` — **asla** `NEXT_PUBLIC_` önekiyle eklemeyin),
   `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`,
   `IYZICO_BASE_URL=https://sandbox-api.iyzipay.com`,
   `NEXT_PUBLIC_SITE_URL` (gerçek domain'iniz).
4. Test kartlarıyla (iyzico dokümantasyonundaki sandbox test kartları)
   uçtan uca bir sipariş deneyin: sepete ekle → Online Kart → iyzico
   sayfasında test kartıyla öde → `/payment/success`'e dönmeli →
   dealer panelinde escrow "Bekliyor" olarak görünmeli.
5. Gerçek işlemler için `sandbox-` önekini kaldırıp gerçek
   `merchant.iyzipay.com` hesabınızın anahtarlarına geçin.

## Notlar

- `middleware.ts`'deki rol kontrolü `profiles.role` okuyor — Supabase
  projenizde bu tablo/kolon zaten var, değişiklik gerekmiyor.
- Eski Vite uygulamasındaki "eski sepet modülü" (ProductGrid/CartSidebar,
  `products`/`orders` tablolarına bağlı) BİLEREK taşınmadı — zaten devre
  dışı bırakılmıştı, tek doğru akış `store_products`/`store_orders`.
- LiveKit ve `live-token` Edge Function'ı ile ilgili hiçbir değişiklik
  yapılmadı — aynı Supabase projesi/secret'ları kullanılıyor.
