/**
 * modules/youtube-utils.js
 * ─────────────────────────────────────────────────────────────────────────
 * Ürün tanıtım videosu artık dosya yüklemesi değil, bayinin kendi YouTube
 * kanalındaki videosunun LİNKİ. Bu dosya, o linki doğrulayıp embed
 * (iframe) URL'sine çeviren küçük paylaşılan yardımcı fonksiyonları içerir.
 * Hem dealer-catalog.js (link ekleme formu) hem de live-sales.js
 * (offline modda videoyu oynatma) bunu kullanır.
 */

// "https://www.youtube.com/watch?v=XXXX", "https://youtu.be/XXXX",
// "https://www.youtube.com/shorts/XXXX", "https://www.youtube.com/embed/XXXX"
// formatlarının hepsini kabul eder. Geçersizse null döner.
export function getYoutubeVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
        return parts[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function isYoutubeUrl(url) {
  return !!getYoutubeVideoId(url);
}

export function getYoutubeEmbedUrl(url) {
  const id = getYoutubeVideoId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

export function getYoutubeThumbnailUrl(url) {
  const id = getYoutubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
