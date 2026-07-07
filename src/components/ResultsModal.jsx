
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, ArrowLeft, TrendingUp, Award, Eye, EyeOff, RotateCcw, Filter, Zap, BarChart3, Star } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { generatePDF } from '../utils/pdfGenerator'
import { generateComparePdf } from '../utils/comparePdf'
import { clearPdfDownloads, getPdfDownloads } from '../utils/pdfDownloadStore'
import { gaEvent } from '../utils/analytics'
import { formatProductDisplayName } from '../utils/productDisplay'
import LoadingExperience from './LoadingExperience'

export default function ResultsModal({ results, formData, onClose, initialShowCommissions = false, commercialCode = '', commercialName = '', hideCommissions = false }) {
    const isGas = (formData?.energyType || '').toLowerCase() === 'gas'
    const [selectedSupplierFilter, setSelectedSupplierFilter] = useState('all')
    const [showCommissions, setShowCommissions] = useState(Boolean(initialShowCommissions) && !hideCommissions)
    const [sortMode, setSortMode] = useState('savings') // savings | commission | recommended
    const [expandedRow, setExpandedRow] = useState(null)
    const [showAll, setShowAll] = useState(false)
    const [showScrollTop, setShowScrollTop] = useState(false)
    const [selectedOfferIndex, setSelectedOfferIndex] = useState(0) // Track selected offer for header
    const [compareSelection, setCompareSelection] = useState([])
    const [showCompare, setShowCompare] = useState(false)
    const [showHistory, setShowHistory] = useState(false)
    const [historyItems, setHistoryItems] = useState([])
    const [pdfSearch, setPdfSearch] = useState('')
    const [historyLoading, setHistoryLoading] = useState(false)
    const listRef = useRef(null)
    const getDisplayProductName = useCallback((offer) => {
        if (!offer) return ''
        return formatProductDisplayName(offer.supplier, offer.productName || offer.product || '')
    }, [])

    // Filter Logic
    const suppliers = useMemo(() => {
        if (!results) return ['all'];
        const EPS_SAVINGS = 0.01
        const unique = new Set(
            results
                .filter(r => Number(r?.savings) > EPS_SAVINGS)
                .map(r => r.supplier)
        )
        return ['all', ...Array.from(unique)].sort()
    }, [results])

        const clamp01 = useCallback((n) => Math.max(0, Math.min(1, n)), [])
	        const percentile = useCallback((arr, p) => {
	            const nums = arr.filter(Number.isFinite).sort((a, b) => a - b)
	            if (nums.length === 0) return 1
	            const idx = Math.max(0, Math.min(nums.length - 1, Math.floor((nums.length - 1) * p)))
	            return nums[idx] || 1
	        }, [])

	        const commissionValue = useCallback((item) => {
	            const raw =
	                item?.commission ??
	                item?.comisionAmount ??
	                item?.comision ??
	                item?.commissionAmount ??
	                item?.commissionBase ??
	                item?.comisionBase ??
	                0
	            const num = Number(raw)
	            return Number.isFinite(num) ? num : 0
	        }, [])

        const sortByRecommended = useCallback((list) => {
            const savingsArr = list.map(r => Number(r.savings)).filter(Number.isFinite)
            const commissions = list.map(r => commissionValue(r)).filter(Number.isFinite)
            const hasCommissions = commissions.length > 0 && commissions.some(v => v > 0)

            if (!hasCommissions) {
                return [...list].sort((a, b) => (b.savings || 0) - (a.savings || 0))
            }

            const savingsP95 = percentile(savingsArr, 0.95)
            const commP95 = percentile(commissions, 0.95)
            const denomSavings = savingsP95 > 0 ? savingsP95 : 1
            const denomComm = commP95 > 0 ? commP95 : 1
            const eps = 1e-9

            const savingsP50 = percentile(savingsArr, 0.5)
            const commP50 = percentile(commissions, 0.5)

            const scored = list.map(item => {
                const sVal = Number(item.savings) || 0
                const cVal = commissionValue(item) || 0
                const sNorm = clamp01(sVal / denomSavings)
                const cNorm = clamp01(cVal / denomComm)
                const score = (2 * sNorm * cNorm) / (sNorm + cNorm + eps)
                return { item, sVal, cVal, score }
            })

            const balanced = scored.filter(i => i.cVal > 0 && i.sVal >= savingsP50 && i.cVal >= commP50)

            const sortByScore = (a, b) => {
                if (b.score !== a.score) return b.score - a.score
                return b.sVal - a.sVal
            }

            balanced.sort(sortByScore)
            const ordered = balanced.length > 0 ? balanced : scored.sort(sortByScore)
            return ordered.map(i => i.item)
        }, [clamp01, percentile])

        const baseFilteredResults = useMemo(() => {
            if (!results) return []
            const EPS_SAVINGS = 0.01 // evitar mostrar ofertas "sin ahorro" por ruido de decimales
            let filtered = [...results].filter(r => Number(r?.savings) > EPS_SAVINGS)
	        if (selectedSupplierFilter !== 'all') {
	            filtered = filtered.filter(r => r.supplier === selectedSupplierFilter)
	        }
            return filtered
        }, [results, selectedSupplierFilter])

	    const filteredResults = useMemo(() => {
	        const filtered = baseFilteredResults

	        if (sortMode === 'savings') {
	            return [...filtered].sort((a, b) => (b.savings || 0) - (a.savings || 0))
	        }

	        if (sortMode === 'commission') {
	            return [...filtered].sort((a, b) => (commissionValue(b) || 0) - (commissionValue(a) || 0))
	        }

	        if (sortMode === 'recommended') {
	            return sortByRecommended(filtered)
	        }

	        return filtered
	    }, [baseFilteredResults, sortByRecommended, sortMode])

        const limit = showAll ? filteredResults.length : 15
        const displayedResults = useMemo(() => {
            if (!filteredResults) return []
            return filteredResults.slice(0, limit)
        }, [filteredResults, limit])

        useEffect(() => {
            setSelectedOfferIndex(0)
            setExpandedRow(null)
            // Cada orden (Ahorro / Comision / Equilibrada) debe empezar desde arriba.
            const el = listRef.current
            if (el) el.scrollTop = 0
            setShowScrollTop(false)
        }, [sortMode, selectedSupplierFilter, showCommissions])

        useEffect(() => {
            if (selectedOfferIndex >= displayedResults.length) setSelectedOfferIndex(0)
        }, [displayedResults.length, selectedOfferIndex])

        useEffect(() => {
            let active = true
            if (!showHistory) return () => { active = false }
            ;(async () => {
                setHistoryLoading(true)
                try {
                    const items = await getPdfDownloads({ commercialCode, query: pdfSearch, days: 7 })
                    if (active) setHistoryItems(items)
                } catch (err) {
                    console.error('Error loading history:', err)
                } finally {
                    if (active) setHistoryLoading(false)
                }
            })()
            return () => { active = false }
        }, [showHistory, commercialCode, results, pdfSearch])

	    const selectedOffer = displayedResults[selectedOfferIndex] || displayedResults[0]
        const handleScroll = useCallback(() => {
            const el = listRef.current
            if (!el) return
            setShowScrollTop(el.scrollTop > 300)
        }, [])
        const scrollToTop = useCallback(() => {
            const el = listRef.current
            if (!el) return
            el.scrollTo({ top: 0, behavior: 'smooth' })
        }, [])

        const offerKey = useCallback((offer) => `${offer?.supplier || ''}::${offer?.productName || ''}`, [])
        const selectedOffers = useMemo(() => {
            const map = new Map()
            baseFilteredResults.forEach(o => map.set(offerKey(o), o))
            return compareSelection.map(key => map.get(key)).filter(Boolean)
        }, [baseFilteredResults, compareSelection, offerKey])
        const toggleCompare = useCallback((offer) => {
            const key = offerKey(offer)
            setCompareSelection(prev => {
                if (prev.includes(key)) return prev.filter(k => k !== key)
                if (prev.length >= 3) return prev
                return [...prev, key]
            })
        }, [offerKey])
        const clearCompareSelection = useCallback(() => setCompareSelection([]), [])
        const openCompare = useCallback(() => {
            if (selectedOffers.length < 2) return
            setShowCompare(true)
        }, [selectedOffers])
        const closeCompare = useCallback(() => setShowCompare(false), [])
        const refreshHistory = useCallback(async () => {
            setHistoryLoading(true)
            try {
                const items = await getPdfDownloads({ commercialCode, query: pdfSearch, days: 7 })
                setHistoryItems(items)
            } catch (err) {
                console.error('Error refreshing history:', err)
            } finally {
                setHistoryLoading(false)
            }
        }, [commercialCode, pdfSearch])

        const redownloadHistoryPdf = useCallback(async (item) => {
            if (!item?.formData || !item?.offer) return
            await generatePDF(item.formData, item.offer, {
                commercialCode,
                commercialName,
                fromHistory: true
            })
        }, [commercialCode, commercialName])

        const downloadComparePdf = useCallback(async () => {
            if (selectedOffers.length < 2) return
            await generateComparePdf({ offers: selectedOffers, showCommissions })
        }, [selectedOffers, showCommissions])

	        const handlePdfDownload = useCallback(async (offer) => {
	            gaEvent('offer_pdf_download', {
	                energy_type: (formData?.energyType || '').toLowerCase() === 'gas' ? 'gas' : 'electricidad',
	                tariff_type: formData?.tariffType || '',
	                region: formData?.region || '',
	                supplier: offer?.supplier || '',
	                product: offer?.productName || offer?.product || '',
	                offer_total: Number(offer?.total) || 0,
	                offer_savings: Number(offer?.savings) || 0
	            })
	            await generatePDF(formData, offer, { commercialCode, commercialName })
	            try {
	                await refreshHistory()
	            } catch (err) {
	                console.error('Error refreshing history:', err)
	            }
	        }, [commercialCode, commercialName, formData, refreshHistory])

	    if (!results || results.length === 0) return null;
	
	    const formatEUR = (value, decimals = 2) => {
	        const num = Number(value)
	        if (!Number.isFinite(num)) return '-'
	        return num.toFixed(decimals)
	    }

        const formatPercent = (value, decimals = 2) => {
            const num = Number(value)
            if (!Number.isFinite(num)) return (0).toFixed(decimals)
            return num.toFixed(decimals)
        }
	
	    const currentBill = Number(formData?.currentBill)
	    const currentBillText = Number.isFinite(currentBill) ? currentBill.toFixed(2) : '-'
	
	    const baseImponible = (offer) => {
	        const subtotal = Number(offer?.details?.subtotal)
	        const tax = Number(offer?.details?.electricityTax)
	        const s = Number.isFinite(subtotal) ? subtotal : 0
	        const t = Number.isFinite(tax) ? tax : 0
	        return s + t
	    }

	    return (
	        <AnimatePresence>
	            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 results-backdrop backdrop-blur-sm flex items-center justify-center px-0 py-0 sm:px-4 sm:py-10"
                onClick={onClose}
            >
                <motion.div 
                    initial={{ y: '100%', opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: '100%', opacity: 0 }}
                    transition={{ type: 'spring', damping: 25 }}
                    className="w-[100vw] sm:w-full max-w-full sm:max-w-6xl h-[100dvh] sm:h-[calc(100dvh-7rem)] rounded-none sm:rounded-3xl bg-white shadow-2xl flex flex-col overflow-hidden"
                    onClick={e => e.stopPropagation()}
                >

	                {/* 1. Header Summary */}
	                <div className="bg-gradient-to-br from-[#ff8534] via-[#ff6b00] to-[#e85d00] text-white px-4 md:px-6 pt-3 md:pt-4 pb-4 md:pb-5 relative shrink-0 rounded-b-[2.25rem] z-30 shadow-2xl shadow-orange-900/25 overflow-hidden">
	                    <div className="absolute inset-0 opacity-30 pointer-events-none">
	                        <div className="absolute -top-24 -right-20 w-[420px] h-[420px] bg-white/15 rounded-full blur-3xl"></div>
	                        <div className="absolute -bottom-28 -left-24 w-[520px] h-[520px] bg-amber-200/15 rounded-full blur-3xl"></div>
	                    </div>
	                    <div className="flex justify-between items-start mb-3 md:mb-4">
	                        <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
	                            <div className="w-8 h-8 md:w-10 md:h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 flex-shrink-0">
	                                <Award size={16} className="md:w-5 md:h-5 text-yellow-300 drop-shadow-sm" />
	                            </div>
	                            <div className="min-w-0">
	                                <h2 className="font-bold text-sm md:text-lg leading-tight tracking-tight truncate">{formData.clientName || 'Cliente'}</h2>
	                                <div className="text-orange-50/90 text-[10px] md:text-xs font-medium tracking-wide truncate">{formData.cups ? formData.cups : 'Sin CUPS'}</div>
	                            </div>
	                        </div>
	                        <div className="flex gap-1.5 md:gap-2 flex-shrink-0">
		                             {!hideCommissions && (
		                               <button onClick={() => setShowCommissions(!showCommissions)} className="px-2 md:px-3 py-1 md:py-1.5 bg-white/15 hover:bg-white/25 text-[9px] md:text-[10px] font-black uppercase tracking-wide md:tracking-wider rounded-lg border border-white/20 backdrop-blur-sm transition-colors">
		                                  {showCommissions ? 'Ocultar comisión' : 'Comisión'}
		                               </button>
		                             )}
		                             <button
		                                onClick={onClose}
		                                className="inline-flex items-center gap-1.5 px-2 md:px-3 py-1 md:py-1.5 bg-white/15 hover:bg-white/25 text-[9px] md:text-[10px] font-black uppercase tracking-wide md:tracking-wider rounded-lg border border-white/20 backdrop-blur-sm transition-colors"
		                                title="Volver al formulario"
		                             >
		                                <ArrowLeft size={14} className="md:w-4 md:h-4" />
		                                Volver
		                             </button>
		                        </div>
	                    </div>

	                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
	                        <div className="bg-white/12 rounded-xl md:rounded-2xl p-2 md:p-3 border border-white/20 backdrop-blur-sm">
	                            <div className="text-white/70 text-[8px] md:text-[10px] font-black uppercase tracking-wider mb-0.5 md:mb-1">Actual</div>
	                            <div className="text-base md:text-2xl font-extrabold tracking-tight">€{currentBillText}</div>
	                        </div>
	                        <div className="bg-white/12 rounded-xl md:rounded-2xl p-2 md:p-3 border border-white/20 backdrop-blur-sm">
	                            <div className="text-white/70 text-[8px] md:text-[10px] font-black uppercase tracking-wider mb-0.5 md:mb-1">Propuesta</div>
	                            <div className="text-base md:text-2xl font-extrabold tracking-tight">€{formatEUR(selectedOffer?.total, 2)}</div>
	                        </div>
	                        <div className="bg-white/12 rounded-xl md:rounded-2xl p-2 md:p-3 border border-white/20 backdrop-blur-sm">
	                            <div className="text-white/70 text-[8px] md:text-[10px] font-black uppercase tracking-wider mb-0.5 md:mb-1">Ahorro Factura</div>
	                            <div className="text-base md:text-2xl font-extrabold tracking-tight truncate">€{formatEUR(selectedOffer?.savings, 2)}</div>
	                        </div>
		                        <div className="bg-white/12 rounded-xl md:rounded-2xl p-2 md:p-3 border border-white/20 backdrop-blur-sm relative overflow-hidden">
		                            <div className="text-white/70 text-[8px] md:text-[10px] font-black uppercase tracking-wider mb-0.5 md:mb-1">Ahorro Anual</div>
		                            <div className="results-annual-amount text-base md:text-2xl font-extrabold tracking-tight truncate">
		                                €{formatEUR(selectedOffer?.annualSavings, 0)}
		                            </div>
		                            <div className="absolute top-2 right-2 px-2 py-1 bg-yellow-300 text-yellow-950 text-[10px] font-black rounded-lg border border-yellow-200 shadow-lg shadow-yellow-300/30 rotate-3">
		                                {formatPercent(selectedOffer?.savingsPercent, 2)}%
		                            </div>
		                        </div>
	                    </div>
	                    <div className="mt-2 text-white/85 text-[10px] md:text-xs font-bold leading-tight line-clamp-2" title={selectedOffer?.productName || ''}>
	                        {selectedOffer ? `${selectedOffer.supplier} • ${getDisplayProductName(selectedOffer)}` : '—'}
	                    </div>
	                </div>

	                {/* 2. Controls & List */}
	                <div className="flex-1 min-h-0 flex flex-col bg-slate-50 overflow-hidden relative -mt-6 pt-6 z-10">
                     
                     {/* Controls Bar */}
	                     <div className="px-4 py-2 bg-transparent flex flex-col sm:flex-row items-stretch sm:items-center justify-between shrink-0 gap-2 mb-2">
		                        <div className="flex items-center gap-2 shrink-0">
		                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 shrink-0">
		                                Ordenar por:
		                            </span>
		                            <div className="flex flex-wrap bg-white/90 backdrop-blur-sm p-1 rounded-2xl shadow-sm border border-slate-100 shrink-0 gap-1">
		                                <button onClick={() => setSortMode('savings')} className={`px-2.5 py-2 rounded-xl text-[10px] uppercase font-black transition-all ${sortMode === 'savings' ? 'bg-green-50 text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Ahorro</button>
		                                <button onClick={() => setSortMode('commission')} className={`px-2.5 py-2 rounded-xl text-[10px] uppercase font-black transition-all ${sortMode === 'commission' ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Comisión</button>
		                                <button onClick={() => setSortMode('recommended')} className={`px-2.5 py-2 rounded-xl text-[10px] uppercase font-black transition-all ${sortMode === 'recommended' ? 'bg-purple-50 text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Equilibrada</button>
		                            </div>
		                        </div>
	                        
	                        <div className="flex items-center gap-2 w-full sm:w-auto">
	                            <div className="relative w-full sm:w-56 sm:flex-none">
                                    <select 
                                        value={selectedSupplierFilter}
                                        onChange={(e) => setSelectedSupplierFilter(e.target.value)}
                                        className="w-full bg-white border border-slate-200 text-xs font-bold text-slate-600 rounded-xl py-2.5 pl-3 pr-8 appearance-none focus:ring-0 focus:border-blue-500 shadow-sm transition-colors"
                                    >
                                        <option value="all">Todas las Cías</option>
                                        {suppliers.map(s => s !== 'all' && <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <Filter size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                                </div>
                                {filteredResults.length > 15 && (
                                    <button
                                        onClick={() => setShowAll(v => !v)}
                                        className="px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 rounded-xl text-slate-700 shadow-sm hover:shadow transition-shadow whitespace-nowrap"
                                    >
                                        {showAll ? 'Ver menos' : `Ver todas (${filteredResults.length})`}
                                    </button>
                                )}
                                <div className="hidden xl:flex items-center gap-2">
                                    <button
                                        onClick={() => { setShowHistory(false); openCompare(); }}
                                        className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl border shadow-sm transition-shadow whitespace-nowrap ${
                                            selectedOffers.length >= 2
                                                ? 'bg-slate-900 text-white border-slate-900 hover:shadow-md'
                                                : 'bg-white text-slate-400 border-slate-200'
                                        }`}
                                        title="Comparar ofertas seleccionadas"
                                    >
                                        Comparar ({selectedOffers.length}/3)
                                    </button>
                                    <button
                                        onClick={() => { setShowCompare(false); setShowHistory(v => !v); }}
                                        className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl border shadow-sm transition-shadow whitespace-nowrap ${
                                            showHistory ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-700 border-slate-200'
                                        }`}
                                    >
                                        Historial
                                    </button>
                                </div>
	                        </div>
                     </div>

                    {/* Scrollable List */}
	                     <div ref={listRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-4 pb-5 sm:pb-6 scroll-smooth">
	                        <div className="flex flex-col gap-2 sm:gap-3 pb-10 sm:pb-12">
                                {showHistory ? (
                                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <div className="text-xs font-black uppercase tracking-widest text-slate-500">Historial</div>
                                                <div className="text-sm font-bold text-slate-900">{historyItems.length} PDFs (7 días)</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    value={pdfSearch}
                                                    onChange={(e) => setPdfSearch(e.target.value)}
                                                    placeholder="Buscar por cliente, CUPS, compañía..."
                                                    className="w-64 max-w-[42vw] px-3 py-2 text-xs font-semibold bg-white border border-slate-200 rounded-xl text-slate-700"
                                                />
                                                <button onClick={refreshHistory} className="px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 rounded-xl text-slate-700 hover:shadow-sm">
                                                    Actualizar
                                                </button>
                                                <button onClick={() => { clearPdfDownloads(); refreshHistory(); }} className="px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-rose-50 border border-rose-200 rounded-xl text-rose-700 hover:shadow-sm">
                                                    Limpiar
                                                </button>
                                            </div>
                                        </div>
                                        {historyLoading ? (
                                            <LoadingExperience
                                                title="Cargando tu historial"
                                                subtitle="Buscando tus descargas guardadas."
                                            />
                                        ) : historyItems.length === 0 ? (
                                            <div className="text-sm text-slate-500">No hay descargas guardadas.</div>
                                        ) : (
                                            <div className="grid gap-2">
                                                {historyItems.map(item => (
                                                    <div key={item.id} className="border border-slate-200 rounded-xl p-3">
                                                        <div className="flex items-center justify-between">
                                                            <div className="text-xs font-bold text-slate-600">
                                                                {new Date(item.createdAt).toLocaleString('es-ES')}
                                                            </div>
                                                            <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                                                                {item.commercialName || item.commercialCode}
                                                            </div>
                                                        </div>
                                                        <div className="mt-2 text-sm font-semibold text-slate-900">
                                                            {item.clientName || 'Cliente'} {item.cups ? `• ${item.cups}` : ''}
                                                        </div>
                                                        <div className="mt-2 grid md:grid-cols-[1fr_auto] gap-2 items-center">
                                                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2">
                                                                <div className="text-xs font-bold text-slate-700 truncate">{item.supplier || 'Compañía'}</div>
                                                                <div className="text-[10px] leading-tight text-slate-500 line-clamp-2" title={item.productName || 'Producto'}>{formatProductDisplayName(item.supplier, item.productName || 'Producto')}</div>
                                                                <div className="mt-1 text-xs font-black text-slate-900">€{formatEUR(item.total, 2)}</div>
                                                                <div className="text-[10px] text-emerald-700 font-semibold">€{formatEUR(Math.abs(item.savings), 2)} ahorro</div>
                                                            </div>
                                                            <button
                                                                onClick={() => redownloadHistoryPdf(item)}
                                                                className="px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white rounded-xl border border-slate-900 hover:shadow-sm"
                                                            >
                                                                Redescargar
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <>
		                                {compareSelection.length > 0 && (
		                                            <div className="hidden xl:flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
		                                                <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
		                                                    Seleccionadas para comparar:
		                                                    <span className="font-black text-slate-900">{compareSelection.length}</span>
		                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={clearCompareSelection}
                                                        className="px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 rounded-xl text-slate-700"
                                                    >
                                                        Limpiar
                                                    </button>
                                                    <button
                                                        onClick={openCompare}
                                                        className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl border ${
                                                            compareSelection.length >= 2 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-200'
                                                        }`}
                                                    >
                                                        Comparar ahora
		                                                    </button>
		                                                </div>
		                                            </div>
		                                        )}
		                                {displayedResults.length === 0 && (
		                                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center">
		                                        <div className="text-slate-900 font-black text-lg">No se encontraron ofertas con ahorro</div>
		                                        <div className="mt-1 text-sm text-slate-600 font-semibold">
		                                            Prueba con otros datos (CAE, potencia, días) o cambia el filtro de compañía.
		                                        </div>
		                                        {selectedSupplierFilter !== 'all' && (
		                                            <div className="mt-3">
		                                                <button
		                                                    onClick={() => setSelectedSupplierFilter('all')}
		                                                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white rounded-xl border border-slate-900"
		                                                >
		                                                    Ver todas las cías
		                                                </button>
		                                            </div>
		                                        )}
		                                    </div>
		                                )}
		                                {displayedResults.length > 0 && displayedResults.map((offer, idx) => {
		                                const isBestBalanced = idx === 0 && sortMode === 'recommended'
		                                const displayRank = idx + 1
		                                const isCompared = compareSelection.includes(offerKey(offer))
		                                return (
		                                    <motion.div 
	                                        key={`${offer.supplier}-${offer.productName}-${idx}`}
	                                        initial={{ opacity: 0, y: 10 }}
	                                        animate={{ opacity: 1, y: 0 }}
	                                        transition={{ delay: idx * 0.05 }}
	                                        onClick={() => setSelectedOfferIndex(idx)}
	                                        className={`bg-white rounded-xl sm:rounded-2xl shadow-sm overflow-hidden relative group transition-all cursor-pointer ${
	                                            idx === selectedOfferIndex ? 'ring-2 ring-blue-400/70 shadow-blue-200/40' : 'border border-slate-100 hover:border-slate-300'
	                                        }`}
	                                    >
	                                        <div className={`h-1.5 ${idx === selectedOfferIndex ? 'bg-gradient-to-r from-[#ee2e2c] via-[#ff6b00] to-[#feca0e]' : 'bg-slate-100'}`} />

		                                        <div className="p-2 sm:p-3">
		                                            {/* Desktop row layout */}
		                                            <div className="hidden sm:flex items-center gap-2 md:gap-1.5 lg:gap-2 flex-nowrap overflow-hidden">
		                                                <div
		                                                    className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center font-black text-sm ${
		                                                        isBestBalanced
		                                                            ? 'bg-yellow-300 text-yellow-950 border border-yellow-200 shadow-lg shadow-yellow-300/25'
		                                                            : idx === selectedOfferIndex
		                                                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
		                                                                : 'bg-slate-50 text-slate-600 border border-slate-200'
		                                                    }`}
		                                                    title={isBestBalanced ? 'Equilibrada recomendada' : undefined}
		                                                >
		                                                    {isBestBalanced ? <Star size={16} /> : displayRank}
		                                                </div>

		                                                <button
		                                                    onClick={(e) => { e.stopPropagation(); toggleCompare(offer); }}
		                                                    className={`hidden xl:flex w-9 h-9 shrink-0 rounded-xl items-center justify-center border transition-all ${
		                                                        isCompared ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700'
		                                                    }`}
		                                                    title={isCompared ? 'Quitar de comparar' : 'Añadir a comparar'}
		                                                >
		                                                    {isCompared ? '✓' : '+'}
		                                                </button>

		                                                <div className="min-w-0 flex-1 flex items-baseline gap-2">
		                                                    <span className="font-extrabold text-slate-900 truncate text-sm md:text-[13px] lg:text-sm">{offer.supplier}</span>
		                                                    <span className="text-[11px] font-semibold text-slate-500 leading-tight line-clamp-2" title={offer.productName}>• {getDisplayProductName(offer)}</span>
		                                                </div>

		                                                <span className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-2 md:px-2.5 lg:px-3 py-1.5 md:py-1.5 lg:py-2 shrink-0">
		                                                    <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest text-slate-500">Propuesta</span>
		                                                    <span className="text-[12px] md:text-[12px] lg:text-sm font-extrabold text-slate-900">€{formatEUR(offer.total, 2)}</span>
		                                                </span>

		                                                <span className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-2 md:px-2.5 lg:px-3 py-1.5 md:py-1.5 lg:py-2 shrink-0">
		                                                    <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest text-emerald-700">Ahorro</span>
		                                                    <span className="text-[12px] md:text-[12px] lg:text-sm font-extrabold text-emerald-800">€{formatEUR(Math.abs(offer.savings), 2)}</span>
		                                                </span>

		                                                <span className="inline-flex items-center gap-2 bg-emerald-50/60 border border-emerald-200/70 rounded-xl px-2 md:px-2.5 lg:px-3 py-1.5 md:py-1.5 lg:py-2 shrink-0">
		                                                    <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest text-emerald-700">Anual</span>
		                                                    <span className="results-annual-amount text-[12px] md:text-[12px] lg:text-sm font-black tracking-tight">€{formatEUR(offer.annualSavings, 0)}</span>
		                                                </span>

			                                                {showCommissions && (
			                                                    <span className="inline-flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-xl px-2 md:px-2.5 lg:px-3 py-1.5 md:py-1.5 lg:py-2 shrink-0">
			                                                        <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest text-purple-700">Comisión</span>
		                                                        <span className="text-[12px] md:text-[12px] lg:text-sm font-extrabold text-purple-800">€{formatEUR(commissionValue(offer), 2)}</span>
			                                                    </span>
			                                                )}

		                                                <button
		                                                    onClick={(e) => { e.stopPropagation(); handlePdfDownload(offer); }}
		                                                    className="shrink-0 w-9 h-9 lg:w-10 lg:h-10 flex items-center justify-center text-slate-500 hover:text-blue-700 bg-slate-50 hover:bg-blue-50 rounded-xl transition-all border border-slate-200"
		                                                    title="PDF"
		                                                >
		                                                    <FileText size={18}/>
		                                                </button>
		                                                <button
		                                                    onClick={(e) => { e.stopPropagation(); setExpandedRow(expandedRow === idx ? null : idx); }}
		                                                    className={`shrink-0 w-9 h-9 lg:w-10 lg:h-10 flex items-center justify-center rounded-xl transition-all border ${
		                                                        expandedRow === idx ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900'
		                                                    }`}
		                                                    title="Ver detalle"
		                                                >
		                                                    <Eye size={18}/>
		                                                </button>
		                                            </div>
		                                            {/* Mobile stacked layout */}
		                                            <div className="sm:hidden">
		                                                <div className="flex items-center gap-2">
		                                                    <div
		                                                        className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center font-black text-xs ${
		                                                            isBestBalanced
		                                                                ? 'bg-yellow-300 text-yellow-950 border border-yellow-200 shadow-lg shadow-yellow-300/25'
		                                                                : idx === selectedOfferIndex
		                                                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
		                                                                    : 'bg-slate-50 text-slate-600 border border-slate-200'
		                                                        }`}
		                                                        title={isBestBalanced ? 'Equilibrada recomendada' : undefined}
		                                                    >
		                                                        {isBestBalanced ? <Star size={16} /> : displayRank}
		                                                    </div>

		                                                    <div className="min-w-0 flex-1">
		                                                        <div className="text-[12px] font-extrabold text-slate-900 leading-tight truncate">
		                                                            {offer.supplier}
		                                                        </div>
		                                                        <div className="text-[11px] font-semibold text-slate-500 leading-tight line-clamp-2" title={offer.productName}>
		                                                            {getDisplayProductName(offer)}
		                                                        </div>
		                                                    </div>

		                                                    <div className="flex items-center gap-1 shrink-0">
		                                                        <button
		                                                            onClick={(e) => { e.stopPropagation(); handlePdfDownload(offer); }}
		                                                            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-blue-700 bg-slate-50 hover:bg-blue-50 rounded-xl transition-all border border-slate-200"
		                                                            title="PDF"
		                                                        >
		                                                            <FileText size={16}/>
		                                                        </button>
		                                                        <button
		                                                            onClick={(e) => { e.stopPropagation(); setExpandedRow(expandedRow === idx ? null : idx); }}
		                                                            className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all border ${
		                                                                expandedRow === idx ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-200 text-slate-600'
		                                                            }`}
		                                                            title="Ver detalle"
		                                                        >
		                                                            <Eye size={16}/>
		                                                        </button>
		                                                    </div>
		                                                </div>

		                                                <div className={`mt-2 grid gap-1 ${showCommissions ? 'grid-cols-4' : 'grid-cols-3'}`}>
		                                                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5">
		                                                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Prop.</div>
		                                                        <div className="text-[12px] font-extrabold text-slate-900 leading-tight">€{formatEUR(offer.total, 2)}</div>
		                                                    </div>
		                                                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-2 py-1.5">
		                                                        <div className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Ahorro</div>
		                                                        <div className="text-[12px] font-extrabold text-emerald-800 leading-tight">€{formatEUR(Math.abs(offer.savings), 2)}</div>
		                                                    </div>
		                                                    <div className="bg-emerald-50/60 border border-emerald-200/70 rounded-xl px-2 py-1.5">
		                                                        <div className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Anual</div>
		                                                        <div className="text-[13px] font-black results-annual-amount leading-tight">€{formatEUR(offer.annualSavings, 0)}</div>
		                                                    </div>
			                                                    {showCommissions && (
			                                                        <div className="bg-purple-50 border border-purple-200 rounded-xl px-2 py-1.5">
			                                                            <div className="text-[9px] font-black uppercase tracking-widest text-purple-700">Com</div>
			                                                            <div className="text-[12px] font-extrabold text-purple-800 leading-tight">€{formatEUR(commissionValue(offer), 2)}</div>
			                                                        </div>
			                                                    )}
		                                                </div>
		                                            </div>
		                                        </div>

	                                        {/* Expandable Details */}
	                                        <AnimatePresence>
	                                            {expandedRow === idx && (
	                                                <motion.div 
	                                                    initial={{ height: 0, opacity: 0 }}
	                                                    animate={{ height: 'auto', opacity: 1 }}
	                                                    exit={{ height: 0, opacity: 0 }}
	                                                    className="bg-slate-50/60 border-t border-slate-100"
	                                                >
	                                                    <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
	                                                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
	                                                            <div className="bg-white rounded-xl border border-slate-200 p-3">
	                                                                <div className="font-black text-slate-900 mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider">
	                                                                    <Zap size={12} className="text-yellow-500"/> {isGas ? 'Término variable (€/kWh)' : 'Precios Energía (€/kWh)'}
	                                                                </div>
	                                                                <div className="space-y-1.5">
	                                                                    {Object.entries(offer.pricingConsumo || {}).map(([k,v]) => (
	                                                                        <div key={k} className="flex justify-between text-slate-600 font-semibold border-b border-slate-100 pb-1"><span>{k}</span> <span className="text-slate-900 font-mono">{Number(v).toFixed(6)}</span></div>
	                                                                    ))}
	                                                                    {Object.keys(offer.pricingConsumo || {}).length === 0 && (
	                                                                        <div className="text-slate-500 font-semibold">—</div>
	                                                                    )}
	                                                                </div>
	                                                            </div>
	                                                            <div className="bg-white rounded-xl border border-slate-200 p-3">
	                                                                <div className="font-black text-slate-900 mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider">
	                                                                    <BarChart3 size={12} className="text-blue-600"/> {isGas ? 'Término fijo (€/día)' : 'Precios Potencia (€/kW/día)'}
	                                                                </div>
	                                                                <div className="space-y-1.5">
	                                                                    {Object.entries(offer.pricingPotencia || {}).map(([k,v]) => (
	                                                                        <div key={k} className="flex justify-between text-slate-600 font-semibold border-b border-slate-100 pb-1"><span>{k}</span> <span className="text-slate-900 font-mono">{Number(v).toFixed(6)}</span></div>
	                                                                    ))}
	                                                                    {Object.keys(offer.pricingPotencia || {}).length === 0 && (
	                                                                        <div className="text-slate-500 font-semibold">—</div>
	                                                                    )}
	                                                                </div>
	                                                            </div>
	                                                        </div>

	                                                        <div className="bg-white rounded-xl border border-slate-200 p-3">
	                                                            <div className="font-black text-slate-900 mb-2 text-[10px] uppercase tracking-wider">
	                                                                Desglose (€)
	                                                            </div>
	                                                            <div className="space-y-2">
	                                                                <Row label={isGas ? 'Término variable' : 'Energía'} value={offer.details?.energyCost} formatEUR={formatEUR} />
	                                                                <Row label={isGas ? 'Término fijo' : 'Potencia'} value={offer.details?.powerCost} formatEUR={formatEUR} />
	                                                                <Row label="Alquiler" value={offer.details?.equipmentRental} formatEUR={formatEUR} />
	                                                                <Row label="Otros" value={offer.details?.otherCosts} formatEUR={formatEUR} />
	                                                                {Number(offer.details?.socialBonus) > 0 && (
	                                                                    <Row label="Bono social" value={offer.details?.socialBonus} formatEUR={formatEUR} />
	                                                                )}
	                                                                {Number(offer.details?.excessPower) > 0 && (
	                                                                    <Row label="Excesos" value={offer.details?.excessPower} formatEUR={formatEUR} />
	                                                                )}
	                                                                {Number(offer.details?.reactiveEnergy) > 0 && (
	                                                                    <Row label="Reactiva" value={offer.details?.reactiveEnergy} formatEUR={formatEUR} />
	                                                                )}
	                                                                {Number(offer.details?.surpluses) > 0 && (
	                                                                    <Row label="Excedentes (descuento)" value={-(Number(offer.details?.surpluses) || 0)} formatEUR={formatEUR} highlight />
	                                                                )}
	                                                                {!isGas && Number(offer.details?.serviceAdjustmentAmount) > 0 && (
	                                                                    <Row label={offer.details?.serviceAdjustmentLabel || offer.serviceAdjustmentLabel || 'Ajustes de servicio'} value={offer.details?.serviceAdjustmentAmount} formatEUR={formatEUR} />
	                                                                )}
	                                                                <div className="border-t border-slate-200 pt-2">
	                                                                    <Row label="Impuesto eléctrico" value={offer.details?.electricityTax} formatEUR={formatEUR} />
	                                                                    <Row label="Subtotal" value={baseImponible(offer)} formatEUR={formatEUR} strong />
	                                                                    <Row label={`IVA (${Math.round((offer.details?.vatRate || 0) * 100)}%)`} value={offer.details?.vatAmount} formatEUR={formatEUR} />
	                                                                </div>
	                                                                <div className="border-t border-slate-200 pt-2">
	                                                                    <Row label="Total" value={offer.total} formatEUR={formatEUR} strong highlight />
	                                                                </div>
	                                                            </div>
	                                                        </div>
	                                                    </div>
	                                                </motion.div>
	                                            )}
	                                        </AnimatePresence>
	                                    </motion.div>
	                                )
	                            })}
                                    </>
                                )}
                        </div>
                        {showScrollTop && (
                            <div className="sticky bottom-3 flex justify-end pr-1 pointer-events-none">
                                <button
                                    onClick={scrollToTop}
                                    className="pointer-events-auto px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 rounded-full text-slate-700 shadow-md hover:shadow-lg transition-shadow"
                                >
                                    Arriba
                                </button>
                            </div>
                        )}
                     </div>

                </div>
                </motion.div>
                
                <AnimatePresence>
                    {showCompare && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center px-4 py-6"
                            onClick={closeCompare}
                        >
                            <motion.div
                                initial={{ scale: 0.98, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.98, opacity: 0 }}
                                className="w-full max-w-5xl max-h-full overflow-y-auto bg-white rounded-3xl shadow-2xl border border-slate-200 p-4 md:p-6"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <div className="text-xs font-black uppercase tracking-widest text-slate-500">Comparativa</div>
                                        <div className="text-lg font-bold text-slate-900">Ofertas seleccionadas</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={downloadComparePdf}
                                            className="px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-emerald-600 text-white rounded-xl"
                                        >
                                            Descargar comparativa
                                        </button>
                                        <button
                                            onClick={closeCompare}
                                            className="px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white rounded-xl"
                                        >
                                            Cerrar
                                        </button>
                                    </div>
                                </div>

                                <div className="grid md:grid-cols-3 gap-3">
                                    {selectedOffers.map((offer, idx) => (
                                        <div key={`${offerKey(offer)}-${idx}`} className="border border-slate-200 rounded-2xl p-4">
                                            <div className="font-black text-slate-900 text-sm truncate">{offer.supplier}</div>
                                            <div className="text-[11px] leading-tight text-slate-500 line-clamp-2" title={offer.productName}>{getDisplayProductName(offer)}</div>
                                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Propuesta</div>
                                                    <div className="font-black text-slate-900">€{formatEUR(offer.total, 2)}</div>
                                                </div>
                                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Ahorro</div>
                                                    <div className="font-black text-emerald-800">€{formatEUR(Math.abs(offer.savings), 2)}</div>
                                                </div>
                                                <div className="bg-emerald-50/60 border border-emerald-200/70 rounded-xl px-3 py-2">
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Anual</div>
                                                    <div className="font-black text-emerald-800">€{formatEUR(offer.annualSavings, 0)}</div>
                                                </div>
                                                <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-purple-700">Comisión</div>
                                                    <div className="font-black text-purple-800">€{formatEUR(commissionValue(offer), 2)}</div>
                                                </div>
                                            </div>
                                            <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
                                                <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">{isGas ? 'Término variable (€/kWh)' : 'Consumo (€/kWh)'}</div>
                                                    <div className="space-y-1">
                                                        {Object.keys(offer.pricingConsumo || {}).length === 0 && (
                                                            <div className="text-[10px] text-slate-400">—</div>
                                                        )}
                                                        {Object.entries(offer.pricingConsumo || {}).map(([k, v]) => (
                                                            <div key={k} className="flex items-center justify-between text-[11px] text-slate-600 font-semibold">
                                                                <span>{k}</span>
                                                                <span className="font-mono text-slate-900">{Number(v).toFixed(6)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                                                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">{isGas ? 'Término fijo (€/día)' : 'Potencia (€/kW·día)'}</div>
                                                    <div className="space-y-1">
                                                        {Object.keys(offer.pricingPotencia || {}).length === 0 && (
                                                            <div className="text-[10px] text-slate-400">—</div>
                                                        )}
                                                        {Object.entries(offer.pricingPotencia || {}).map(([k, v]) => (
                                                            <div key={k} className="flex items-center justify-between text-[11px] text-slate-600 font-semibold">
                                                                <span>{k}</span>
                                                                <span className="font-mono text-slate-900">{Number(v).toFixed(6)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
        </motion.div>
    </AnimatePresence>
	    )
}

function Row({ label, value, formatEUR, strong = false, highlight = false }) {
    const num = Number(value)
    const isFiniteNum = Number.isFinite(num)
    if (!isFiniteNum) {
        return (
            <div className="flex items-center justify-between gap-2 font-semibold text-slate-700">
                <span className="text-slate-600">{label}</span>
                <span className="text-slate-900">—</span>
            </div>
        )
    }

    const isNegative = num < 0
    const abs = Math.abs(num)
    const cls = [
        'flex items-center justify-between gap-2',
        strong ? 'font-black' : 'font-semibold',
        highlight ? 'text-emerald-700' : 'text-slate-700'
    ].join(' ')
    return (
        <div className={cls}>
            <span className="text-slate-600">{label}</span>
            <span className="text-slate-900">
                {isNegative ? '-' : ''}€{formatEUR(abs, 2)}
            </span>
        </div>
    )
}
