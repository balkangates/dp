'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { supabase } from '@/lib/supabase';
import { ensureStore, NEXT_STATUS, STATUS_LABEL, advanceOrder, cancelOrder } from '@/lib/dealer';
import { markOrderShipped, CARRIERS } from '@/lib/logistics';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export default function DealerOrdersPage() {
  const { profile } = useAuth();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [orders, setOrders] = useState<AnyRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [shipFormFor, setShipFormFor] = useState<string | null>(null);
  const [shipCarrier, setShipCarrier] = useState<string>('yurtici');
  const [shipTracking, setShipTracking] = useState('');

  const load = useCallback(async (sId: string) => {
    const { data } = await supabase
      .from('store_orders')
      .select('*, store_order_items(*), escrow_transactions(status, net_amount), store_order_invoices(invoice_number), delivery_notes(document_no)')
      .eq('store_id', sId)
      .order('created_at', { ascending: false })
      .limit(100);
    setOrders(data || []);
  }, []);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const s = await ensureStore(profile.id);
      if (s) { setStoreId(s.id); await load(s.id); }
      setLoading(false);
    })();
  }, [profile, load]);

  const handleAdvance = async (orderId: string, next: string) => {
    if (next === 'SHIPPED') { setShipFormFor(orderId); return; }
    try { await advanceOrder(orderId, next); if (storeId) await load(storeId); }
    catch (e) { alert('Durum güncellenemedi: ' + (e as Error).message); }
  };
  const handleConfirmShip = async (orderId: string) => {
    if (!shipTracking.trim() && shipCarrier !== 'manual') {
      alert('Takip numarası girin (kendi aracınızla teslim ediyorsanız "Kendi Aracımız" seçip boş bırakabilirsiniz).');
      return;
    }
    try {
      await markOrderShipped(orderId, shipCarrier, shipTracking.trim());
      setShipFormFor(null);
      setShipTracking('');
      if (storeId) await load(storeId);
    } catch (e) {
      alert('Kargoya verilemedi: ' + (e as Error).message);
    }
  };
  const handleCancel = async (orderId: string) => {
    if (!confirm('İptal edilsin mi?')) return;
    try { await cancelOrder(orderId); if (storeId) await load(storeId); }
    catch (e) { alert('İptal edilemedi: ' + (e as Error).message); }
  };

  if (loading) return <p className="text-[#5E7090] font-mono text-sm">Yükleniyor…</p>;

  const filtered = statusFilter === 'ALL' ? orders : orders.filter((o) => o.status === statusFilter);

  return (
    <div className="space-y-4">
      <p className="text-white font-black text-lg">Siparişler</p>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {['ALL', ...Object.keys(STATUS_LABEL)].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
            style={{ background: statusFilter === s ? '#D4AF37' : '#090d16', color: statusFilter === s ? '#000' : '#5E7090', border: '1px solid #2A3650' }}
          >
            {s === 'ALL' ? 'Tümü' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && <p className="text-[#5E7090] text-xs font-mono">Sipariş yok.</p>}
        {filtered.map((o) => {
          const itemsSummary = (o.store_order_items || []).map((i: AnyRow) => `${i.quantity}× ${i.product_name}`).join(', ');
          const next = NEXT_STATUS[o.status];
          const escrow = o.escrow_transactions?.[0];
          const invoice = o.store_order_invoices?.[0];
          const deliveryNote = o.delivery_notes?.[0];
          const cancellable = !['COMPLETED', 'CANCELLED', 'DELIVERED'].includes(o.status);
          return (
            <div key={o.id} className="rounded-xl p-3 text-xs" style={CARD}>
              <div className="flex justify-between items-center flex-wrap gap-1.5">
                <span className="text-white font-bold">{itemsSummary || 'Sipariş'}</span>
                <span className="text-[#10B981] font-mono">₺{Number(o.total_amount).toLocaleString('tr-TR')}</span>
              </div>
              <div className="flex justify-between items-center mt-1.5 flex-wrap gap-1.5">
                <span className="text-[10px] text-[#5E7090] font-mono">{new Date(o.created_at).toLocaleString('tr-TR')}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: '#1E2A42' }}>{STATUS_LABEL[o.status] || o.status}</span>
                  {cancellable && (
                    <button onClick={() => handleCancel(o.id)} className="text-[#5E7090] hover:text-red-400"><i className="fas fa-ban" /></button>
                  )}
                  {next && (
                    <button onClick={() => handleAdvance(o.id, next)} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#D4AF37', color: '#000' }}>
                      {STATUS_LABEL[next]} <i className="fas fa-arrow-right ml-0.5" />
                    </button>
                  )}
                </div>
              </div>
              {shipFormFor === o.id && (
                <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-dashed border-[#1E2A42]">
                  <select
                    value={shipCarrier}
                    onChange={(e) => setShipCarrier(e.target.value)}
                    className="bg-black/30 border border-[#2A3650] rounded px-2 py-1 text-white text-[10px]"
                  >
                    {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input
                    placeholder="Takip no" value={shipTracking}
                    onChange={(e) => setShipTracking(e.target.value)}
                    className="flex-1 bg-black/30 border border-[#2A3650] rounded px-2 py-1 text-white text-[10px]"
                  />
                  <button onClick={() => handleConfirmShip(o.id)} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#D4AF37', color: '#000' }}>Onayla</button>
                  <button onClick={() => setShipFormFor(null)} className="px-2 py-1 rounded text-[10px]" style={{ background: '#2A3650', color: '#A3B3D1' }}>Vazgeç</button>
                </div>
              )}
              {(escrow || invoice || deliveryNote) && (
                <div className="flex gap-2.5 flex-wrap mt-1.5 pt-1.5 border-t border-dashed border-[#1E2A42] text-[10px] text-[#5E7090]">
                  {escrow && <span><i className="fas fa-vault mr-1" />Escrow: {escrow.status === 'HELD' ? 'Bekliyor' : escrow.status === 'RELEASED' ? 'Serbest' : 'İade'}</span>}
                  {invoice && <span><i className="fas fa-file-invoice mr-1" />Fatura: {invoice.invoice_number}</span>}
                  {deliveryNote && <span><i className="fas fa-truck mr-1" />İrsaliye: {deliveryNote.document_no}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
