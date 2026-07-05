/**
 * src/components/FranchisePanel.tsx — TASK 2.2 PATCH
 * ─────────────────────────────────────────────────────────────────────────────
 * Değişen tek şey:
 *   1. updateOrderStatus çağrısına user.id ekleniyor (3. parametre)
 *   2. OrderStatusHistory modal bileşeni ekleniyor
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Import EKLE ───────────────────────────────────────────────────────────────
// MEVCUT SATIR (dampingvar.ts'den import):
//   import { ..., updateOrderStatus, ... } from '../lib/dampingvar';
//
// DEĞİŞTİR → (updateOrderStatus imzası değişti, getOrderStatusHistory ekle):
//   import { ..., updateOrderStatus, getOrderStatusHistory, type OrderStatusEvent, ... } from '../lib/dampingvar';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getMyStore,
  createDemand,
  getStoreDemands,
  getStoreProducts,
  getStoreOrders,
  setStoreLive,
  updateOrderStatus,      // ← imzası değişti: (id, status, changedBy, note?)
  getOrderStatusHistory,  // ← YENİ
  subscribeToStoreOrders,
  type Store,
  type Demand,
  type StoreProduct,
  type OrderStatusEvent,  // ← YENİ tip
} from '../lib/dampingvar';

// ─────────────────────────────────────────────────────────────────────────────
// OrderHistory Modal Bileşeni (YENİ)
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  received:   { label: 'Alındı',         color: '#38BDF8', icon: '📥' },
  preparing:  { label: 'Hazırlanıyor',   color: '#F59E0B', icon: '👨‍🍳' },
  courier:    { label: 'Kuryede',        color: '#A78BFA', icon: '🚴' },
  delivered:  { label: 'Teslim Edildi', color: '#10B981', icon: '✅' },
  cancelled:  { label: 'İptal',          color: '#EF4444', icon: '❌' },
  // B2B orders statüleri
  PENDING_PAYMENT:  { label: 'Ödeme Bekliyor',  color: '#F59E0B', icon: '💳' },
  PAYMENT_RECEIVED: { label: 'Ödeme Alındı',    color: '#38BDF8', icon: '💰' },
  IN_ESCROW:        { label: 'Escrow\'da',       color: '#A78BFA', icon: '🔒' },
  SHIPPED:          { label: 'Kargoda',           color: '#60A5FA', icon: '📦' },
  DELIVERED:        { label: 'Teslim Edildi',    color: '#10B981', icon: '✅' },
  COMPLETED:        { label: 'Tamamlandı',       color: '#D4AF37', icon: '🏆' },
  CANCELLED:        { label: 'İptal',             color: '#EF4444', icon: '❌' },
  DISPUTED:         { label: 'Anlaşmazlık',       color: '#F87171', icon: '⚖️' },
};

function OrderHistoryModal({
  orderId,
  onClose,
}: {
  orderId: string;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<OrderStatusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrderStatusHistory(orderId)
      .then(setEvents)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [orderId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-[#2A3650] overflow-hidden"
        style={{ background: '#0B1220' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A3650]" style={{ background: '#131C2C' }}>
          <div>
            <p className="text-white font-extrabold text-sm">📋 Sipariş Geçmişi</p>
            <p className="text-[#5E7090] text-[10px] font-mono mt-0.5">{orderId.slice(0, 8)}…</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5E7090] hover:text-white hover:bg-[#1a2540] transition-all"
          >
            <i className="fas fa-times text-xs" />
          </button>
        </div>

        {/* Timeline */}
        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8 gap-2 text-[#5E7090]">
              <i className="fas fa-spinner fa-spin text-sm" />
              <span className="text-xs font-mono">Yükleniyor…</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-300 text-xs font-mono">
              {error}
            </div>
          )}

          {!loading && !error && events.length === 0 && (
            <p className="text-[#5E7090] text-xs font-mono text-center py-6">
              Henüz durum değişikliği kaydı yok.
            </p>
          )}

          {!loading && events.length > 0 && (
            <div className="relative">
              {/* Dikey çizgi */}
              <div className="absolute left-3.5 top-4 bottom-4 w-px bg-[#2A3650]" />

              <div className="space-y-5">
                {events.map((event, idx) => {
                  const info = STATUS_LABELS[event.status] ?? {
                    label: event.status,
                    color: '#5E7090',
                    icon:  '•',
                  };
                  const isLast = idx === events.length - 1;
                  const date = new Date(event.created_at);

                  return (
                    <div key={event.id} className="flex gap-4 relative">
                      {/* Dot */}
                      <div
                        className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm z-10 border-2"
                        style={{
                          background: isLast ? info.color + '25' : '#0B1220',
                          borderColor: isLast ? info.color : '#2A3650',
                        }}
                      >
                        {info.icon}
                      </div>

                      {/* Content */}
                      <div className="flex-1 pt-0.5 pb-1">
                        <div className="flex items-center justify-between flex-wrap gap-1 mb-1">
                          <span
                            className="text-xs font-bold"
                            style={{ color: info.color }}
                          >
                            {info.label}
                          </span>
                          <span className="text-[#5E7090] text-[10px] font-mono">
                            {date.toLocaleDateString('tr-TR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                            })} {date.toLocaleTimeString('tr-TR', {
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {event.previous_status && (
                          <p className="text-[#5E7090] text-[10px] font-mono mb-0.5">
                            {STATUS_LABELS[event.previous_status]?.label ?? event.previous_status}
                            {' '}→{' '}
                            {info.label}
                          </p>
                        )}

                        {event.profiles?.full_name && (
                          <p className="text-[#3A4A65] text-[10px] font-mono">
                            <i className="fas fa-user mr-1 text-[8px]" />
                            {event.profiles.full_name}
                            {event.profiles.role ? ` (${event.profiles.role})` : ''}
                          </p>
                        )}

                        {event.note && event.note !== 'Otomatik trigger kaydı' && (
                          <p className="mt-1 text-[11px] text-[#8A9BB5] italic">
                            "{event.note}"
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2A3650] flex justify-end" style={{ background: '#131C2C' }}>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-bold border border-[#2A3650] text-[#5E7090] hover:text-white hover:border-[#D4AF37]/40 transition-all"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FranchisePanel — Gelen Siparişler bölümü değişikliği
// ─────────────────────────────────────────────────────────────────────────────
// Aşağıdaki kod sadece DEĞİŞEN BÖLÜMÜ gösteriyor.
// Mevcut FranchisePanel.tsx'in geri kalanı aynı kalır.

export function OrdersSection({
  orders,
  user,
  onRefresh,
}: {
  orders: unknown[];
  user: { id: string } | null;
  onRefresh: () => void;
}) {
  const [historyOrderId, setHistoryOrderId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleStatusChange = async (
    orderId: string,
    newStatus: string,
  ) => {
    if (!user?.id) return;
    setUpdatingId(orderId);
    try {
      await updateOrderStatus(orderId, newStatus, user.id);
      onRefresh();
    } catch (err) {
      console.error('Durum güncellenemedi:', (err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="rounded-2xl p-5" style={{ background: '#131C2C', border: '1px solid #2A3650' }}>
      <p className="text-white font-extrabold text-sm mb-3">Gelen Siparişler</p>
      {(orders as { id: string; total_amount: number; payment_method: string; delivery_address: string; status: string }[]).length === 0 ? (
        <p className="text-[#5E7090] text-xs font-mono">Henüz sipariş yok.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(orders as { id: string; total_amount: number; payment_method: string; delivery_address: string; status: string }[]).map((o) => {
            const isUpdating = updatingId === o.id;
            const statusInfo = STATUS_LABELS[o.status];
            return (
              <div
                key={o.id}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 bg-black/20 text-xs gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold">
                    ₺{Number(o.total_amount).toFixed(2)}
                    {' '}·{' '}
                    {o.payment_method === 'cash' ? 'Nakit' : 'Kart (POS)'}
                  </p>
                  <p className="text-[#5E7090] font-mono truncate">{o.delivery_address}</p>
                  {statusInfo && (
                    <span
                      className="inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ color: statusInfo.color, background: statusInfo.color + '18' }}
                    >
                      {statusInfo.icon} {statusInfo.label}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Geçmiş butonu — YENİ */}
                  <button
                    onClick={() => setHistoryOrderId(o.id)}
                    title="Durum geçmişi"
                    className="w-7 h-7 rounded-lg flex items-center justify-center border border-[#2A3650] text-[#5E7090] hover:text-[#D4AF37] hover:border-[#D4AF37]/40 transition-all"
                  >
                    <i className="fas fa-history text-[10px]" />
                  </button>

                  {/* Durum seçici */}
                  <select
                    value={o.status}
                    disabled={isUpdating}
                    onChange={(e) => handleStatusChange(o.id, e.target.value)}
                    className="bg-black/30 border border-[#2A3650] rounded px-2 py-1 text-white text-[10px] disabled:opacity-50"
                  >
                    <option value="received">📥 Alındı</option>
                    <option value="preparing">👨‍🍳 Hazırlanıyor</option>
                    <option value="courier">🚴 Kuryede</option>
                    <option value="delivered">✅ Teslim Edildi</option>
                    <option value="cancelled">❌ İptal</option>
                  </select>

                  {isUpdating && (
                    <i className="fas fa-spinner fa-spin text-[#D4AF37] text-[10px]" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Geçmiş Modal */}
      {historyOrderId && (
        <OrderHistoryModal
          orderId={historyOrderId}
          onClose={() => setHistoryOrderId(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UYGULAMA TALİMATI:
//
// 1. dampingvar.ts'te updateOrderStatus fonksiyonu değiştirildi → RPC çağırıyor
// 2. getOrderStatusHistory ve getOrderTimeline fonksiyonları eklendi
// 3. FranchisePanel.tsx'te orders bölümü için yukarıdaki OrdersSection kullanılabilir
//    VEYA mevcut "Gelen Siparişler" <div> bloğu şu şekilde güncellenir:
//
//    onChange={(e) => updateOrderStatus(o.id, e.target.value, user!.id).then(refresh)}
//    ↑ user.id 3. argüman olarak ekleniyor
//
//    VE "Geçmiş" butonu ekleniyor:
//    <button onClick={() => setHistoryOrderId(o.id)}>📋</button>
//
// 4. FranchisePanel component'ine state ekle:
//    const [historyOrderId, setHistoryOrderId] = useState<string | null>(null);
//
// 5. JSX'e modal ekle:
//    {historyOrderId && (
//      <OrderHistoryModal orderId={historyOrderId} onClose={() => setHistoryOrderId(null)} />
//    )}
// ─────────────────────────────────────────────────────────────────────────────
export default OrdersSection;
