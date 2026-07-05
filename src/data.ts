export interface Bid {
  id: string;
  userId: string;
  userName: string;
  avatar: string;
  amount: number;
  timestamp: number;
}

export interface AuctionItem {
  id: string;
  title: string;
  description: string;
  image: string;
  startPrice: number;
  currentPrice: number;
  minIncrement: number;
  duration: number; // seconds
  timeLeft: number;
  status: 'live' | 'upcoming' | 'ended';
  bids: Bid[];
  leader: string | null;
  leaderName: string | null;
  category: string;
  lot: number;
  viewerCount: number;
}

export interface Product {
  id: string;
  title: string;
  image: string;
  originalPrice: number;
  dampingPrice: number;
  discount: number;
  category: string;
  type: 'damping' | 'trink' | 'toptan' | 'ihale';
  stock: number;
  soldCount: number;
  badge?: string;
  sellerId?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface ChatMessage {
  id: string;
  user: string;
  message: string;
  type: 'chat' | 'bid' | 'system' | 'join';
  color: string;
  timestamp: number;
}

export const SIMULATED_USERS = [
  { id: 'u1', name: 'AhmetTR', avatar: '👨‍💼' },
  { id: 'u2', name: 'MehmetB2B', avatar: '🧔' },
  { id: 'u3', name: 'AyşeTicaret', avatar: '👩‍💼' },
  { id: 'u4', name: 'FatihGross', avatar: '👨‍🔧' },
  { id: 'u5', name: 'ZeynepShop', avatar: '👩‍🎨' },
  { id: 'u6', name: 'EmreToptan', avatar: '🧑‍💻' },
  { id: 'u7', name: 'SelimExport', avatar: '🕴️' },
  { id: 'u8', name: 'DenizTrade', avatar: '👨‍🚀' },
  { id: 'u9', name: 'CanDamping', avatar: '🤵' },
  { id: 'u10', name: 'ElifMarket', avatar: '👩‍🍳' },
];

export const INITIAL_AUCTIONS: AuctionItem[] = [
  {
    id: 'auc1',
    title: 'Apple Watch Ultra 2 - 49mm Titanium',
    description: 'Orijinal kutulu, sıfır ürün. Garantili.',
    image: 'https://images.pexels.com/photos/437038/pexels-photo-437038.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    startPrice: 8500,
    currentPrice: 12750,
    minIncrement: 250,
    duration: 60,
    timeLeft: 60,
    status: 'live',
    bids: [],
    leader: 'u3',
    leaderName: 'AyşeTicaret',
    category: 'Elektronik',
    lot: 1,
    viewerCount: 847,
  },
  {
    id: 'auc2',
    title: 'Rolex Datejust 36mm Rose Gold',
    description: '2024 model, full set, yatırımlık.',
    image: 'https://images.pexels.com/photos/1338587/pexels-photo-1338587.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    startPrice: 95000,
    currentPrice: 142000,
    minIncrement: 2500,
    duration: 60,
    timeLeft: 45,
    status: 'live',
    bids: [],
    leader: 'u7',
    leaderName: 'SelimExport',
    category: 'Lüks Saat',
    lot: 2,
    viewerCount: 1243,
  },
  {
    id: 'auc3',
    title: 'iPhone 15 Pro Max 256GB (x50 Adet)',
    description: 'Toptan lot, kapalı kutu, faturalı.',
    image: 'https://images.pexels.com/photos/5827833/pexels-photo-5827833.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    startPrice: 1250000,
    currentPrice: 1450000,
    minIncrement: 10000,
    duration: 60,
    timeLeft: 38,
    status: 'live',
    bids: [],
    leader: 'u1',
    leaderName: 'AhmetTR',
    category: 'Toptan Elektronik',
    lot: 3,
    viewerCount: 2156,
  },
  {
    id: 'auc4',
    title: 'Tag Heuer Monaco Koleksiyon Set',
    description: '3\'lü set, limitli üretim, sertifikalı.',
    image: 'https://images.pexels.com/photos/8968349/pexels-photo-8968349.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    startPrice: 180000,
    currentPrice: 215000,
    minIncrement: 5000,
    duration: 60,
    timeLeft: 52,
    status: 'upcoming',
    bids: [],
    leader: null,
    leaderName: null,
    category: 'Lüks Saat',
    lot: 4,
    viewerCount: 654,
  },
  {
    id: 'auc5',
    title: 'Samsung Galaxy S24 Ultra (x100 Adet)',
    description: 'İthalatçıdan direkt, gümrüklü.',
    image: 'https://images.pexels.com/photos/16247533/pexels-photo-16247533.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    startPrice: 2000000,
    currentPrice: 2000000,
    minIncrement: 25000,
    duration: 60,
    timeLeft: 60,
    status: 'upcoming',
    bids: [],
    leader: null,
    leaderName: null,
    category: 'Toptan Elektronik',
    lot: 5,
    viewerCount: 432,
  },
];

export const PRODUCTS: Product[] = [
  {
    id: 'p1',
    title: 'Apple Watch SE 2. Nesil',
    image: 'https://images.pexels.com/photos/437038/pexels-photo-437038.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    originalPrice: 12999,
    dampingPrice: 7499,
    discount: 42,
    category: 'Elektronik',
    type: 'damping',
    stock: 23,
    soldCount: 187,
    badge: '🔥 DAMPING',
  },
  {
    id: 'p2',
    title: 'Lüks Kol Saati Koleksiyon',
    image: 'https://images.pexels.com/photos/28697832/pexels-photo-28697832.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    originalPrice: 45000,
    dampingPrice: 18900,
    discount: 58,
    category: 'Aksesuar',
    type: 'trink',
    stock: 5,
    soldCount: 42,
    badge: '⚡ TRINK SAT',
  },
  {
    id: 'p3',
    title: 'Premium Aksesuar Seti',
    image: 'https://images.pexels.com/photos/1619651/pexels-photo-1619651.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    originalPrice: 8500,
    dampingPrice: 3200,
    discount: 62,
    category: 'Aksesuar',
    type: 'damping',
    stock: 67,
    soldCount: 534,
    badge: '🔥 DAMPING',
  },
  {
    id: 'p4',
    title: 'Profesyonel Saat & Laptop Set',
    image: 'https://images.pexels.com/photos/5827778/pexels-photo-5827778.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    originalPrice: 32000,
    dampingPrice: 14500,
    discount: 55,
    category: 'Elektronik',
    type: 'toptan',
    stock: 12,
    soldCount: 89,
    badge: '📦 TOPTAN',
  },
  {
    id: 'p5',
    title: 'Luxury Watch Rose Gold',
    image: 'https://images.pexels.com/photos/1338587/pexels-photo-1338587.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    originalPrice: 89000,
    dampingPrice: 42000,
    discount: 53,
    category: 'Lüks',
    type: 'ihale',
    stock: 1,
    soldCount: 0,
    badge: '🏷️ İHALE',
  },
  {
    id: 'p6',
    title: 'Premium Kol Saati Limited',
    image: 'https://images.pexels.com/photos/38018380/pexels-photo-38018380.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200',
    originalPrice: 55000,
    dampingPrice: 27500,
    discount: 50,
    category: 'Lüks',
    type: 'trink',
    stock: 3,
    soldCount: 12,
    badge: '⚡ TRINK SAT',
  },
];

export const CHAT_TEMPLATES = [
  { user: 'AhmetTR', message: 'Bu lot kaçırılmaz! 🔥', type: 'chat' as const },
  { user: 'ZeynepShop', message: 'Fiyat çok iyi', type: 'chat' as const },
  { user: 'FatihGross', message: 'Toptan alacağım 💪', type: 'chat' as const },
  { user: 'DenizTrade', message: 'Kalite süper mi?', type: 'chat' as const },
  { user: 'ElifMarket', message: 'Hemen teklif verdim!', type: 'chat' as const },
  { user: 'CanDamping', message: 'Bu fırsat kaçmaz', type: 'chat' as const },
  { user: 'SelimExport', message: 'İhracat için ideal', type: 'chat' as const },
  { user: 'EmreToptan', message: 'Stok ne kadar kaldı?', type: 'chat' as const },
  { user: 'MehmetB2B', message: 'B2B fiyatı var mı?', type: 'chat' as const },
  { user: 'AyşeTicaret', message: 'Harika ürün 👏', type: 'chat' as const },
];

export const SECTORS = ['Tümü', 'Elektronik', 'Aksesuar', 'Lüks Saat', 'Toptan', 'Moda'];

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('tr-TR', { 
    minimumFractionDigits: 0,
    maximumFractionDigits: 0 
  }).format(price) + '₺';
}

export function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
