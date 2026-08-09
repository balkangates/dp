'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { placeOrder, type CartLine } from '@/lib/dampingvar';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

export default function CartAndCheckout({
  storeId,
  cart,
  setCart,
  onOrdered,
  onClose,
}: {
  storeId: string;
  cart: CartLine[];
  setCart: (c: CartLine[]) => void;
  onOrdered: () => void;
  // Video üzerine açılan overlay panel olarak kullanıldığında (bkz.
  // StoreShopOverlay) bir kapatma (X) butonu göstermek için — sidebar
  // kullanımında (verilmezse) gösterilmez.
  onClose?: () => void;
}) {
  const { user, profile } = useAuth();
  const [address, setAddress] = useState('');
  const [addressTouched, setAddressTouched] = useState(false);
  // Ödeme yöntemleri sadeleştirildi: Havale (bank_transfer) ve Online Kart.
  // Nakit/Kapıda POS kaldırıldı — bkz. fixes/fix_payment_method_bank_transfer.sql
  // (bank_transfer, store_orders.payment_method CHECK kısıtlamasına eklendi).
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'online_card'>('bank_transfer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Profildeki kayıtlı adres otomatik doldurulur (kullanıcı kendisi
  // değiştirmediyse) — sevkiyat adresini elle yazmak zorunda kalmasın diye.
  useEffect(() => {
    if (!addressTouched && profile?.address) setAddress(profile.address);
  }, [profile?.address, addressTouched]);

  const total = cart.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const updateQty = (storeProductId: string, delta: number) => {
    setCart(
      cart
        .map((i) => (i.store_product_id === storeProductId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    );
  };

  const removeLine = (storeProductId: string) => {
    setCart(cart.filter((i) => i.store_product_id !== storeProductId));
  };

  const checkout = async () => {
    if (!user) {
      setError('Sipariş vermek için giriş yapmalısınız.');
      return;
    }
    if (!address) {
      setError('Teslimat adresi gerekli.');
      return;
    }
    if (cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const order = await placeOrder({
        storeId,
        customerId: user.id,
        items: cart,
        paymentMethod,
        deliveryAddress: address,
        placedFromLive: true,
      });

      if (paymentMethod === 'online_card') {
        // Sipariş PAYMENT_PENDING olarak oluştu — şimdi iyzico'nun ödeme
        // sayfasına yönlendiriyoruz. Onay, webhook (callback route) ile
        // GERİ DÖNÜLDÜĞÜNDE gerçekleşir (bkz. confirm_online_payment RPC),
        // bu yüzden burada sepeti/başarı mesajını GÖSTERMİYORUZ.
        const resp = await fetch('/api/payments/iyzico/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.id }),
        });
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload.error || 'Ödeme başlatılamadı');
        window.location.href = payload.paymentPageUrl;
        return;
      }

      setCart([]);
      onOrdered();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl p-4 space-y-3" style={CARD}>
      <div className="flex items-center justify-between">
        <p className="text-white font-extrabold text-sm">Sepetim ({cart.length})</p>
        {onClose && (
          <button onClick={onClose} className="text-[#5E7090] hover:text-white">
            <i className="fas fa-xmark" />
          </button>
        )}
      </div>
      {cart.length === 0 ? (
        <p className="text-[#5E7090] text-xs font-mono">Sepet boş.</p>
      ) : (
        <>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {cart.map((i) => (
              <div key={i.store_product_id} className="flex items-center gap-2 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="text-[#A3B3D1] truncate">{i.product_name}</p>
                  <p className="text-[#5E7090] font-mono text-[10px]">₺{i.unit_price.toFixed(2)} / adet</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => updateQty(i.store_product_id, -1)}
                    className="w-6 h-6 rounded flex items-center justify-center text-[10px]"
                    style={{ border: '1px solid #2A3650', color: '#A3B3D1' }}
                  >
                    <i className="fas fa-minus" />
                  </button>
                  <span className="text-white font-mono w-5 text-center">{i.quantity}</span>
                  <button
                    onClick={() => updateQty(i.store_product_id, 1)}
                    className="w-6 h-6 rounded flex items-center justify-center text-[10px]"
                    style={{ border: '1px solid #2A3650', color: '#A3B3D1' }}
                  >
                    <i className="fas fa-plus" />
                  </button>
                </div>
                <span className="text-white font-mono w-16 text-right shrink-0">₺{(i.unit_price * i.quantity).toFixed(2)}</span>
                <button
                  onClick={() => removeLine(i.store_product_id)}
                  className="w-6 h-6 rounded flex items-center justify-center text-[10px] shrink-0"
                  style={{ color: '#EF4444' }}
                  title="Ürünü sepetten çıkar"
                >
                  <i className="fas fa-trash" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-[#2A3650] pt-2">
            <span className="text-[#5E7090] text-xs font-mono">Toplam (KDV dahil)</span>
            <span className="text-[#D4AF37] font-mono font-extrabold">₺{total.toFixed(2)}</span>
          </div>
          <input
            placeholder="Teslimat adresi"
            value={address}
            onChange={(e) => { setAddress(e.target.value); setAddressTouched(true); }}
            className="w-full bg-black/30 border border-[#2A3650] rounded-lg px-3 py-2 text-sm text-white"
          />
          {!addressTouched && profile?.address && (
            <p className="text-[9px] text-[#5E7090] font-mono -mt-1.5">Profil adresiniz otomatik dolduruldu, gerekirse düzenleyin.</p>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { key: 'bank_transfer', label: '🏦 Havale' },
              { key: 'online_card', label: '🔒 Online Kart' },
            ] as const).map((m) => (
              <button
                key={m.key}
                onClick={() => setPaymentMethod(m.key)}
                className="rounded-lg py-2 text-[11px] font-bold"
                style={{
                  background: paymentMethod === m.key ? '#D4AF3720' : 'transparent',
                  border: `1px solid ${paymentMethod === m.key ? '#D4AF37' : '#2A3650'}`,
                  color: paymentMethod === m.key ? '#D4AF37' : '#5E7090',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          {paymentMethod === 'online_card' ? (
            <p className="text-[10px] text-[#5E7090] font-mono">
              iyzico&apos;nun güvenli ödeme sayfasına yönlendirileceksiniz. Kart bilgileriniz bize ulaşmaz.
            </p>
          ) : (
            <p className="text-[10px] text-[#5E7090] font-mono">
              Sipariş onaylandıktan sonra banka hesap bilgileri canlı sohbet üzerinden bayi tarafından paylaşılacaktır.
            </p>
          )}
          {error && <p className="text-red-400 text-[11px] font-mono">{error}</p>}
          <button
            onClick={checkout}
            disabled={busy}
            className="w-full rounded-lg py-2.5 text-xs font-extrabold"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)', color: '#000', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? '…' : paymentMethod === 'online_card' ? 'Ödemeye Geç' : 'Siparişi Tamamla'}
          </button>
        </>
      )}
    </div>
  );
}
