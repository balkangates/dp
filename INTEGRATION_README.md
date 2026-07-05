# Dampingvar — Trade Signals Full Integration

## Yeni Dosyalar

```
src/
├── payment/
│   ├── usdtPaymentService.ts   ← Cüzdan üretimi, TX doğrulama, abonelik aktivasyonu
│   ├── usePayment.ts           ← React hook — tam ödeme lifecycle'ı
│   └── index.ts                ← Barrel export
├── components/
│   ├── TradeSignals.tsx        ← Tam entegre sinyal sayfası + widget  [GÜNCELLENDİ]
│   └── UpgradeModal.tsx        ← 4-adım USDT ödeme akışı             [GÜNCELLENDİ]
supabase_migration_v1_tables.sql   ← Supabase'de çalıştır (önce)
supabase_migration_v2_payments.sql ← Supabase'de çalıştır (sonra)
```

## Supabase Kurulumu

Supabase Dashboard → SQL Editor'de sırasıyla çalıştır:
1. `supabase_migration_v1_tables.sql`
2. `supabase_migration_v2_payments.sql`

## Ödeme Akışı

```
Kullanıcı → Plan Seç (PRO/VIP)
         → createPaymentIntent()  → trade_payments satırı oluşturulur
         → Cüzdan adresi + memo gösterilir (generateWallet)
         → Kullanıcı USDT gönderir + TX hash yapıştırır
         → verifyPayment(txHash)  → TX formatı doğrulanır (mock/gerçek)
         → activateSubscription() → trade_subscriptions upsert
         → useSubscription() refresh → plan anında güncellenir
         → SignalGate kilidini açar → gerçek zamanlı sinyaller görünür
```

## Production'a Geçiş

`src/payment/usdtPaymentService.ts` içinde `_verifyOnChain()` fonksiyonundaki
mock kısmı kaldırın, yoruma alınmış TRON API bloğunu etkinleştirin:

```bash
VITE_TRONGRID_API_KEY=your_key_here
```

`PLATFORM_WALLET` sabitini gerçek TRC-20 cüzdan adresinizle güncelleyin.

## Engine Mimarisi

```
BinanceService (5s polling)
    ↓ tick events
SignalEngine
    ↓ PhaseEngine.calculatePhase()
    ↓ phase (1-5) → signal (BUY/SELL/HOLD)
    ↓ emit('signal')
TradeSignals component
    ↓ checkSubscription() → AccessDecision
    ↓ SignalGate (blur/countdown/upgrade CTA)
    ↓ PerformanceEngine.recordSignal() → success_rate
```

## Subscription Gating

| Plan | Gecikme   | Sembol | Analitik | Geçmiş |
|------|-----------|--------|----------|--------|
| FREE | 15 dk     | 1      | ✗        | ✗      |
| PRO  | Gerçek zamanlı | Tümü | ✗   | ✓      |
| VIP  | Gerçek zamanlı | Tümü | ✓   | ✓      |
