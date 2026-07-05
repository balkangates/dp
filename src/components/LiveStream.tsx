import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ─── Sabitler ──────────────────────────────────────────────────────────────────
const USER_COLORS = [
  '#38BDF8', '#10B981', '#D4AF37', '#FF007A',
  '#A78BFA', '#F59E0B', '#14B8A6', '#FB923C',
];
const MAX_OVERLAY_MSGS = 6;

// Supabase'de sabit "live yayın" conversation ID
// fix_live_conversation_v2.sql ile oluşturuldu
const LIVE_CONV_ID = 'e3fc6ac0-5e8f-4bb6-9aa1-ca1d84ddaf73';

// ─── Tip ────────────────────────────────────────────────────────────────────────
interface LiveMessage {
  id: string;
  sender_id: string | null;
  message: string;
  created_at: string;
  is_system_message: boolean;
  sender_name: string;
  sender_rumuz: string | null;  // ← profiles.rumuz
  sender_color: string;
  message_type: string;
}

// ─── DB satırı → LiveMessage ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMsg(row: Record<string, any>, colorMap: Record<string, string>): LiveMessage {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const sid = row.sender_id ?? 'sys';
  if (!colorMap[sid]) {
    colorMap[sid] = USER_COLORS[Object.keys(colorMap).length % USER_COLORS.length];
  }
  return {
    id:               String(row.id),
    sender_id:        row.sender_id ?? null,
    message:          row.message ?? '',
    created_at:       row.created_at,
    is_system_message: row.is_system_message ?? false,
    sender_name:
      profile?.full_name ??
      profile?.company_name ??
      (row.is_system_message ? 'Sistem' : 'Kullanıcı'),
    sender_rumuz: profile?.rumuz ?? null,  // ← rumuz alanı
    sender_color: colorMap[sid],
    message_type: row.message_type ?? 'live',
  };
}

