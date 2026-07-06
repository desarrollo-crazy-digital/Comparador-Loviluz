import { useEffect, useRef, useState } from 'react'

function hexToRgba(hex, alpha) {
  const cleaned = String(hex || '').replace('#', '').trim()
  const safe = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned
  if (!/^[0-9a-fA-F]{6}$/.test(safe)) return `rgba(59,130,246,${alpha})`
  const r = parseInt(safe.slice(0, 2), 16)
  const g = parseInt(safe.slice(2, 4), 16)
  const b = parseInt(safe.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function AnimatedCounter({ value, prefix = '', suffix = '', duration = 1200 }) {
  const [display, setDisplay] = useState(0)
  const prevValue = useRef(0)

  useEffect(() => {
    const start = prevValue.current
    const end = typeof value === 'number' ? value : parseFloat(value) || 0
    if (start === end) { setDisplay(end); return }

    const startTime = performance.now()
    const step = (timestamp) => {
      const progress = Math.min((timestamp - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      const current = Math.round(start + (end - start) * eased)
      setDisplay(current)
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    prevValue.current = end
  }, [value, duration])

  return <>{prefix}{display.toLocaleString()}{suffix}</>
}

export default function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  accentColor = '#3b82f6',
  prefix = '',
  suffix = '',
  delay = 0
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  const tintSoft = hexToRgba(accentColor, 0.10)
  const tintMid = hexToRgba(accentColor, 0.18)
  const tintGlow = hexToRgba(accentColor, 0.22)

  const numericValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/92 p-5 shadow-[0_14px_42px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      style={{
        transitionDelay: `${delay}ms`,
        borderColor: tintMid
      }}
    >
      <div className="absolute inset-0 opacity-70" style={{
        background: `linear-gradient(145deg, rgba(255,255,255,0.97) 0%, ${tintSoft} 58%, rgba(255,255,255,0.92) 100%)`
      }} />
      <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full blur-2xl" style={{ backgroundColor: tintGlow }} />
      <div className="absolute -left-8 bottom-2 h-20 w-20 rounded-full blur-xl" style={{ backgroundColor: tintSoft }} />
      
      <div className="relative z-10">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div>
            {subtitle && <div className="mt-1 text-[11px] font-medium text-slate-500">{subtitle}</div>}
          </div>
          {Icon && (
            <div className="h-10 w-10 rounded-xl border flex items-center justify-center" style={{ backgroundColor: tintSoft, borderColor: tintMid }}>
              <Icon size={18} className="text-slate-700" />
            </div>
          )}
        </div>

        <div className="mb-1 flex items-end justify-between gap-3">
          <div className="text-3xl font-black tracking-tight text-slate-900 leading-none">
            <AnimatedCounter value={numericValue} prefix={prefix} suffix={suffix} />
          </div>
        </div>
      </div>
    </div>
  )
}
