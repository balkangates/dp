// src/lib/youtube.ts
// modules/youtube-utils.js (dashboard.html / dealer tarafı) ile aynı mantık —
// React tarafında ayrı bir dosya, çünkü dashboard.html vanilla-JS modülleri
// ile bu React app farklı build/derleme yolları (viteSingleFile vs. tarayıcı
// ESM import'u).
export function getYoutubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return u.pathname.split('/').filter(Boolean)[0] || null;
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

export function getYoutubeEmbedUrl(url: string | null | undefined, autoplay = false): string | null {
  const id = getYoutubeVideoId(url);
  if (!id) return null;
  return `https://www.youtube-nocookie.com/embed/${id}${autoplay ? '?autoplay=1&mute=0' : ''}`;
}
