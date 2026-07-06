import { useEffect, useMemo, useState } from 'react'

function hashToHue(input) {
  let h = 0
  const str = String(input || '')
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h % 360
}

function clampHueToBlue(h) {
  // Mantener el fallback dentro de la paleta azul/cian (evitar rojos/amarillos)
  return 195 + (Math.abs(h) % 35) // 195..229
}

function toInitials(label) {
  const raw = String(label || '').trim()
  if (!raw) return '—'
  const parts = raw.split(/\s+/g).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function toSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function CommercialAvatar({ commercialCode = '', commercialName = '', size = 44, className = '' }) {
  const label = (commercialName || '').trim() || (commercialCode || '').trim() || '—'
  const initials = useMemo(() => toInitials(label), [label])
  const hue = useMemo(() => clampHueToBlue(hashToHue(commercialCode || label)), [commercialCode, label])
  const normalizedCode = (commercialCode || '').trim()
  const hideCodeInLogoUrl = ['1', 'true', 'yes', 'on'].includes(
    String(import.meta.env.VITE_HIDE_COMMERCIAL_CODE_IN_LOGO_URL ?? 'true').trim().toLowerCase()
  )

  const candidates = useMemo(() => {
    const name = (commercialName || '').trim()
    const nameSlug = toSlug(name)
    const ids = [nameSlug].filter(Boolean)

    if (!hideCodeInLogoUrl) {
      const baseCode = normalizedCode.replace(/-\d+$/, '')
      ids.push(normalizedCode, baseCode)
    }

    const uniqCodes = [...new Set(ids.filter(Boolean))]
    const exts = ['png', 'webp', 'jpg', 'jpeg']
    return uniqCodes.flatMap((c) => exts.map((ext) => `/commercial-logos/${encodeURIComponent(c)}.${ext}`))
  }, [commercialName, normalizedCode, hideCodeInLogoUrl])

  const [srcIndex, setSrcIndex] = useState(0)

  useEffect(() => {
    setSrcIndex(0)
  }, [normalizedCode])

  const src = candidates[srcIndex] || ''
  const showImg = Boolean(src)

  const bgFallback = `linear-gradient(135deg, hsl(${hue} 90% 50%), hsl(${(hue + 35) % 360} 90% 50%))`
  const bg = showImg ? '#ffffff' : bgFallback

  return (
    <div
      className={[
        'rounded-2xl overflow-hidden border border-blue-200/70 bg-white shadow-[0_12px_26px_rgba(0,77,255,0.16)] flex items-center justify-center flex-shrink-0',
        className
      ].join(' ')}
      style={{ width: size, height: size, background: bg }}
      aria-label={label}
      title={label}
    >
      {showImg ? (
        <img
          src={src}
          alt=""
          className="w-full h-full object-contain bg-white"
          onError={() => setSrcIndex((i) => (i + 1 < candidates.length ? i + 1 : candidates.length))}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-white font-black tracking-tight" style={{ fontSize: Math.max(12, Math.floor(size * 0.34)) }}>
            {initials}
          </span>
        </div>
      )}
    </div>
  )
}
