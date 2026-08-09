'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentPosition, getNearestStores, getAllStores, type NearbyStore } from '@/lib/geo';

const CARD = { background: '#131C2C', border: '1px solid #2A3650' };

export default function StoreSelector() {
  const router = useRouter();
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pos = await getCurrentPosition();
        const nearby = await getNearestStores(pos.lat, pos.lng, 20);
        setStores(nearby);
      } catch (err) {
        setError((err as Error).message);
        try {
          const all = await getAllStores(20);
          setStores(
            all.map((s) => ({
              store_id: s.id,
              name: s.name,
              address: s.address,
              lat: s.lat ?? 0,
              lng: s.lng ?? 0,
              is_live: s.is_live,
              distance_km: NaN,
            })),
          );
        } catch {
          /* no fallback available either — show the error above */
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-[#5E7090] font-mono text-sm py-10 text-center">Konum alınıyor…</div>;

  return (
    <div className="space-y-3">
      <h2 className="text-white font-black text-xl">📍 Mağaza Seç</h2>
      {error && <p className="text-[11px] text-amber-400 font-mono">{error}</p>}
      {stores.length === 0 ? (
        <p className="text-[#5E7090] text-sm font-mono">Yakınında mağaza bulunamadı.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {stores.map((s) => (
            <button
              key={s.store_id}
              onClick={() => router.push(`/store/${s.store_id}`)}
              className="text-left rounded-xl p-4 hover:border-[#D4AF37]/60 transition-colors"
              style={CARD}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-white font-extrabold text-sm">{s.name}</p>
                {s.is_live && (
                  <span className="text-[9px] font-mono font-bold text-red-400 bg-red-500/15 px-2 py-0.5 rounded">
                    ● CANLI
                  </span>
                )}
              </div>
              <p className="text-[#5E7090] text-[11px] font-mono">{s.address ?? '—'}</p>
              {Number.isFinite(s.distance_km) && (
                <p className="text-[#D4AF37] text-[11px] font-mono mt-1">{s.distance_km.toFixed(1)} km</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
