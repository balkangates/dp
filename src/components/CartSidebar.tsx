import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CartItem, formatPrice } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { createOrder } from '../lib/supabase';

interface CartSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdateQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  onOrderComplete?: () => void;
}

type OrderState = 'idle' | 'loading' | 'success' | 'error' | 'login_required';

export default function CartSidebar({ isOpen, onClose, items, onUpdateQty, onRemove, onOrderComplete }: CartSidebarProps) {
  const { user } = useAuth();
  const [orderState, setOrderState] = useState<OrderState>('idle');
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const subtotal = items.reduce((sum, item) => sum + item.product.dampingPrice * item.quantity, 0);
  const tax = Math.round(subtotal * 0.2);
  const total = subtotal + tax;
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  const handleCheckout = async () => {
    if (!user) {
      setOrderState('login_required');
      return;
    }
    if (items.length === 0) return;
    setOrderState('loading');
    setErrorMsg(null);

    try {
      // Sepet kalemlerini CartItemPayload formatına çevir
      const payload = items.map(item => ({
        productId: item.product.id,
        sellerId: (item.product as { sellerId?: string }).sellerId ?? '',
        quantity: item.quantity,
        unitPrice: item.product.dampingPrice,
        taxRate: 20,
      }));

      const { data: order, error } = await createOrder(user.id, payload, total);

      if (error || !order) {
        setErrorMsg(error?.message ?? 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.');
        setOrderState('error');
      } else {
        setOrderNumber(order.order_number ?? order.id);
        setOrderState('success');
        onOrderComplete?.();
      }
    } catch (e) {
      setErrorMsg('Beklenmeyen bir hata oluştu.');
      setOrderState('error');
    }
  };

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000]"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.div
        className="fixed top-0 right-0 w-[380px] max-w-[90vw] h-full z-[1001] flex flex-col"
        style={{ background: '#111827', borderLeft: '2px solid #D4AF37', boxShadow: '-10px 0 30px rgba(0,0,0,0.5)' }}
        initial={{ x: '100%' }}
        animate={{ x: isOpen ? 0 : '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#2A3650] flex justify-between items-center" style={{ background: '#090d16' }}>
          <div className="flex items-center gap-2">
            <i className="fas fa-shopping-bag text-[#D4AF37]"></i>
            <span className="font-mono font-extrabold text-xs text-[#D4AF37]">MÜŞTERİ SEPETİ</span>
            <span className="bg-[#D4AF37] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono">{itemCount}</span>
          </div>
          <button onClick={onClose} className="text-[#5E7090] hover:text-white cursor-pointer transition-colors p-1">
            <i className="fas fa-times text-lg"></i>
          </button>
        </div>

        {/* Sipariş başarılı ekranı */}
        <AnimatePresence>
          {orderState === 'success' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 bg-[#111827] flex flex-col items-center justify-center z-10 p-8 text-center"
            >
              <div className="text-5xl mb-4">✅</div>
              <h3 className="text-white font-black text-lg mb-2">Sipariş Alındı!</h3>
              <p className="text-[#10B981] font-mono font-bold mb-1">{orderNumber}</p>
              <p className="text-[#5E7090] text-xs font-mono mb-6">
                Ödeme bilgileri hesabınıza gönderildi.<br />
                Escrow koruması aktif — paranız güvende.
              </p>
              <div className="w-full bg-[#090d16] border border-[#2A3650] rounded-xl p-4 text-left space-y-2 font-mono text-xs mb-6">
                <div className="flex justify-between text-[#5E7090]"><span>Toplam</span><span className="text-white">{formatPrice(total)}</span></div>
                <div className="flex justify-between text-[#5E7090]"><span>Ödeme</span><span className="text-[#F59E0B]">Banka Havalesi</span></div>
                <div className="flex justify-between text-[#5E7090]"><span>Escrow</span><span className="text-[#10B981]">Aktif ✓</span></div>
                <div className="flex justify-between text-[#5E7090]"><span>Oto-onay</span><span className="text-white">7 gün</span></div>
              </div>
              <button
                onClick={() => { setOrderState('idle'); onClose(); }}
                className="w-full py-3 rounded-xl font-black text-sm cursor-pointer"
                style={{ background: 'linear-gradient(135deg, #D4AF37, #8B6914)', color: '#000' }}
              >
                Dashboard'a Git →
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
          <AnimatePresence>
            {items.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full text-[#5E7090]">
                <i className="fas fa-shopping-bag text-4xl mb-3 opacity-30"></i>
                <p className="font-mono text-sm">Sepetiniz boş</p>
                <p className="text-[11px] mt-1">Ürün ekleyerek başlayın</p>
              </motion.div>
            )}
            {items.map(item => (
              <motion.div
                key={item.product.id}
                layout
                initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 50, opacity: 0 }}
                className="flex gap-3 p-3 rounded-xl border border-[#2A3650]"
                style={{ background: '#0F1729' }}
              >
                <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0">
                  <img src={item.product.image} alt={item.product.title} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-xs truncate">{item.product.title}</p>
                  <p className="text-[#10B981] font-mono font-bold text-sm mt-0.5">{formatPrice(item.product.dampingPrice)}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => onUpdateQty(item.product.id, item.quantity - 1)} className="w-6 h-6 rounded bg-[#2A3650] text-white text-xs flex items-center justify-center cursor-pointer hover:bg-[#D4AF37] hover:text-black transition-colors">-</button>
                    <span className="font-mono font-bold text-white text-xs w-6 text-center">{item.quantity}</span>
                    <button onClick={() => onUpdateQty(item.product.id, item.quantity + 1)} className="w-6 h-6 rounded bg-[#2A3650] text-white text-xs flex items-center justify-center cursor-pointer hover:bg-[#D4AF37] hover:text-black transition-colors">+</button>
                    <button onClick={() => onRemove(item.product.id)} className="ml-auto text-[#5E7090] hover:text-red-400 cursor-pointer transition-colors text-xs">
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#2A3650] font-mono text-xs space-y-2" style={{ background: 'rgba(9,13,22,0.95)' }}>
          <div className="flex justify-between"><span className="text-[#5E7090]">Ara Toplam</span><span className="text-white font-bold">{formatPrice(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-[#5E7090]">KDV (%20)</span><span className="text-white font-bold">{formatPrice(tax)}</span></div>
          <div className="flex justify-between">
            <span className="text-[#5E7090] text-[10px]">Platform Kom. (%10)</span>
            <span className="text-[#5E7090] font-bold">{formatPrice(Math.round(total * 0.1))}</span>
          </div>
          <div className="flex justify-between text-sm font-extrabold text-white border-t border-[#2A3650] pt-2 mt-1">
            <span>GENEL TOPLAM</span>
            <span className="text-[#D4AF37]">{formatPrice(total)}</span>
          </div>

          {/* Hata mesajı */}
          {orderState === 'error' && errorMsg && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-[10px]">
              {errorMsg}
            </div>
          )}

          {/* Giriş gerekli uyarısı */}
          {orderState === 'login_required' && (
            <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-lg px-3 py-2 text-[#D4AF37] text-[10px]">
              <i className="fas fa-lock mr-1"></i>Sipariş vermek için giriş yapmanız gerekiyor.
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={items.length === 0 || orderState === 'loading' || orderState === 'success'}
            className="w-full py-3 rounded-xl font-black text-sm cursor-pointer transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            style={{ background: 'linear-gradient(135deg, #10B981, #14B8A6)', color: '#000' }}
          >
            {orderState === 'loading' ? (
              <><i className="fas fa-spinner fa-spin mr-2"></i>SİPARİŞ OLUŞTURULUYOR...</>
            ) : (
              <><i className="fas fa-lock mr-2"></i>SİPARİŞİ TAMAMLA (B2B)</>
            )}
          </button>
          <p className="text-[#5E7090] text-[9px] text-center mt-1">
            <i className="fas fa-shield-alt mr-1"></i>
            Güvenli ödeme · Escrow koruması · {7} gün oto-onay
          </p>
        </div>
      </motion.div>
    </>
  );
}