// ─── Ana Bileşen ────────────────────────────────────────────────────────────────
export default function LiveStream() {
  const { user, profile } = useAuth();

  const colorMapRef = useRef<Record<string, string>>({});

  const [messages, setMessages]     = useState<LiveMessage[]>([]);
  const [input, setInput]           = useState('');
  const [sending, setSending]       = useState(false);
  const [sendError, setSendError]   = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [showEmoji, setShowEmoji]   = useState(false);
  const [floatTrigger, setFloatTrigger] = useState<{emoji:string;id:number}|null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  const EMOJI_LIST = [
    '❤️','🔥','😍','👏','💰','🎉','⭐','💎',
    '😂','🤣','😊','🥳','👍','💪','🙏','😎',
    '🤑','💯','🚀','✅','😮','🤯','😆','🥰',
  ];

  // Emoji picker dışına tıklayınca kapat
  useEffect(() => {
    function handleOut(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    }
    document.addEventListener('mousedown', handleOut);
    return () => document.removeEventListener('mousedown', handleOut);
  }, []);

  // Emoji input'a ekle
  const insertEmoji = useCallback((emoji: string) => {
    setInput(prev => prev + emoji);
    setFloatTrigger({ emoji, id: Date.now() });
    inputRef.current?.focus();
  }, []);

  // ── 1. Geçmiş mesajları çek — message_type = 'live' ─────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchMessages() {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          id,
          sender_id,
          message,
          created_at,
          is_system_message,
          message_type,
          profiles:sender_id (
            full_name,
            company_name,
            rumuz
          )
        `)
        .eq('message_type', 'live')
        .eq('conversation_id', LIVE_CONV_ID)  // sadece live broadcast conversation
        .order('created_at', { ascending: false })
        .limit(10);

      if (cancelled) return;
      if (error) {
        console.error('[LiveStream] fetch error:', error.message, error.code);
        return;
      }
      if (data && data.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = (data as Record<string, any>[])
          .reverse()
          .map(row => mapMsg(row, colorMapRef.current));
        setMessages(mapped);
      }
    }

    fetchMessages();
    return () => { cancelled = true; };
  }, []);

  // ── 2. Realtime — message_type = 'live' filtresi ────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('livestream_chat_v3')
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'messages',
          // Supabase realtime filter: message_type eşit 'live'
          filter: `message_type=eq.live&conversation_id=eq.${LIVE_CONV_ID}`,
        },
        async (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as Record<string, any>;

          // sender_id yoksa ve sistem mesajı değilse yok say
          if (!row.sender_id && !row.is_system_message) return;

          let profileData: { full_name?: string; company_name?: string; rumuz?: string } | null = null;
          if (row.sender_id) {
            const { data } = await supabase
              .from('profiles')
              .select('full_name, company_name, rumuz')
              .eq('id', row.sender_id)
              .single();
            profileData = data;
          }

          const newMsg = mapMsg({ ...row, profiles: profileData }, colorMapRef.current);

          setMessages(prev => {
            // optimistic duplicate temizle
            const clean = prev.filter(m => !m.id.startsWith('opt_'));
            if (clean.some(m => m.id === newMsg.id)) return prev;
            return [...clean, newMsg].slice(-MAX_OVERLAY_MSGS);
          });
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[LiveStream] Realtime channel error');
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── 3. İzleyici sayısı ──────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchViewers() {
      const { count } = await supabase
        .from('active_users')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      if (count !== null) setViewerCount(count);
    }
    fetchViewers();
    const iv = setInterval(fetchViewers, 30_000);
    return () => clearInterval(iv);
  }, []);

  // ── 4. Mesaj gönder ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();

    // Giriş yapılmamışsa hata göster
    if (!user?.id) {
      setSendError('Mesaj göndermek için giriş yapmanız gerekiyor.');
      setTimeout(() => setSendError(null), 3000);
      return;
    }
    if (!text || sending) return;

    setSending(true);
    setSendError(null);
    setInput('');

    // Optimistic mesaj — rumuz dahil
    const rumuz = (profile as Record<string, unknown>)?.rumuz as string ?? null;
    const optimisticId = `opt_${Date.now()}`;
    const optimistic: LiveMessage = {
      id:               optimisticId,
      sender_id:        user.id,
      message:          text,
      created_at:       new Date().toISOString(),
      is_system_message: false,
      sender_name:      profile?.full_name ?? profile?.company_name ?? 'Sen',
      sender_rumuz:     rumuz,
      sender_color:     colorMapRef.current[user.id] ?? '#D4AF37',
      message_type:     'live',
    };
    setMessages(prev => [...prev.slice(-(MAX_OVERLAY_MSGS - 1)), optimistic]);

    // ── INSERT ──────────────────────────────────────────────────────────────
    // receiver_id  → sütun yok, INSERT'e dahil etme
    // message_type → 'live'  (canlı yayın mesajı)
    // is_read      → TRUE    (genel yayın, okunmadı takibi yok)
    // ── conversation_id zorunlu ─────────────────────────────────────────────
    // messages tablosundaki trigger, INSERT sonrası conversation_participants'a
    // (conversation_id, user_id) yazar. user_id NOT NULL olduğu için
    // conversation_id boş giderse trigger NULL yazar → hata.
    // Çözüm: live mesajlar için sender_id'yi conversation_id olarak kullan.
    // messages.conversation_id FK → conversations tablosuna bağlı
    // message_type='live' olunca auto_create_conversation trigger'ı atlar
    // conversation_id göndermiyoruz — trigger NULL'u geçiyor
    const { error } = await supabase.from('messages').insert({
      sender_id:        user.id,
      message:          text,
      message_type:     'live',
      is_read:          true,
      is_system_message: false,
      conversation_id:  LIVE_CONV_ID,  // FK zorunlu — sabit live conversation
      // receiver_id: yok → genel yayın
    });

    if (error) {
      console.error('[LiveStream] insert error:', error.message, error.code, error.details);
      // Rollback optimistic
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      setInput(text);
      setSendError('Mesaj gönderilemedi: ' + error.message);
      setTimeout(() => setSendError(null), 4000);
    }

    setSending(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [input, user, profile, sending]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    },
    [sendMessage],
  );

  // ── Görünen isim: rumuz varsa rumuz, yoksa ad ────────────────────────────────
  function displayName(msg: LiveMessage, isSelf: boolean) {
    if (isSelf) return 'Sen';
    return msg.sender_rumuz ?? msg.sender_name;
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden border border-[#2A3650]"
      style={{ aspectRatio: '16/9', background: '#000' }}
    >
      {/* ── Video ── */}
      <video className="absolute inset-0 w-full h-full object-cover" autoPlay loop muted playsInline>
        <source src="https://videos.pexels.com/video-files/6833913/6833913-hd_1920_1080_25fps.mp4" type="video/mp4" />
      </video>

      {/* Degrade katmanlar */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-transparent pointer-events-none" />

      {/* ── Üst rozetler ── */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 bg-red-600/80 text-white px-3 py-1 rounded-lg text-[11px] font-bold tracking-widest backdrop-blur-sm">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            CANLI YAYIN
          </span>
          <span className="flex items-center gap-1.5 bg-black/40 text-white px-3 py-1 rounded-lg text-[11px] font-mono border border-white/10 backdrop-blur-sm">
            <i className="fas fa-eye text-[#38BDF8]" />
            {viewerCount > 0 ? viewerCount.toLocaleString('tr-TR') : '—'}
          </span>
          <span className="hidden sm:flex items-center gap-1.5 bg-black/40 text-white px-3 py-1 rounded-lg text-[11px] font-mono border border-white/10 backdrop-blur-sm">
            <i className="fas fa-signal text-[#10B981]" />
            HD 1080p
          </span>
        </div>
        <div className="flex gap-1.5">
          {['❤️', '🔥', '👏'].map(em => (
            <button key={em}
              onClick={() => insertEmoji(em)}
              className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-sm border border-white/10 hover:scale-110 transition-transform cursor-pointer">
              {em}
            </button>
          ))}
        </div>
      </div>

      {/* ── Floating Reactions ── */}
      <FloatingReactions externalTrigger={floatTrigger} />

      {/* ────────────────────────────────────────────────────────────────────────
          MESAJ OVERLAY — video üzerinde şeffaf şerit
          • bg: çok hafif siyah/lacivert, arkadaki videoyu kapatmaz
          • pointer-events-none: video kontrollerine engel olmaz
          • rumuz alt satırda gösterilir
      ─────────────────────────────────────────────────────────────────────── */}
      <div
        className="absolute left-0 bottom-[56px] z-20 pointer-events-none"
        style={{ width: 'min(68%, 380px)' }}
      >
        <AnimatePresence initial={false}>
          {messages.slice(-MAX_OVERLAY_MSGS).map(msg => {
            const isSelf = msg.sender_id === user?.id;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: -12, y: 4 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.35 } }}
                transition={{ duration: 0.2 }}
                className="mx-3 mb-1 flex items-start gap-2 rounded-xl px-3 py-1.5"
                style={{
                  // ← şeffaf overlay: arka plan %28 siyah, arkadaki video görünür kalır
                  background: 'rgba(0, 4, 18, 0.28)',
                  backdropFilter: 'blur(3px)',
                  WebkitBackdropFilter: 'blur(3px)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {/* Avatar */}
                {!msg.is_system_message && (
                  <span
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5"
                    style={{ background: msg.sender_color + '28', color: msg.sender_color }}
                  >
                    {(msg.sender_rumuz ?? msg.sender_name).charAt(0).toUpperCase()}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  {msg.is_system_message ? (
                    <span className="text-[11px] font-mono" style={{ color: msg.sender_color }}>
                      ⚡ {msg.message}
                    </span>
                  ) : (
                    <>
                      {/* Mesaj satırı */}
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-[11px] font-bold shrink-0" style={{ color: msg.sender_color }}>
                          {displayName(msg, isSelf)}:
                        </span>
                        <span className="text-white/85 text-[11px] break-words leading-snug">
                          {msg.message}
                        </span>
                      </div>
                      {/* Rumuz alt satır — sadece rumuz varsa ve sender_name'den farklıysa */}
                      {msg.sender_rumuz && msg.sender_rumuz !== msg.sender_name && !isSelf && (
                        <div className="text-[9px] font-mono mt-0.5" style={{ color: msg.sender_color + 'aa' }}>
                          @{msg.sender_rumuz}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Chat giriş kutusu ──────────────────────────────────────────────────── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-30 px-3 py-2.5"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.80) 75%, transparent)' }}
      >
        {/* Hata mesajı */}
        <AnimatePresence>
          {sendError && (
            <motion.div
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono text-red-300 flex items-center gap-1.5"
              style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.25)' }}
            >
              <i className="fas fa-exclamation-circle text-red-400 text-[10px]" />
              {sendError}
            </motion.div>
          )}
        </AnimatePresence>

        {user ? (
          <div className="flex items-center gap-2">
            {/* Avatar */}
            <div
              className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
              style={{ background: '#D4AF3728', color: '#D4AF37' }}
            >
              {((profile as Record<string, unknown>)?.rumuz as string ??
                profile?.full_name ?? profile?.company_name ?? 'S')
                .charAt(0).toUpperCase()}
            </div>

            {/* Input + Emoji picker */}
            <div className="relative flex-1">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Mesaj yaz… 😊"
                maxLength={200}
                disabled={sending}
                className="w-full rounded-xl pl-3 pr-8 py-2 text-white text-[12px] font-mono placeholder-white/30 focus:outline-none transition-colors disabled:opacity-50"
                style={{
                  background: 'rgba(0,0,0,0.50)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(212,175,55,0.55)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.12)')}
              />
              {/* Emoji tetikleyici — input içi sağ */}
              <button
                type="button"
                onClick={() => setShowEmoji(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-base leading-none cursor-pointer hover:scale-125 transition-transform"
                title="Emoji ekle"
              >
                😊
              </button>

              {/* Emoji picker popup */}
              {showEmoji && (
                <div
                  ref={emojiRef}
                  className="absolute bottom-[calc(100%+8px)] left-0 z-50 rounded-2xl p-3 grid grid-cols-6 gap-1.5"
                  style={{
                    background: 'rgba(10,14,26,0.96)',
                    border: '1px solid rgba(42,54,80,0.9)',
                    backdropFilter: 'blur(12px)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                    width: '220px',
                  }}
                >
                  {EMOJI_LIST.map(em => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => { insertEmoji(em); setShowEmoji(false); }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-lg cursor-pointer transition-all hover:scale-125 hover:bg-white/10"
                      title={em}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Gönder butonu */}
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg,#D4AF37,#F5D76E)' }}
              aria-label="Gönder"
            >
              {sending
                ? <i className="fas fa-spinner fa-spin text-black text-xs" />
                : <i className="fas fa-paper-plane text-black text-xs" />}
            </button>
          </div>
        ) : (
          /* Giriş yapılmamış */
          <div className="flex items-center justify-center gap-2 py-1">
            <i className="fas fa-lock text-[#D4AF37] text-xs" />
            <span className="text-white/55 text-[12px] font-mono">
              Sohbete katılmak için{' '}
              <span className="text-[#D4AF37] font-bold cursor-pointer hover:underline"
                onClick={() => document.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }))}>
                giriş yapın
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Sağ alt: yayın kalitesi */}
      <div className="absolute bottom-14 right-3 z-20">
        <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(42,54,80,0.6)', backdropFilter: 'blur(4px)' }}>
          <p className="text-[9px] text-[#5E7090] font-mono">YAYIN KALİTESİ</p>
          <p className="text-[11px] text-[#10B981] font-mono font-bold">● STABLE</p>
        </div>
      </div>
    </div>
  );
}

// ── Floating Reactions ────────────────────────────────────────────────────────
interface FloatProps {
  externalTrigger?: { emoji: string; id: number } | null;
}
function FloatingReactions({ externalTrigger }: FloatProps) {
  const [reactions, setReactions] = useState<{ id: number; emoji: string; x: number }[]>([]);

  // Otomatik random reactions
  useEffect(() => {
    const emojis = ['❤️', '🔥', '😍', '👏', '💰', '🎉', '⭐', '💎'];
    const iv = setInterval(() => {
      setReactions(prev => [
        ...prev.slice(-8),
        { id: Date.now(), emoji: emojis[Math.floor(Math.random() * emojis.length)], x: 85 + Math.random() * 10 },
      ]);
    }, 2000 + Math.random() * 2000);
    return () => clearInterval(iv);
  }, []);

  // Kullanıcı emoji seçince ekstra reaction uçsun
  useEffect(() => {
    if (!externalTrigger) return;
    setReactions(prev => [
      ...prev.slice(-8),
      { id: externalTrigger.id,     emoji: externalTrigger.emoji, x: 80 + Math.random() * 15 },
      { id: externalTrigger.id + 1, emoji: externalTrigger.emoji, x: 83 + Math.random() * 12 },
    ]);
  }, [externalTrigger]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
      {reactions.map(r => (
        <span key={r.id} className="absolute text-lg select-none"
          style={{ left: `${r.x}%`, bottom: '15%', animation: 'float 3s ease-out forwards' }}>
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
