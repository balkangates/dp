'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { loadActiveShipments, markShipmentDelivered, CARRIERS, CARRIER_TRACKING_HOMEPAGE, type Shipment } from '@/lib/logistics';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };
const carrierLabel = (v: string) => CARRIERS.find((c) => c.value === v)?.label ?? v;

export default function LogisticsDashboardPage() {
  const { profile, loading: authLoading } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => loadActiveShipments().then(setShipments).catch((e) => console.error(e));

  useEffect(() => {
    refresh();
    setLoading(false);
    const channel = supabase
      .channel('logistics-shipments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_order_shipments' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleDeliver = async (orderId: string) => {
    if (!confirm('Bu sipariş teslim edildi mi? Onaylarsan sipariş otomatik "Teslim Edildi" durumuna geçer ve escrow serbest bırakılır.')) return;
    try {
      await markShipmentDelivered(orderId);
      refresh();
    } catch (e) {
      alert('İşaretlenemedi: ' + (e as Error).message);
    }
  };

  if (authLoading || loading) return <main className="max-w-5xl mx-auto px-4 py-8 text-[#5E7090] font-mono text-sm">Yükleniyor…</main>;
  if (profile && profile.role !== 'logistics' && profile.role !== 'admin') {
    return <main className="max-w-5xl mx-auto px-4 py-8 text-red-400 font-mono text-sm">Bu sayfaya erişim yetkiniz yok.</main>;
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <p className="text-white font-black text-xl">Lojistik Paneli</p>
      <p className="text-[#5E7090] text-xs font-mono">
        Kargoya verilmiş, henüz teslim onayı alınmamış tüm siparişler. Kargo firması takip numarasıyla
        gönderiyi kendi sisteminizde/taşıyıcının sitesinde kontrol edip buradan &quot;Teslim Edildi&quot; olarak işaretleyin.
      </p>

      {shipments.length === 0 ? (
        <p className="text-[#5E7090] text-sm font-mono">Bekleyen sevkiyat yok. 🎉</p>
      ) : (
        <div className="space-y-2">
          {shipments.map((s) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const order = s.store_orders as any;
            const homepage = CARRIER_TRACKING_HOMEPAGE[s.carrier];
            return (
              <div key={s.id} className="rounded-xl p-3 flex items-center justify-between flex-wrap gap-2" style={CARD}>
                <div>
                  <p className="text-white text-sm font-bold">{order?.stores?.name} → {order?.delivery_address}</p>
                  <p className="text-[#5E7090] text-xs font-mono mt-0.5">
                    {carrierLabel(s.carrier)} {s.tracking_number ? `· Takip No: ${s.tracking_number}` : ''} · ₺{Number(order?.total_amount).toLocaleString('tr-TR')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {homepage && s.tracking_number && (
                    <a href={homepage} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#5E7090] hover:text-[#D4AF37]">
                      <i className="fas fa-arrow-up-right-from-square mr-1" />Takip sitesi
                    </a>
                  )}
                  <button
                    onClick={() => handleDeliver(s.order_id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: '#10B981', color: '#fff' }}
                  >
                    <i className="fas fa-check mr-1" />Teslim Edildi
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
