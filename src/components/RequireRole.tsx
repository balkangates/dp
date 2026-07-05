import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface RequireRoleProps {
  allowedRoles: string[];
  children: ReactNode;
}

/**
 * RequireRole — route seviyesinde strict yetki kontrolü.
 *
 * Öncesinde /admin, /supplier, /franchise, /affiliate route'ları auth/role
 * kontrolü OLMADAN herkese açıktı (URL'i bilen giriş yapmış/yapmamış her
 * kullanıcı erişebiliyordu). Bu component üç durumu ayırt eder:
 *   1. Auth henüz yükleniyor   → kısa bir yükleniyor ekranı (session'ı
 *      bilmeden ne izin ver ne reddet — flaş/yanlış pozitif önlenir)
 *   2. Giriş yapılmamış        → "/" adresine yönlendir
 *   3. Giriş yapılmış ama rol uymuyor → 403 ekranı (redirect DEĞİL — sessizce
 *      ana sayfaya atmak kullanıcıyı yanıltır, "neden burada değilim" belli
 *      olsun diye net bir mesaj gösteriliyor)
 */
export default function RequireRole({ allowedRoles, children }: RequireRoleProps) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0E1A' }}>
        <i className="fas fa-spinner fa-spin text-2xl" style={{ color: '#D4AF37' }}></i>
      </div>
    );
  }

  if (!user || !profile) {
    return <Navigate to="/" replace />;
  }

  if (!allowedRoles.includes(profile.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0A0E1A' }}>
        <div className="max-w-sm w-full text-center rounded-2xl p-10" style={{ background: '#131C2C', border: '1px solid #2A3650' }}>
          <i className="fas fa-lock text-3xl mb-4 block" style={{ color: '#EF4444' }}></i>
          <h1 className="text-white font-black text-lg mb-2">Erişim Yetkiniz Yok</h1>
          <p className="text-[#5E7090] font-mono text-xs mb-6">
            "{profile.role}" rolü bu sayfayı görüntüleyemez.
          </p>
          <a href="/" className="inline-block px-5 py-2 rounded-lg font-bold text-sm" style={{ background: '#D4AF37', color: '#0A0E1A' }}>
            Ana Sayfaya Dön
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
