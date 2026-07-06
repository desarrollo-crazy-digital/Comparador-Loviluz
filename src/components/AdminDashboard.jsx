import { useEffect, useState } from 'react'
import { BarChart3, Users, TrendingUp, Euro, Award, FileText } from 'lucide-react'
import Chart from 'react-apexcharts'
import LoadingExperience from './LoadingExperience'

const COLORS = ['#1e3a8a', '#334155', '#0f766e', '#475569', '#64748b', '#0369a1', '#4338ca', '#0f172a']
const UI_FONT = "'Space Grotesk', Inter, sans-serif"
const PERIOD_OPTIONS = [
  { value: '7d', label: 'Últimos 7 días', days: 7 },
  { value: '15d', label: 'Últimos 15 días', days: 15 },
  { value: '30d', label: 'Últimos 30 días', days: 30 },
  { value: 'all', label: 'Historial total', days: null }
]

function truncateLabel(label, max = 18) {
  const s = String(label ?? '')
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + '...'
}

function cleanLabel(value) {
  return String(value || '').trim()
}

function isValidSupplier(value) {
  const s = cleanLabel(value)
  if (!s) return false
  return s.toUpperCase() !== 'LOGOS'
}

function isValidProduct(value) {
  return cleanLabel(value).length > 0
}

function parseEventDate(row) {
  const raw = row?.timestamp || row?.created_at || row?.createdAt || ''
  const dt = new Date(raw)
  return Number.isFinite(dt.getTime()) ? dt : null
}

