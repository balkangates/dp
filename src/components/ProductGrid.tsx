import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Product, PRODUCTS, formatPrice } from '../data';
import { getProducts } from '../lib/supabase';

interface ProductGridProps {
  onAddToCart: (product: Product) => void;
}

const SALE_TYPE_MAP: Record<string, string> = {
  all: 'all',
  damping: 'normal',   // normal ürünler = damping
  trink: 'trink',
  toptan: 'normal',
  ihale: 'auction',
};

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  damping:  { label: '🔥 DAMPING',  color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  trink:    { label: '⚡ TRINK SAT', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  toptan:   { label: '📦 TOPTAN',   color: '#38BDF8', bg: 'rgba(56,189,248,0.1)' },
  ihale:    { label: '🏷️ İHALE',   color: '#D4AF37', bg: 'rgba(212,175,55,0.1)' },
  normal:   { label: '🔥 DAMPING',  color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  auction:  { label: '🏷️ İHALE',   color: '#D4AF37', bg: 'rgba(212,175,55,0.1)' },
};

const FILTERS = [
  { key: 'all',    label: 'Tümü',    icon: 'fas fa-th' },
  { key: 'damping',label: 'Damping', icon: 'fas fa-fire' },
  { key: 'trink',  label: 'Trink Sat', icon: 'fas fa-bolt' },
  { key: 'toptan', label: 'Toptan',  icon: 'fas fa-boxes-stacked' },
  { key: 'ihale',  label: 'İhale',   icon: 'fas fa-gavel' },
];

// Supabase satırını Product tipine dönüştür
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSupabaseProduct(row: Record<string, any>): Product {
  const originalPrice = row.price ?? 0;
  const trinkPrice = row.trink_price ?? null;
  const dampingPrice = trinkPrice ?? Math.round(originalPrice * 0.75);
  const discount = Math.round(((originalPrice - dampingPrice) / originalPrice) * 100);
  return {
    id: row.id,
    title: row.title,
    image: row.image_url ?? 'https://images.pexels.com/photos/3987066/pexels-photo-3987066.jpeg?auto=compress&cs=tinysrgb&w=600',
    originalPrice,
    dampingPrice,
    discount,
    category: row.category ?? 'Genel',
    type: (row.sale_type === 'trink' ? 'trink' : row.sale_type === 'auction' ? 'ihale' : 'damping') as Product['type'],
    stock: row.stock ?? 0,
    soldCount: 0,
    badge: row.quality_grade ?? undefined,
    sellerId: row.seller_id,
  };
}

export default function ProductGrid({ onAddToCart }: ProductGridProps) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Supabase'den ürünleri çek
  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      const saleType = SALE_TYPE_MAP[activeFilter];
      const { data, error } = await getProducts(saleType === 'all' ? undefined : saleType);
      if (!error && data && data.length > 0) {
        setProducts(data.map(mapSupabaseProduct));
      } else {
        // Fallback: data.ts'deki statik ürünler
        setProducts(
          activeFilter === 'all'
            ? PRODUCTS
            : PRODUCTS.filter(p => p.type === activeFilter)
        );
      }
      setLoading(false);
    }
    fetchProducts();
  }, [activeFilter]);

  const handleAdd = (product: Product) => {
    onAddToCart(product);
    setAddedIds(prev => new Set([...prev, product.id]));
    setTimeout(() => {
      setAddedIds(prev => { const next = new Set(prev); next.delete(product.id); return next; });
    }, 1500);
  };

  return (
    <div className="rounded-2xl border border-[#2A3650] p-5" style={{ background: '#131C2C' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">
        <h3 className="text-white font-extrabold text-base flex items-center gap-2">
          <i className="fas fa-boxes text-[#D4AF37]"></i>
          SEKTÖRÜN GERÇEK ÜRÜNLERİ
        </h3>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap cursor-pointer transition-all ${
                activeFilter === f.key
                  ? 'bg-[#D4AF37] text-black'
                  : 'bg-[#090d16] text-[#5E7090] border border-[#2A3650] hover:border-[#D4AF37]/30 hover:text-[#D4AF37]'
              }`}
            >
              <i className={f.icon + ' text-[10px]'}></i>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-64 rounded-xl bg-[#0F1729] border border-[#2A3650] animate-pulse" />
          ))}
        </div>
      )}

      {/* Products grid */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product, i) => {
            const typeInfo = TYPE_LABELS[product.type] ?? TYPE_LABELS.damping;
            const isAdded = addedIds.has(product.id);
            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="card-hover rounded-xl border border-[#2A3650] overflow-hidden group"
                style={{ background: '#0F1729' }}
              >
                <div className="relative h-44 overflow-hidden">
                  <img src={product.image} alt={product.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0F1729] via-transparent to-transparent" />
                  <div className="absolute top-2.5 left-2.5">
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-lg border" style={{ background: typeInfo.bg, color: typeInfo.color, borderColor: typeInfo.color + '40' }}>
                      {typeInfo.label}
                    </span>
                  </div>
                  {product.discount > 0 && (
                    <div className="absolute top-2.5 right-2.5">
                      <span className="bg-red-500 text-white text-[11px] font-black px-2 py-0.5 rounded-lg">-{product.discount}%</span>
                    </div>
                  )}
                  <div className="absolute bottom-2.5 left-2.5 right-2.5">
                    <div className="flex items-center justify-between text-[9px] mb-1">
                      <span className="text-white/70 font-mono">{product.soldCount} satıldı</span>
                      <span className="text-[#EF4444] font-mono font-bold">Son {product.stock} adet!</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden backdrop-blur-sm">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min((product.soldCount / Math.max(product.soldCount + product.stock, 1)) * 100, 95)}%`,
                        background: 'linear-gradient(90deg, #EF4444, #F59E0B)',
                      }} />
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <h4 className="text-white font-bold text-sm mb-3 leading-snug">{product.title}</h4>
                  <div className="flex items-end justify-between mb-4">
                    <div>
                      <p className="text-[#5E7090] text-[11px] line-through font-mono mb-0.5">{formatPrice(product.originalPrice)}</p>
                      <p className="text-[#10B981] text-lg font-mono font-black">{formatPrice(product.dampingPrice)}</p>
                    </div>
                    {product.originalPrice > product.dampingPrice && (
                      <div className="text-right">
                        <p className="text-[9px] text-[#5E7090] mb-0.5">Kazancınız</p>
                        <p className="text-[#D4AF37] text-xs font-mono font-bold">{formatPrice(product.originalPrice - product.dampingPrice)}</p>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleAdd(product)}
                    className="w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-95"
                    style={{ background: isAdded ? 'linear-gradient(135deg, #10B981, #14B8A6)' : 'linear-gradient(135deg, #F59E0B, #EAB308)', color: '#000' }}
                  >
                    {isAdded ? <><i className="fas fa-check"></i> SEPETE EKLENDİ!</> : <><i className="fas fa-shopping-bag"></i> SEPETE EKLE</>}
                  </button>
                </div>
              </motion.div>
            );
          })}
          {products.length === 0 && !loading && (
            <div className="col-span-3 text-center py-12 text-[#5E7090]">
              <i className="fas fa-box-open text-3xl mb-3 block opacity-30"></i>
              <p className="font-mono text-sm">Bu kategoride ürün bulunamadı.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