export default function AdminDashboard({ onBack }) {
  const [stats, setStats] = useState(null)
  const [allStats, setAllStats] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [commercialFilter, setCommercialFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('30d')
  const [loadError, setLoadError] = useState('')
  const [commercialNames, setCommercialNames] = useState({})
  const selectedPeriod = PERIOD_OPTIONS.find((p) => p.value === periodFilter) || PERIOD_OPTIONS[PERIOD_OPTIONS.length - 1]

  const displayCommercialName = (code) => {
    const key = String(code || '').trim()
    if (!key) return 'Comercial sin nombre'
    const found = Object.keys(commercialNames || {}).find(k => k.toLowerCase() === key.toLowerCase())
    return found ? String(commercialNames[found] || '').trim() || 'Comercial sin nombre' : 'Comercial sin nombre'
  }

  const loadStats = async (range = periodFilter) => {
    setIsLoading(true)
    setLoadError('')
    try {
      const [statsRes, namesRes, allRes] = await Promise.all([
        fetch(`/api/stats?range=${encodeURIComponent(range)}`),
        fetch('/api/comerciales-info').catch(() => null),
        fetch('/api/stats?range=all').catch(() => null)
      ])
      if (!statsRes.ok) throw new Error('Error al cargar estadísticas')
      const contentType = statsRes.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('La API /api/stats no devolvió JSON. En local usa `npm run dev:full`. En Vercel crea/activa la función /api/stats.')
      }
      const data = await statsRes.json()
      setStats(data)
      if (allRes && allRes.ok) {
        try {
          const full = await allRes.json()
          setAllStats(full || null)
        } catch (_) {}
      }

      if (namesRes && namesRes.ok) {
        try {
          const names = await namesRes.json()
          setCommercialNames(names || {})
        } catch (_) {}
      }
    } catch (err) {
      console.error('Error loading stats:', err)
      setLoadError(err.message || 'Error al cargar estadísticas')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadStats(periodFilter)
  }, [periodFilter])

  const handleCleanup = async () => {
    if (!stats) return
    let cleanupStats = stats
    try {
      const fullRes = await fetch('/api/stats?range=all')
      if (fullRes.ok) {
        const fullData = await fullRes.json()
        if (fullData && typeof fullData === 'object') cleanupStats = fullData
      }
    } catch {}

    const oldestComparison = cleanupStats.comparisons?.reduce((oldest, c) => {
      const date = new Date(c.timestamp)
      return !oldest || date < oldest ? date : oldest
    }, null)

    const oldestDownload = cleanupStats.downloads?.reduce((oldest, d) => {
      const date = new Date(d.timestamp)
      return !oldest || date < oldest ? date : oldest
    }, null)

    const oldestDate = [oldestComparison, oldestDownload].filter(Boolean).reduce((oldest, date) =>
      !oldest || date < oldest ? date : oldest
    , null)

    const daysOld = oldestDate ? Math.floor((new Date() - oldestDate) / (1000 * 60 * 60 * 24)) : 0

    const options = {
      '1': { days: 7, label: '1 semana' },
      '2': { days: 30, label: '1 mes' },
      '3': { days: 90, label: '3 meses' },
      '4': { days: 180, label: '6 meses' }
    }

    const info = `Estado actual:
- ${cleanupStats.comparisons?.length || 0} comparativas
- ${cleanupStats.downloads?.length || 0} descargas
- Datos más antiguos: ${daysOld} días

Eliminar datos más antiguos que:
1 = 1 semana (7 días)
2 = 1 mes (30 días)
3 = 3 meses (90 días)
4 = 6 meses (180 días)

Escribe el número:`

    const choice = window.prompt(info, '2')
    if (!choice || !options[choice]) return

    const { days, label } = options[choice]
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    const beforeComparisons = cleanupStats.comparisons?.length || 0
    const beforeDownloads = cleanupStats.downloads?.length || 0

    const newStats = {
      comparisons: cleanupStats.comparisons?.filter(c => new Date(c.timestamp) >= cutoff) || [],
      downloads: cleanupStats.downloads?.filter(d => new Date(d.timestamp) >= cutoff) || []
    }

    const removedComparisons = beforeComparisons - newStats.comparisons.length
    const removedDownloads = beforeDownloads - newStats.downloads.length

    if (removedComparisons === 0 && removedDownloads === 0) {
      alert(`No hay datos antiguos para eliminar.\n\nTodos tus datos tienen menos de ${days} días.\nDatos más antiguos: ${daysOld} días.`)
      return
    }

    if (!window.confirm(`Se eliminarán:\n- ${removedComparisons} comparativas\n- ${removedDownloads} descargas\n\n¿Continuar?`)) {
      return
    }

    try {
      let response = await fetch('/api/stats/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days })
      })
      if (!response.ok) {
        response = await fetch('/api/save-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stats: newStats,
            editor: sessionStorage.getItem('editorName') || 'Admin'
          })
        })
      }

      if (!response.ok) {
        const error = await response.text()
        throw new Error(error || 'Error al guardar')
      }

      alert(`Limpieza completada:\n- ${removedComparisons} comparativas eliminadas\n- ${removedDownloads} descargas eliminadas\n- Datos más antiguos que ${label} borrados`)
      await loadStats()
    } catch (err) {
      console.error('Cleanup error:', err)
      alert('Error al guardar: ' + err.message)
    }
  }

  if (loadError) {
    return (
      <div className="w-full px-6 md:px-10 py-10">
        <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-lg">
          <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-2">Panel Comercial</div>
          <div className="text-xl font-black text-slate-900 mb-2">No se pudieron cargar las estadísticas</div>
          <div className="text-sm text-slate-600 whitespace-pre-wrap">{loadError}</div>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => loadStats(periodFilter)}
              className="px-5 py-2.5 text-sm font-black uppercase tracking-wider bg-slate-900 text-white rounded-xl shadow hover:shadow-md transition-shadow"
            >
              Reintentar
            </button>
            <button
              onClick={onBack}
              className="px-5 py-2.5 text-sm font-black uppercase tracking-wider bg-white border-2 border-slate-200 text-slate-700 rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading || !stats) {
    return (
      <LoadingExperience
        title="Cargando panel admin"
        subtitle="Estamos preparando estadísticas y actividad del equipo."
      />
    )
  }

  const comparisons = commercialFilter === 'all'
    ? stats.comparisons
    : stats.comparisons?.filter(c => c.commercial === commercialFilter)

  const downloads = commercialFilter === 'all'
    ? stats.downloads
    : stats.downloads?.filter(d => d.commercial === commercialFilter)

  const commercialCounts = {}
  const supplierCounts = {}
  const productCounts = {}
  let totalSavings = 0
  let totalCommission = 0

  downloads?.forEach(d => {
    commercialCounts[d.commercial] = (commercialCounts[d.commercial] || 0) + 1
    const supplier = cleanLabel(d.supplier)
    const product = cleanLabel(d.product)
    if (isValidSupplier(supplier)) supplierCounts[supplier] = (supplierCounts[supplier] || 0) + 1
    if (isValidProduct(product)) productCounts[product] = (productCounts[product] || 0) + 1
    totalSavings += Math.abs(parseFloat(d.savings) || 0)
    totalCommission += parseFloat(d.commission) || 0
  })

  const topCommercials = Object.entries(commercialCounts)
    .map(([code, count]) => ({ code, name: displayCommercialName(code), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  const topSuppliers = Object.entries(supplierCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const topProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)

  const totalPdfs = downloads?.length || 0
  const avgCommissionPerPdf = totalPdfs > 0 ? totalCommission / totalPdfs : 0
  const avgAnnualSavingsPerPdf = totalPdfs > 0 ? totalSavings / totalPdfs : 0
  const totalSupplierDownloads = Object.values(supplierCounts).reduce((acc, value) => acc + value, 0)
  const conversionRate = (comparisons?.length || 0) > 0 ? ((downloads?.length || 0) * 100) / (comparisons?.length || 1) : 0
  const previousWindow = (() => {
    if (!selectedPeriod.days || !allStats) return null
    const dayMs = 24 * 60 * 60 * 1000
    const now = Date.now()
    const days = selectedPeriod.days
    const currentStart = now - (days * dayMs)
    const prevStart = now - (2 * days * dayMs)

    const inPrevWindow = (row) => {
      const t = parseEventDate(row)?.getTime() || 0
      return t >= prevStart && t < currentStart
    }
    const byCommercial = (row) => commercialFilter === 'all' || row?.commercial === commercialFilter

    const prevDownloadsRows = (allStats.downloads || []).filter((d) => byCommercial(d) && inPrevWindow(d))
    const prevComparisonsRows = (allStats.comparisons || []).filter((c) => byCommercial(c) && inPrevWindow(c))
    const prevDownloads = prevDownloadsRows.length
    const prevComparisons = prevComparisonsRows.length
    const prevSavings = prevDownloadsRows.reduce((acc, d) => acc + Math.abs(parseFloat(d?.savings) || 0), 0)
    const prevCommission = prevDownloadsRows.reduce((acc, d) => acc + (parseFloat(d?.commission) || 0), 0)

    return {
      downloads: prevDownloads,
      comparisons: prevComparisons,
      savings: prevSavings,
      commission: prevCommission
    }
  })()

  const deltaText = (current, previous) => {
    if (!selectedPeriod.days || !previousWindow) return 'vs periodo anterior: —'
    const prev = Number(previous) || 0
    const curr = Number(current) || 0
    if (prev === 0) return curr === 0 ? 'vs periodo anterior: 0%' : 'vs periodo anterior: nuevo'
    const pct = ((curr - prev) * 100) / prev
    const sign = pct > 0 ? '+' : ''
    return `vs periodo anterior: ${sign}${pct.toFixed(1)}%`
  }

  const today = new Date()
  const todayDownloads = (downloads || []).filter((d) => {
    const dt = parseEventDate(d)
    return dt ? dt.toDateString() === today.toDateString() : false
  }).length
  const todayComparisons = (comparisons || []).filter((c) => {
    const dt = parseEventDate(c)
    return dt ? dt.toDateString() === today.toDateString() : false
  }).length

  const fullCommercialData = {}
  const allComparisons = stats.comparisons || []
  const allDownloads = stats.downloads || []

  allDownloads.forEach(d => {
    if (!d.commercial) return
    if (!fullCommercialData[d.commercial]) {
      fullCommercialData[d.commercial] = { downloads: 0, comparisons: 0, savings: 0, commission: 0 }
    }
    fullCommercialData[d.commercial].downloads++
    fullCommercialData[d.commercial].savings += Math.abs(parseFloat(d.savings) || 0)
    fullCommercialData[d.commercial].commission += parseFloat(d.commission) || 0
  })
  allComparisons.forEach(c => {
    if (!c.commercial) return
    if (!fullCommercialData[c.commercial]) {
      fullCommercialData[c.commercial] = { downloads: 0, comparisons: 0, savings: 0, commission: 0 }
    }
    fullCommercialData[c.commercial].comparisons++
  })

  const commercialRanking = Object.entries(fullCommercialData)
    .map(([code, data]) => ({
      code,
      name: displayCommercialName(code),
      ...data,
      total: data.downloads + data.comparisons
    }))
    .sort((a, b) => b.total - a.total)
  const maxRankingTotal = commercialRanking.reduce((max, item) => Math.max(max, item.total || 0), 0)

  const activityWindowDays = selectedPeriod.days || 30
  const activityChartData = []
  for (let i = activityWindowDays - 1; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
    const count = downloads?.filter(d => {
      const dDate = parseEventDate(d)
      if (!dDate) return false
      return dDate.toDateString() === date.toDateString()
    }).length || 0
    activityChartData.push({ date: dateStr, descargas: count })
  }

  const allCommercialCodes = new Set()
  stats.downloads?.forEach(d => d.commercial && allCommercialCodes.add(d.commercial))
  stats.comparisons?.forEach(c => c.commercial && allCommercialCodes.add(c.commercial))
  const allCommercialOptions = Array.from(allCommercialCodes)
    .map((code) => ({ code, name: displayCommercialName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))

  const topCommercialsChartOptions = {
    chart: {
      type: 'bar',
      toolbar: { show: false },
      fontFamily: UI_FONT,
      animations: { enabled: true, easing: 'easeinout', speed: 800 }
    },
    plotOptions: {
      bar: {
        horizontal: false,
        borderRadius: 6,
        columnWidth: '55%',
        distributed: true,
        dataLabels: { position: 'top' }
      }
    },
    colors: COLORS,
    dataLabels: {
      enabled: true,
      offsetY: -20,
      style: { fontSize: '11px', fontWeight: 700, colors: ['#475569'] }
    },
    xaxis: {
      categories: topCommercials.map((item) => item.name),
      labels: {
        style: { colors: '#94a3b8', fontSize: '10px', fontWeight: 600 },
        rotate: -60,
        rotateAlways: true,
        hideOverlappingLabels: false,
        trim: false,
        maxHeight: 140
      },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: { style: { colors: '#94a3b8', fontSize: '11px' } },
      min: 0,
      forceNiceScale: true
    },
    grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
    tooltip: { theme: 'dark', y: { formatter: (v) => `${v} descargas` } },
    legend: { show: false }
  }
  const topCommercialsChartSeries = [{
    name: 'Descargas',
    data: topCommercials.map((item) => item.count)
  }]

  const activityLineOptions = {
    chart: {
      type: 'line',
      toolbar: { show: false },
      fontFamily: UI_FONT,
      animations: { enabled: true, easing: 'easeinout', speed: 800 }
    },
    colors: ['#2563eb'],
    stroke: { curve: 'smooth', width: 3 },
    markers: { size: 4, strokeWidth: 2, strokeColors: '#fff', hover: { size: 6 } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: activityChartData.map(d => d.date),
      labels: { style: { colors: '#94a3b8', fontSize: '11px', fontWeight: 500 } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: { style: { colors: '#94a3b8', fontSize: '11px' } },
      min: 0,
      forceNiceScale: true
    },
    grid: { borderColor: '#e2e8f0', strokeDashArray: 3 },
    tooltip: { theme: 'dark', y: { formatter: (v) => `${v} descargas` } }
  }
  const activityLineSeries = [{ name: 'Descargas', data: activityChartData.map(d => d.descargas) }]

  const supplierBarOptions = {
    chart: {
      type: 'bar',
      toolbar: { show: false },
      fontFamily: UI_FONT,
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 6,
        barHeight: '58%',
        distributed: true,
        dataLabels: { position: 'right' }
      }
    },
    colors: ['#3358b8', '#4f6fbd', '#6b84c3', '#8aa0cd', '#a7bad6', '#c2d1df', '#d6e2e9', '#e7edf2'],
    dataLabels: {
      enabled: true,
      textAnchor: 'start',
      formatter: (val, opts) => {
        const item = topSuppliers[opts?.dataPointIndex] || ['', 0]
        const pct = totalSupplierDownloads > 0 ? Math.round((item[1] * 100) / totalSupplierDownloads) : 0
        return `${val} · ${pct}%`
      },
      offsetX: 5,
      style: { fontSize: '11px', fontWeight: 700, colors: ['#334155'] }
    },
    xaxis: {
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: {
        style: { colors: '#475569', fontSize: '12px', fontWeight: 600 },
        formatter: (v) => truncateLabel(v, 18)
      }
    },
    grid: { show: false },
    tooltip: { theme: 'dark', y: { formatter: (v) => `${v} descargas` } },
    legend: { show: false }
  }
  const supplierBarSeries = [{
    name: 'Descargas',
    data: topSuppliers.map(([name, value]) => ({ x: name, y: value }))
  }]

  const radialSeries = [Number(conversionRate.toFixed(1))]
  const radialOptions = {
    chart: {
      type: 'radialBar',
      fontFamily: UI_FONT,
      sparkline: { enabled: true }
    },
    colors: ['#0ea5e9'],
    plotOptions: {
      radialBar: {
        startAngle: -120,
        endAngle: 240,
        hollow: { size: '64%' },
        track: { background: '#dbeafe' },
        dataLabels: {
          name: { show: true, fontSize: '11px', color: '#64748b', offsetY: 20 },
          value: {
            show: true,
            formatter: (v) => `${Number(v).toFixed(1)}%`,
            fontSize: '24px',
            fontWeight: 800,
            color: '#0f172a',
            offsetY: -8
          }
        }
      }
    },
    labels: ['Descarga/Comparativa']
  }

  const treemapOptions = {
    chart: {
      type: 'treemap',
      toolbar: { show: false },
      fontFamily: UI_FONT
    },
    legend: { show: false },
    dataLabels: {
      enabled: true,
      style: { fontSize: '11px', fontWeight: 700 },
      formatter: (text, opts) => `${text}\n${opts?.value ?? 0}`
    },
    colors: ['#38bdf8'],
    plotOptions: {
      treemap: {
        distributed: true,
        enableShades: true,
        shadeIntensity: 0.45
      }
    },
    tooltip: { y: { formatter: (v) => `${v} descargas` } }
  }
  const treemapSeries = [{
    data: topProducts.map(([name, value]) => ({ x: truncateLabel(name, 28), y: value }))
  }]

  return (
    <div className="dashboard-shell w-full px-6 md:px-10 py-8 rounded-3xl">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1 h-8 bg-gradient-to-b from-blue-600 to-purple-600 rounded-full"></div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Administración</div>
                <div className="text-3xl font-bold text-slate-900">Panel Comercial</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} className="dashboard-select">
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={commercialFilter} onChange={(e) => setCommercialFilter(e.target.value)} className="dashboard-select">
              <option value="all">Todos los comerciales</option>
              {allCommercialOptions.map(({ code, name }) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            <button onClick={() => loadStats(periodFilter)} className="dashboard-button transition-all">Actualizar</button>
            <button onClick={handleCleanup} className="dashboard-button bg-slate-700 text-white border-0 transition-all">Limpiar datos</button>
            <button onClick={onBack} className="dashboard-button bg-slate-900 text-white border-0 transition-all">Volver</button>
          </div>
        </div>

        <div className="dashboard-panel mb-6 px-5 py-4">
          <div className="text-[11px] font-black uppercase tracking-wider text-blue-900/70">Nota importante</div>
          <div className="mt-1 text-xs text-slate-700">
            Estas estadisticas se basan en <span className="font-bold">descargas</span> desde el comparador.
            No equivalen a contratos firmados (un comercial puede descargar y no cerrar la venta).
          </div>
          <div className="mt-2 text-[11px] font-semibold text-blue-900/70">Rango activo: {selectedPeriod.label}</div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="dashboard-panel p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Descargas</div>
            <div className="mt-1 text-3xl font-black text-slate-900">{downloads?.length || 0}</div>
            <div className="mt-1 text-xs text-slate-500">Hoy: {todayDownloads}</div>
            <div className="mt-1 text-[11px] font-semibold text-slate-600">{deltaText(downloads?.length || 0, previousWindow?.downloads || 0)}</div>
          </div>
          <div className="dashboard-panel p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Comparativas</div>
            <div className="mt-1 text-3xl font-black text-slate-900">{comparisons?.length || 0}</div>
            <div className="mt-1 text-xs text-slate-500">Hoy: {todayComparisons}</div>
            <div className="mt-1 text-[11px] font-semibold text-slate-600">{deltaText(comparisons?.length || 0, previousWindow?.comparisons || 0)}</div>
          </div>
          <div className="dashboard-panel p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Ahorro total</div>
            <div className="mt-1 text-3xl font-black text-slate-900">€{Math.round(totalSavings).toLocaleString('es-ES')}</div>
            <div className="mt-1 text-xs text-slate-500">Media: €{Math.round(avgAnnualSavingsPerPdf).toLocaleString('es-ES')}/descarga</div>
            <div className="mt-1 text-[11px] font-semibold text-slate-600">{deltaText(totalSavings, previousWindow?.savings || 0)}</div>
          </div>
          <div className="dashboard-panel p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Comisiones</div>
            <div className="mt-1 text-3xl font-black text-slate-900">€{Math.round(totalCommission).toLocaleString('es-ES')}</div>
            <div className="mt-1 text-xs text-slate-500">Media: €{Math.round(avgCommissionPerPdf).toLocaleString('es-ES')}/descarga</div>
            <div className="mt-1 text-[11px] font-semibold text-slate-600">{deltaText(totalCommission, previousWindow?.commission || 0)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
          <div className="dashboard-panel p-5 lg:col-span-3">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Conversión</div>
                <div className="text-xs text-slate-500 mt-1">Ratio descarga/comparativa</div>
              </div>
              <Award size={20} className="text-slate-500" />
            </div>
            <Chart options={radialOptions} series={radialSeries} type="radialBar" height={240} />
          </div>

          <div className="dashboard-panel p-5 lg:col-span-9">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">
                  {commercialFilter === 'all' ? 'Descargas por comercial' : 'Evolución de descargas'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {commercialFilter === 'all'
                    ? `Top comerciales (${selectedPeriod.label.toLowerCase()})`
                    : `${displayCommercialName(commercialFilter)} · ${selectedPeriod.label.toLowerCase()}`}
                </div>
              </div>
              <BarChart3 size={20} className="text-slate-500" />
            </div>
            {commercialFilter === 'all' ? (
              topCommercials.length > 0 ? (
                <Chart options={topCommercialsChartOptions} series={topCommercialsChartSeries} type="bar" height={240} />
              ) : (
                <div className="flex items-center justify-center h-[240px] text-slate-400 text-sm">No hay datos de comerciales aún</div>
              )
            ) : (
              <Chart options={activityLineOptions} series={activityLineSeries} type="line" height={240} />
            )}
          </div>

          <div className="dashboard-panel p-5 lg:col-span-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Top comercializadoras</div>
                <div className="text-xs text-slate-500 mt-1">Descargas y cuota</div>
              </div>
              <TrendingUp size={20} className="text-slate-500" />
            </div>
            {topSuppliers.length > 0 ? (
              <Chart options={supplierBarOptions} series={supplierBarSeries} type="bar" height={230} />
            ) : (
              <div className="flex items-center justify-center h-[230px] text-slate-400 text-sm">No hay datos de comercializadoras aún</div>
            )}
          </div>

          <div className="dashboard-panel p-5 lg:col-span-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Top productos</div>
                <div className="text-xs text-slate-500 mt-1">Distribución por descargas</div>
              </div>
              <FileText size={20} className="text-slate-500" />
            </div>
            {topProducts.length > 0 ? (
              <Chart options={treemapOptions} series={treemapSeries} type="treemap" height={230} />
            ) : (
              <div className="flex items-center justify-center h-[230px] text-slate-400 text-sm">No hay productos aún</div>
            )}
          </div>
        </div>

        <div className="dashboard-panel p-6 mb-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Ranking Completo de Comerciales</div>
              <div className="text-xs text-slate-500 mt-1">{commercialRanking.length} comerciales ordenados por actividad total ({selectedPeriod.label.toLowerCase()})</div>
            </div>
            <Users size={20} className="text-slate-500" />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-2 text-[10px] font-black uppercase tracking-wider text-slate-500">#</th>
                  <th className="text-left py-3 px-2 text-[10px] font-black uppercase tracking-wider text-slate-500">Comercial</th>
                  <th className="text-center py-3 px-2 text-[10px] font-black uppercase tracking-wider text-slate-500">Comparativas</th>
                  <th className="text-center py-3 px-2 text-[10px] font-black uppercase tracking-wider text-slate-500">Descargas</th>
                  <th className="text-right py-3 px-2 text-[10px] font-black uppercase tracking-wider text-slate-500 hidden lg:table-cell">Ahorro</th>
                  <th className="text-right py-3 px-2 text-[10px] font-black uppercase tracking-wider text-slate-500 hidden lg:table-cell">Comisiones</th>
                  <th className="text-center py-3 px-2 text-[10px] font-black uppercase tracking-wider text-slate-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {commercialRanking.map((item, idx) => {
                  const isTop3 = idx < 3
                  const barWidth = maxRankingTotal > 0 ? Math.max(6, Math.round((item.total * 100) / maxRankingTotal)) : 0
                  return (
                    <tr key={item.code} className={`border-b border-slate-100 hover:bg-slate-50/80 transition-colors ${isTop3 ? 'bg-gradient-to-r from-amber-50/40 to-transparent' : ''}`}>
                      <td className="py-3 px-2">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${isTop3 ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>{idx + 1}</span>
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-bold text-slate-800 truncate max-w-[220px]">{item.name}</div>
                        <div className="mt-1 h-1.5 w-36 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${barWidth}%` }} />
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center"><span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg font-black">{item.comparisons}</span></td>
                      <td className="py-3 px-2 text-center"><span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg font-black">{item.downloads}</span></td>
                      <td className="py-3 px-2 text-right hidden lg:table-cell"><span className="text-sm font-bold text-slate-700">€{Math.round(item.savings).toLocaleString()}</span></td>
                      <td className="py-3 px-2 text-right hidden lg:table-cell"><span className="text-sm font-bold text-amber-700">€{Math.round(item.commission).toLocaleString()}</span></td>
                      <td className="py-3 px-2 text-center">
                        <span className={`text-xs px-3 py-1.5 rounded-lg font-black ${isTop3 ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                          {item.total}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {commercialRanking.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">No hay datos de comerciales aún</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dashboard-panel p-6">
          <div className="text-xs font-black uppercase tracking-wider text-slate-600 mb-4">Gestión</div>
          <div className="grid md:grid-cols-3 gap-4">
            <a href="/admin.html" className="px-4 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-700 text-center hover:border-blue-400 hover:bg-blue-50 transition-all">
              Editar tarifas y cargar Excel/PDF
            </a>
            <a href="/admin.html?tab=comisiones" className="px-4 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-700 text-center hover:border-purple-400 hover:bg-purple-50 transition-all">
              Editar comisiones
            </a>
            <a href="/admin.html?tab=comerciales" className="px-4 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-700 text-center hover:border-emerald-400 hover:bg-emerald-50 transition-all">
              Comerciales
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
