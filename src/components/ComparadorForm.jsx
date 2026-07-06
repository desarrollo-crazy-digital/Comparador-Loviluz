
import { useCallback, useEffect, useRef, useState } from 'react'
import { LogOut, Sparkles, Zap, Flame, FileText, BarChart3, ChevronRight, RefreshCw, User, FileDigit, Home, Building2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import ResultsModal from './ResultsModal'
import CommercialAvatar from './CommercialAvatar'
import { gaEvent } from '../utils/analytics'
import { generatePDF } from '../utils/pdfGenerator'
import { clearPdfDownloads, getPdfDownloads } from '../utils/pdfDownloadStore'
import { formatProductDisplayName } from '../utils/productDisplay'
import '../modern-form.css'

function normalizeCups(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '')
}

function formatAnnualKwh(value) {
    const num = Number(value)
    if (!Number.isFinite(num) || num < 0) return ''
    if (Number.isInteger(num)) return String(num)
    return String(num).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

const isAnnualConsumptionLookupDisabled = ['1', 'true', 'yes', 'on'].includes(
    String(import.meta.env.VITE_DISABLE_ANNUAL_CONSUMPTION_LOOKUP || '')
        .trim()
        .toLowerCase()
)
const annualConsumptionUnavailableMessage = 'no hay consumo sips disponible para este cups.'

export default function ComparadorForm({ commercialCode, commercialName, isAdmin = false, isSecretary = false, onOpenDashboard, onOpenAdmin, onLogout }) {
    const [formData, setFormData] = useState({
        clientName: '',
        cups: '',
        address: '',
        clientType: 'todos',   // todos | residencial | autonomo | pyme
        energyType: 'electricidad', // electricidad | gas
        tariffType: '2.0TD',
        region: 'PENINSULA',
        gasTariffBand: 'RL2',
        gasMonthlyConsumption: '',
        gasFixedDaily: '',
        cae: '',
        currentBill: '',
        billingDays: '30',
        equipmentRental: '1.19',
        otherCosts: '0.80',
        discountEnergy: '0',
        discountPower: '0',
        reactiveEnergy: '0',
        excessPower: '0',
        socialBonus: '0',
        surpluses: '0',
        consumptionP1: '', consumptionP2: '', consumptionP3: '',
        consumptionP4: '', consumptionP5: '', consumptionP6: '',
        potenciaP1: '', potenciaP2: '', potenciaP3: '',
        potenciaP4: '', potenciaP5: '', potenciaP6: '',
        // Impuestos extraídos del PDF: vacíos = usar valores hardcodeados (entrada manual)
        pdfVatRate: '',
        pdfElectricityTaxRate: ''
    })

    const [results, setResults] = useState(null)
    const [showResults, setShowResults] = useState(false)
    const [isCalculating, setIsCalculating] = useState(false)
    const [invoiceStatus, setInvoiceStatus] = useState('')
    const [isUploading, setIsUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)
    const uploadProgressRef = useRef(null)
    const [uploadError, setUploadError] = useState('')
    const [formError, setFormError] = useState('')
    const [invoiceUsed, setInvoiceUsed] = useState(false)
    const [invoiceExtractedCurrentBill, setInvoiceExtractedCurrentBill] = useState(null)
    const [manualEntryTracked, setManualEntryTracked] = useState(false)
    const [showPdfHistory, setShowPdfHistory] = useState(false)
    const [historyItems, setHistoryItems] = useState([])
    const [pdfSearch, setPdfSearch] = useState('')
    const [historyLoading, setHistoryLoading] = useState(false)
    const [annualLookup, setAnnualLookup] = useState({ status: 'idle', message: '', cups: '' })
    const fileInputRef = useRef(null)
    const caeInputRef = useRef(null)
    const caeValue = Number(formData.cae)
    const isCaeValid = Number.isFinite(caeValue) && caeValue > 0
    const normalizedCups = normalizeCups(formData.cups)

    const markAnnualConsumptionUnavailable = useCallback((cups) => {
        setFormData(prev => {
            if (normalizeCups(prev.cups) !== cups) return prev
            return { ...prev, cae: '' }
        })
        setAnnualLookup({
            status: 'not_found',
            message: annualConsumptionUnavailableMessage,
            cups
        })
    }, [])

    const loadPdfHistory = useCallback(async () => {
        setHistoryLoading(true)
        try {
            const items = await getPdfDownloads({ commercialCode, query: pdfSearch, days: 7 })
            setHistoryItems(items)
        } catch (err) {
            console.error('Error loading PDF history:', err)
        } finally {
            setHistoryLoading(false)
        }
    }, [commercialCode, pdfSearch])

    useEffect(() => {
        if (!showPdfHistory) return
        loadPdfHistory()
    }, [showPdfHistory, loadPdfHistory])

    useEffect(() => {
        if (formData.energyType !== 'electricidad') {
            setAnnualLookup({ status: 'idle', message: '', cups: '' })
            return
        }

        if (isAnnualConsumptionLookupDisabled) {
            setAnnualLookup({ status: 'idle', message: '', cups: normalizedCups })
            return
        }

        if (!normalizedCups || normalizedCups.length < 10) {
            setAnnualLookup({ status: 'idle', message: '', cups: normalizedCups })
            return
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(async () => {
            setAnnualLookup({ status: 'loading', message: 'Buscando consumo anual por CUPS…', cups: normalizedCups })
            try {
                const response = await fetch(`/api/consumo-anual?cups=${encodeURIComponent(normalizedCups)}`, {
                    signal: controller.signal
                })

                if (response.status === 404) {
                    markAnnualConsumptionUnavailable(normalizedCups)
                    return
                }

                if (!response.ok) {
                    markAnnualConsumptionUnavailable(normalizedCups)
                    return
                }

                const payload = await response.json()
                if (!payload?.found) {
                    markAnnualConsumptionUnavailable(normalizedCups)
                    return
                }
                const caeValueFromCups = formatAnnualKwh(payload.annualKwh)
                setFormData(prev => {
                    if (normalizeCups(prev.cups) !== normalizedCups) return prev
                    const update = { ...prev, cae: caeValueFromCups }
                    if (payload.tarifa) {
                        update.tariffType = payload.tarifa
                    }
                    if (payload.potencias) {
                        if (payload.potencias.p1 !== undefined) update.potenciaP1 = String(payload.potencias.p1)
                        if (payload.potencias.p2 !== undefined) update.potenciaP2 = String(payload.potencias.p2)
                        if (payload.potencias.p3 !== undefined) update.potenciaP3 = String(payload.potencias.p3)
                        if (payload.potencias.p4 !== undefined) update.potenciaP4 = String(payload.potencias.p4)
                        if (payload.potencias.p5 !== undefined) update.potenciaP5 = String(payload.potencias.p5)
                        if (payload.potencias.p6 !== undefined) update.potenciaP6 = String(payload.potencias.p6)
                    }
                    return update
                })
                setAnnualLookup({
                    status: 'found',
                    message: `Consumo anual cargado: ${caeValueFromCups} kWh`,
                    cups: normalizedCups
                })
            } catch (err) {
                if (err.name === 'AbortError') return
                markAnnualConsumptionUnavailable(normalizedCups)
            }
        }, 450)

        return () => {
            clearTimeout(timeoutId)
            controller.abort()
        }
    }, [formData.energyType, markAnnualConsumptionUnavailable, normalizedCups])

    const redownloadHistoryPdf = useCallback(async (item) => {
        if (!item?.formData || !item?.offer) return
        await generatePDF(item.formData, item.offer, {
            commercialCode,
            commercialName,
            fromHistory: true
        })
    }, [commercialCode, commercialName])

    const clearPdfHistory = useCallback(async () => {
        clearPdfDownloads()
        await loadPdfHistory()
    }, [loadPdfHistory])

    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(file)
        })
    }

    const normalizeNumberString = (value) => {
        if (value === null || value === undefined) return ''
        if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''

        let raw = String(value).trim()
        if (!raw) return ''

        // OCR suele devolver "−" (Unicode) en vez de "-"
        raw = raw.replace(/[−–—]/g, '-')

        let negative = false
        if (/^\(.*\)$/.test(raw)) {
            negative = true
            raw = raw.slice(1, -1).trim()
        }

        let cleaned = raw.replace(/[^\d,.\-\s]/g, '').replace(/\s+/g, '')

        if (cleaned.endsWith('-') && !cleaned.startsWith('-')) {
            negative = true
            cleaned = cleaned.slice(0, -1)
        }

        if (cleaned.includes('-')) {
            negative = true
            cleaned = cleaned.replace(/-/g, '')
        }

        const hasComma = cleaned.includes(',')
        const hasDot = cleaned.includes('.')
        if (hasComma && hasDot) {
            cleaned = cleaned.replace(/\./g, '').replace(',', '.')
        } else if (hasComma && !hasDot) {
            cleaned = cleaned.replace(',', '.')
        } else if (!hasComma && hasDot) {
            const thousandLike = /^\d{1,3}(\.\d{3})+$/.test(cleaned)
            if (thousandLike) cleaned = cleaned.replace(/\./g, '')
        }

        const num = Number.parseFloat(cleaned)
        if (!Number.isFinite(num)) return ''
        const signed = negative ? -Math.abs(num) : num
        return String(signed)
    }

    const mapExtractedData = (extracted) => {
        const normalizeGasBand = (value) => {
            const raw = String(value ?? '').trim().toUpperCase()
            if (!raw) return null
            const compact = raw.replace(/\s+/g, '')
            const m = compact.match(/^RL0*([1-5])$/) || compact.match(/^RLO*([1-5])$/)
            if (m) return `RL${m[1]}`
            const m2 = raw.match(/R\s*L\s*0*([1-5])/i)
            if (m2) return `RL${m2[1]}`
            const m3 = raw.match(/^0*([1-5])$/)
            if (m3) return `RL${m3[1]}`
            return null
        }

        const energyType = extracted?.energyType === 'gas' ? 'gas' : 'electricidad'
        const tariffType = extracted?.tariffType && extracted.tariffType !== 'GAS' ? extracted.tariffType : '2.0TD'
        const gasTariffBand =
            normalizeGasBand(extracted?.gasTariffBand) ||
            normalizeGasBand(extracted?.tariffBand) ||
            normalizeGasBand(extracted?.gasBand) ||
            'RL2'
        const parsedSurpluses = Number.parseFloat(normalizeNumberString(extracted?.surpluses))
        const normalizedSurpluses = Number.isFinite(parsedSurpluses) ? Math.abs(parsedSurpluses) : 0
        return {
            clientName: extracted?.clientName || '',
            cups: extracted?.cups || '',
            address: extracted?.address || '',
            energyType,
            tariffType,
            region: extracted?.region || 'PENINSULA',
            gasTariffBand,
            gasMonthlyConsumption: extracted?.gasMonthlyConsumption ? String(extracted.gasMonthlyConsumption) : '',
            gasFixedDaily: extracted?.gasFixedDaily ? String(extracted.gasFixedDaily) : '',
            cae: extracted?.cae ? String(extracted.cae) : '',
            currentBill: normalizeNumberString(extracted?.currentBill),
            billingDays: extracted?.billingDays ? String(extracted.billingDays) : '30',
            equipmentRental: extracted?.equipmentRental ? String(extracted.equipmentRental) : '1.19',
            otherCosts: extracted?.otherCosts ? String(extracted.otherCosts) : '0.80',
            reactiveEnergy: '0', // Siempre manual: no autocompletar desde lectura
            excessPower: '0', // Siempre manual: no autocompletar desde lectura
            socialBonus: extracted?.socialBonus ? String(extracted.socialBonus) : '0',
            surpluses: String(normalizedSurpluses),
            consumptionP1: energyType === 'gas' ? '' : (extracted?.consumption?.P1 ? String(extracted.consumption.P1) : ''),
            consumptionP2: energyType === 'gas' ? '' : (extracted?.consumption?.P2 ? String(extracted.consumption.P2) : ''),
            consumptionP3: energyType === 'gas' ? '' : (extracted?.consumption?.P3 ? String(extracted.consumption.P3) : ''),
            consumptionP4: (energyType === 'gas' || tariffType === '2.0TD') ? '' : (extracted?.consumption?.P4 ? String(extracted.consumption.P4) : ''),
            consumptionP5: (energyType === 'gas' || tariffType === '2.0TD') ? '' : (extracted?.consumption?.P5 ? String(extracted.consumption.P5) : ''),
            consumptionP6: (energyType === 'gas' || tariffType === '2.0TD') ? '' : (extracted?.consumption?.P6 ? String(extracted.consumption.P6) : ''),
            potenciaP1: energyType === 'gas' ? '' : (extracted?.power?.P1 ? String(extracted.power.P1) : ''),
            potenciaP2: energyType === 'gas' ? '' : (extracted?.power?.P2 ? String(extracted.power.P2) : ''),
            potenciaP3: (energyType === 'gas' || tariffType === '2.0TD') ? '' : (extracted?.power?.P3 ? String(extracted.power.P3) : ''),
            potenciaP4: (energyType === 'gas' || tariffType === '2.0TD') ? '' : (extracted?.power?.P4 ? String(extracted.power.P4) : ''),
            potenciaP5: (energyType === 'gas' || tariffType === '2.0TD') ? '' : (extracted?.power?.P5 ? String(extracted.power.P5) : ''),
            potenciaP6: (energyType === 'gas' || tariffType === '2.0TD') ? '' : (extracted?.power?.P6 ? String(extracted.power.P6) : ''),
            // Impuestos leídos del propio PDF: se usarán en el cálculo en lugar de los hardcodeados.
            pdfVatRate: (extracted?.vatRate && Number(extracted.vatRate) > 0) ? String(extracted.vatRate) : '',
            pdfElectricityTaxRate: (extracted?.electricityTaxRate && Number(extracted.electricityTaxRate) > 0) ? String(extracted.electricityTaxRate) : ''
        }
    }

    const startUploadProgress = () => {
        setUploadProgress(0)
        // Sube rápido al 30% (lectura del archivo), luego se ralentiza simulando la espera del servidor
        // Se detiene en 92% para que el salto final a 100% ocurra cuando llegue la respuesta real
        const steps = [
            { target: 15, duration: 400 },
            { target: 30, duration: 600 },
            { target: 55, duration: 2500 },
            { target: 72, duration: 3000 },
            { target: 82, duration: 3500 },
            { target: 88, duration: 3000 },
            { target: 92, duration: 4000 },
        ]
        let current = 0
        let stepIndex = 0
        const tick = () => {
            if (stepIndex >= steps.length) return
            const { target, duration } = steps[stepIndex]
            const increment = (target - current) / (duration / 80)
            current = Math.min(current + increment, target)
            setUploadProgress(Math.round(current))
            if (Math.round(current) >= target) stepIndex++
            uploadProgressRef.current = setTimeout(tick, 80)
        }
        uploadProgressRef.current = setTimeout(tick, 80)
    }

    const stopUploadProgress = (success) => {
        if (uploadProgressRef.current) clearTimeout(uploadProgressRef.current)
        if (success) {
            setUploadProgress(100)
            setTimeout(() => setUploadProgress(0), 600)
        } else {
            setUploadProgress(0)
        }
    }

    const handleUploadClick = () => {
        setUploadError('')
        gaEvent('invoice_read_click', {
            energy_type: formData.energyType,
            tariff_type: formData.tariffType,
            region: formData.region
        })
        fileInputRef.current?.click()
    }

    const handleInvoiceSelected = async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        if (file.type !== 'application/pdf') {
            setUploadError('Sube un PDF válido.')
            gaEvent('invoice_read_error', { reason: 'invalid_filetype' })
            return
        }

        setIsUploading(true)
        setUploadError('')
        setInvoiceStatus('')
        startUploadProgress()

        try {
            const base64 = await fileToBase64(file)
            const response = await fetch('/api/extraer-factura', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    mimeType: file.type,
                    base64: base64.split(',')[1]
                })
            })
            if (!response.ok) {
                const err = await response.json().catch(() => ({}))
                console.error('[invoice-read] API error', err)
                gaEvent('invoice_read_error', { reason: 'api_error' })
                throw new Error(err.error || 'No se pudo leer la factura')
            }
            const { extracted, completeness } = await response.json()
            const hasCriticalData = extracted?.energyType;
            if (!hasCriticalData) {
                throw new Error(completeness?.reason || 'No se pudieron leer los datos de la factura. Asegúrate de subir un PDF válido.');
            }
            const mapped = mapExtractedData(extracted)
            setFormData(prev => ({ ...prev, ...mapped }))
            setInvoiceUsed(true)
            const extractedBillNum = Number(mapped?.currentBill)
            setInvoiceExtractedCurrentBill(Number.isFinite(extractedBillNum) ? extractedBillNum : null)

            let warning = '';
            const isMissingTotalOrDays = !mapped.currentBill || String(mapped.currentBill) === '0' || !mapped.billingDays || String(mapped.billingDays) === '0';
            if (isMissingTotalOrDays) {
                warning = ' (Atención: Faltan Días de facturación o el Total)';
            }

            stopUploadProgress(true)
            setInvoiceStatus('✓ Factura cargada' + warning)
            gaEvent('invoice_read_success', {
                energy_type: extracted?.energyType === 'gas' ? 'gas' : 'electricidad',
                tariff_type: extracted?.tariffType || formData.tariffType,
                region: extracted?.region || formData.region,
                partial: isMissingTotalOrDays
            })
            setTimeout(() => setInvoiceStatus(''), isMissingTotalOrDays ? 7000 : 4000)
        } catch (err) {
            console.error('[invoice-read] Error procesando factura', err)
            stopUploadProgress(false)
            setInvoiceStatus('')
            setUploadError(err?.message || 'Error al procesar la factura')
            gaEvent('invoice_read_error', { reason: 'exception' })
        } finally {
            setIsUploading(false)
        }
    }

    const handleInputChange = (e) => {
        const { name, value } = e.target
        if (formError) setFormError('')
        if (!invoiceUsed && !manualEntryTracked && String(value || '').trim() !== '') {
            setManualEntryTracked(true)
            gaEvent('manual_entry_started', {
                energy_type: formData.energyType,
                tariff_type: formData.tariffType,
                region: formData.region
            })
        }
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    const resetForm = () => {
        setFormData({
            clientName: '', cups: '', address: '', clientType: 'todos', energyType: 'electricidad', tariffType: '2.0TD', region: 'PENINSULA',
            gasTariffBand: 'RL2', gasMonthlyConsumption: '', gasFixedDaily: '',
            cae: '', currentBill: '', billingDays: '30', equipmentRental: '1.19', otherCosts: '0.80',
            discountEnergy: '0', discountPower: '0', reactiveEnergy: '0', excessPower: '0', socialBonus: '0', surpluses: '0',
            consumptionP1: '', consumptionP2: '', consumptionP3: '', consumptionP4: '', consumptionP5: '', consumptionP6: '',
            potenciaP1: '', potenciaP2: '', potenciaP3: '', potenciaP4: '', potenciaP5: '', potenciaP6: '',
            pdfVatRate: '', pdfElectricityTaxRate: ''
        })
        setResults(null)
        setInvoiceStatus('')
        setUploadError('')
        setFormError('')
        setInvoiceUsed(false)
        setInvoiceExtractedCurrentBill(null)
        setManualEntryTracked(false)
        setAnnualLookup({ status: 'idle', message: '', cups: '' })
    }

    const handleCalculate = async () => {
        const inputMethod = invoiceUsed ? 'invoice' : 'manual'
        if (!isCaeValid) {
            setFormError('Debes introducir el Cons. Anual (kWh) para calcular (las comisiones dependen de este dato).')
            gaEvent('calculate_blocked', { reason: 'missing_cons_anual', input_method: inputMethod })
            caeInputRef.current?.focus?.()
            return
        }
        if (formData.energyType === 'electricidad') {
            const tariff = String(formData.tariffType || '').toUpperCase()
            const consumptionPeriods = tariff === '2.0TD' ? 3 : 6
            const totalPeriodConsumption = [...Array(consumptionPeriods)].reduce((sum, _, idx) => {
                const value = Number(formData[`consumptionP${idx + 1}`])
                return sum + (Number.isFinite(value) ? value : 0)
            }, 0)
            if (totalPeriodConsumption <= 0) {
                setFormError('Debes introducir el consumo del periodo por P1/P2/P3. El Cons. Anual solo se usa para límites y comisiones, no para calcular la factura mensual.')
                gaEvent('calculate_blocked', { reason: 'missing_period_consumption', input_method: inputMethod })
                document.querySelector('input[name=\"consumptionP1\"]')?.focus?.()
                return
            }
            if (tariff === '2.0TD') {
                const potenciaP1 = Number(formData.potenciaP1)
                const potenciaP2 = Number(formData.potenciaP2)
                const maxPot = Math.max(Number.isFinite(potenciaP1) ? potenciaP1 : 0, Number.isFinite(potenciaP2) ? potenciaP2 : 0)
                if (maxPot > 15) {
                    setFormError('Para tarifa 2.0TD la potencia debe ser ≤ 15 kW. Si tienes > 15 kW, usa 3.0TD.')
                    gaEvent('calculate_blocked', { reason: 'max_potencia_2_0td', input_method: inputMethod })
                    document.querySelector('input[name=\"potenciaP1\"]')?.focus?.()
                    return
                }
            }
            if (tariff === '3.0TD') {
                const potenciaP6 = Number(formData.potenciaP6)
                if (!Number.isFinite(potenciaP6) || potenciaP6 <= 15) {
                    setFormError('Para tarifa 3.0TD debe haber al menos P6 > 15 kW.')
                    gaEvent('calculate_blocked', { reason: 'min_potencia_p6', input_method: inputMethod })
                    document.querySelector('input[name=\"potenciaP6\"]')?.focus?.()
                    return
                }
            }
        }
        gaEvent('calculate_click', {
            input_method: inputMethod,
            energy_type: formData.energyType,
            tariff_type: formData.tariffType,
            region: formData.region,
            client_segment: formData.clientType,
        })
        if (invoiceUsed && Number(invoiceExtractedCurrentBill) < 0) {
            const entered = Number(formData.currentBill)
            if (!Number.isFinite(entered) || entered >= 0) {
                setFormError('La factura leída es negativa (abono). Introduce el Total Factura con signo negativo (por ejemplo: -1516.92).')
                document.querySelector('input[name=\"currentBill\"]')?.focus?.()
                return
            }
        }
        setIsCalculating(true)
        try {
            const effectiveCommercial = commercialCode === 'AdminMiguel2909' ? 'Miguel2909' : commercialCode
            const response = await fetch('/api/calcular', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...formData, codigoComercial: effectiveCommercial })
            })
            if (!response.ok) {
                const err = await response.json().catch(() => ({}))
                throw new Error(err.error || 'No se pudo calcular')
            }
            const data = await response.json()
            const proposals = (data.results || []).map((offer) => ({
                ...offer,
                commission: offer.comisionAmount ?? offer.comision ?? offer.commission ?? 0,
                details: {
                    // Use base energy cost (without adjustment) when adjustment is shown separately
                    energyCost: (offer.serviceAdjustmentAmount > 0 && offer.energyCostBase != null)
                        ? offer.energyCostBase
                        : (offer.energyCost ?? offer.energyCostBase ?? 0),
                    serviceAdjustmentAmount: offer.serviceAdjustmentAmount ?? 0,
                    serviceAdjustmentLabel: offer.serviceAdjustmentLabel ?? '',
                    powerCost: offer.powerCost ?? 0,
                    equipmentRental: offer.equipmentRental ?? 0,
                    otherCosts: offer.otherCosts ?? 0,
                    subtotal: offer.subtotal ?? 0,
                    electricityTax: offer.electricityTax ?? 0,
                    vatAmount: offer.vatAmount ?? offer.vat ?? 0,
                    vatRate: offer.vatRate ?? (offer.taxableBase ? (offer.vat / offer.taxableBase) : undefined),
                    electricityTaxRate: offer.electricityTaxRate,
                    discounts: offer.discounts ?? { energy: offer.discountEnergy ?? 0, power: offer.discountPower ?? 0 },
                    extras: offer.extras ?? { reactiveEnergy: offer.reactiveEnergy ?? 0, excessPower: offer.excessPower ?? 0 }
                }
            }))
            setResults(proposals)
            setShowResults(true)
            gaEvent('calculate_success', {
                input_method: inputMethod,
                energy_type: formData.energyType,
                tariff_type: formData.tariffType,
                region: formData.region,
                client_segment: formData.clientType,
                results_count: proposals.length
            })
            
            // Track comparison stats
            fetch('/api/stats/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'comparison',
                    commercial: effectiveCommercial,
                    results: proposals.length,
                    timestamp: new Date().toISOString()
                })
            }).catch(e => console.error('Tracking error:', e))
        } catch (e) {
            console.error(e)
            gaEvent('calculate_error', {
                input_method: inputMethod,
                energy_type: formData.energyType,
                tariff_type: formData.tariffType,
                region: formData.region,
                client_segment: formData.clientType
            })
            alert(e.message || 'Error al calcular')
        } finally {
            setIsCalculating(false)
        }
    }



    return (
        <div className="w-full font-sans px-3 md:px-6">
            {showResults && results && (
                <ResultsModal
                    results={results}
                    formData={formData}
                    onClose={() => setShowResults(false)}
                    initialShowCommissions={false}
                    commercialCode={commercialCode}
                    commercialName={commercialName}
                    hideCommissions={isSecretary}
                />
            )}
            {showPdfHistory && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4">
                    <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Historial</div>
                                <div className="text-lg font-extrabold text-slate-900">PDFs descargados (últimos 7 días)</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowPdfHistory(false)}
                                className="px-3 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                            >
                                Cerrar
                            </button>
                        </div>
                        <div className="px-5 py-4 space-y-3">
                            <div className="flex flex-col md:flex-row md:items-center gap-2">
                                <input
                                    type="text"
                                    value={pdfSearch}
                                    onChange={(e) => setPdfSearch(e.target.value)}
                                    placeholder="Buscar por cliente, CUPS, comercializadora o producto..."
                                    className="w-full md:flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                                />
                                <button
                                    type="button"
                                    onClick={loadPdfHistory}
                                    className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider border border-slate-200 text-slate-700 hover:bg-slate-50"
                                >
                                    Actualizar
                                </button>
                                <button
                                    type="button"
                                    onClick={clearPdfHistory}
                                    className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider border border-rose-200 text-rose-700 hover:bg-rose-50"
                                >
                                    Limpiar
                                </button>
                            </div>
                            <div className="max-h-[55vh] overflow-auto rounded-xl border border-slate-100">
                                {historyLoading ? (
                                    <div className="p-4 text-sm text-slate-500">Cargando historial...</div>
                                ) : historyItems.length === 0 ? (
                                    <div className="p-4 text-sm text-slate-500">No hay PDFs guardados en los últimos 7 días.</div>
                                ) : (
                                    <div className="divide-y divide-slate-100">
                                        {historyItems.map(item => (
                                            <div key={item.id} className="p-3 md:p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-bold text-slate-900 truncate">{item.clientName || 'Sin nombre'}</div>
                                                    <div className="text-xs text-slate-600 truncate">
                                                        {item.supplier || '—'} · {formatProductDisplayName(item.supplier, item.productName || '—')}
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 truncate">
                                                        {new Date(item.createdAt).toLocaleString('es-ES')} · CUPS: {item.cups || '—'}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => redownloadHistoryPdf(item)}
                                                    className="self-start md:self-center px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-slate-900 text-white hover:bg-slate-800"
                                                >
                                                    Redescargar PDF
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="w-full max-w-7xl mx-auto">
                <div className="relative rounded-3xl p-[1px] bg-gradient-to-br from-[#0017ff]/25 via-[#00d4ff]/12 to-white/70 shadow-2xl shadow-blue-950/10">
                    <div className="bg-white/75 backdrop-blur-xl rounded-[23px] border border-white/60">
                        {/* Sticky header (main) */}
                        <div className="sticky top-0 z-30 rounded-t-[23px] bg-gradient-to-r from-[#0017ff] via-[#0077ff] to-[#00d4ff] text-white shadow-[0_14px_50px_rgba(2,8,23,0.25)]">
                            <div className="px-5 md:px-8 lg:px-10 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-5 md:pb-6">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                    <div className="min-w-0 flex items-center gap-4">
                                        <img
                                            src="/logo_soluciones_vivivan.webp"
                                            alt="Soluciones Vivivan"
                                            className="h-16 md:h-20 lg:h-24 w-auto object-contain flex-shrink-0 drop-shadow-[0_16px_38px_rgba(0,0,0,0.32)]"
                                        />
                                        <div className="hidden sm:block h-14 md:h-16 w-px bg-white/25 flex-shrink-0" aria-hidden="true" />
                                        <div className="min-w-0">
                                            <div className="text-[10px] md:text-[12px] font-black uppercase tracking-[0.26em] text-white/85">
                                                Comparador Vivivan
                                            </div>
                                            <div className="text-2xl md:text-3xl font-extrabold leading-[1.05] drop-shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
                                                Pro
                                            </div>
                                        </div>
                                    </div>

                                    <div className="min-w-0 flex flex-col items-end">
                                        <div className="flex items-center justify-end gap-3 w-full">
                                            <div className="min-w-0 text-right">
                                                <div className="text-[10px] md:text-[12px] font-black uppercase tracking-[0.26em] text-white/80">
                                                    Comercial
                                                </div>
                                                <div className="text-lg md:text-xl font-extrabold truncate drop-shadow-[0_12px_30px_rgba(0,0,0,0.28)] max-w-[14rem] md:max-w-[22rem] ml-auto">
                                                    {commercialName || commercialCode || '—'}
                                                </div>
                                            </div>

                                            <CommercialAvatar
                                                commercialCode={commercialCode}
                                                commercialName={commercialName}
                                                size={44}
                                                className="flex"
                                            />
                                        </div>

                                        <div className="mt-4 flex items-center justify-end gap-2">
                                            {!isAdmin && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPdfHistory(true)}
                                                    className="header-history-btn inline-flex items-center px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/10 border border-white/25 hover:bg-white/20 transition"
                                                >
                                                    Historial PDF
                                                </button>
                                            )}
                                            {!isAdmin && onOpenDashboard && (
                                                <button
                                                    type="button"
                                                    onClick={onOpenDashboard}
                                                    className="inline-flex items-center px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/10 border border-white/25 hover:bg-white/20 transition"
                                                >
                                                    Estadísticas
                                                </button>
                                            )}
                                            {isAdmin && onOpenAdmin && (
                                                <button
                                                    type="button"
                                                    onClick={onOpenAdmin}
                                                    className="inline-flex items-center px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/10 border border-white/25 hover:bg-white/20 transition"
                                                >
                                                    Admin
                                                </button>
                                            )}
                                            {onLogout && (
                                                <button
                                                    type="button"
                                                    onClick={onLogout}
                                                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-red-500/15 border border-red-200/40 text-white hover:bg-red-500/25 transition shadow-[0_10px_25px_rgba(220,38,38,0.20)]"
                                                    title="Salir"
                                                >
                                                    <LogOut size={16} />
                                                    <span className="hidden sm:inline">Salir</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-b-[23px]">
                            {/* Top actions */}
                            <div className="px-5 md:px-8 lg:px-10 py-4 md:py-5 bg-white/60 border-b border-white/60 flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    {formError && <div className="text-[11px] lg:text-[13px] font-bold text-red-600 truncate">{formError}</div>}
                                    {!formError && invoiceStatus && <div className="text-[11px] lg:text-[13px] font-bold text-emerald-700 truncate">{invoiceStatus}</div>}
                                    {!formError && uploadError && <div className="text-[11px] lg:text-[13px] font-bold text-red-600 truncate">{uploadError}</div>}
                                    {!formError && !invoiceStatus && !uploadError && !isUploading && (
                                        <div className="text-[12px] md:text-[13px] font-bold text-slate-700 truncate">
                                            Sube una factura para autocompletar (opcional)
                                        </div>
                                    )}
                                    {isUploading && (
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="text-[11px] lg:text-[13px] font-bold text-cyan-700 truncate">
                                                Analizando factura… {uploadProgress}%
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="application/pdf"
                                        className="hidden"
                                        onChange={handleInvoiceSelected}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleUploadClick}
                                        disabled={isUploading}
                                        className="inline-flex items-center gap-2 px-5 md:px-6 py-3 md:py-3.5 rounded-2xl text-[10px] md:text-[11px] font-black uppercase tracking-widest text-white bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-600 border border-white/30 shadow-xl shadow-emerald-500/25 hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0 transition disabled:opacity-60 disabled:hover:translate-y-0"
                                    >
                                        <Sparkles size={14} />
                                        {isUploading ? 'Leyendo…' : 'Leer factura'}
                                    </button>
                                </div>
                            </div>

                            {/* Barra de progreso de lectura de factura */}
                            <AnimatePresence>
                                {isUploading && (
                                    <motion.div
                                        initial={{ opacity: 0, scaleY: 0 }}
                                        animate={{ opacity: 1, scaleY: 1 }}
                                        exit={{ opacity: 0, scaleY: 0 }}
                                        style={{ transformOrigin: 'top' }}
                                        className="h-1.5 bg-slate-200/60 overflow-hidden"
                                    >
                                        <motion.div
                                            className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 relative"
                                            style={{ width: `${uploadProgress}%` }}
                                            transition={{ duration: 0.15, ease: 'easeOut' }}
                                        >
                                            {/* Brillo deslizante */}
                                            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" />
                                        </motion.div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                        {/* Main grid (no scroll) */}
                        <div className="p-4 md:p-6 lg:p-8">
                            <div className="grid grid-cols-12 gap-3 comparador-form-grid">
                                {/* Cliente */}
                                <div className="col-span-12 lg:col-span-5 rounded-2xl bg-white/60 border border-white/70 p-4 comparador-form-panel">
                                    <h3 className="text-[11px] lg:text-[13px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-3">
                                        <span className="w-7 h-7 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-400 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
                                            <User size={14} />
                                        </span>
                                        Cliente
                                    </h3>

                                    <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-12">
                                    <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Nombre</label>
                                    <input
                                                type="text"
                                                name="clientName"
                                                value={formData.clientName}
                                                onChange={handleInputChange}
                                                className="w-full bg-white border-2 border-slate-200/90 rounded-lg px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.8)] focus:ring-2 focus:ring-blue-200 focus:border-blue-600 outline-none transition-all placeholder:text-slate-300"
                                                placeholder="Ej. Juan Pérez"
                                            />
                                        </div>
                                        <div className="col-span-12">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">CUPS</label>
                                            <input
                                                type="text"
                                                name="cups"
                                                value={formData.cups}
                                                onChange={handleInputChange}
                                                className="w-full bg-white border-2 border-slate-200/90 rounded-lg px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.8)] focus:ring-2 focus:ring-blue-200 focus:border-blue-600 outline-none transition-all placeholder:text-slate-300"
                                                placeholder="ES000..."
                                            />
                                            {formData.energyType === 'electricidad' && annualLookup.status !== 'idle' && annualLookup.cups === normalizedCups && (
                                                <div
                                                    className={[
                                                        'mt-1 text-[10px] lg:text-[11px] font-bold',
                                                        annualLookup.status === 'found'
                                                            ? 'text-emerald-700'
                                                            : annualLookup.status === 'loading'
                                                                ? 'text-blue-600'
                                                                : 'text-amber-700'
                                                    ].join(' ')}
                                                >
                                                    {annualLookup.message}
                                                </div>
                                            )}
                                        </div>
                                        <div className="col-span-12">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Dirección</label>
                                            <input
                                                type="text"
                                                name="address"
                                                value={formData.address}
                                                onChange={handleInputChange}
                                                className="w-full bg-white border-2 border-slate-200/90 rounded-lg px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.8)] focus:ring-2 focus:ring-blue-200 focus:border-blue-600 outline-none transition-all placeholder:text-slate-300"
                                                placeholder="Calle Ejemplo 123, Madrid"
                                            />
                                        </div>

                                        {/* Región + Energía (al lado del cliente) */}
                                        <div className="col-span-12 grid grid-cols-12 gap-2 pt-1">
                                            <div className="col-span-12">
                                                <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Región</label>
                                                <div className="flex gap-1 bg-gradient-to-r from-white to-slate-50 p-1 rounded-xl border-2 border-blue-100 shadow-sm">
                                                    {[
                                                        { id: 'PENINSULA', label: 'Pen' },
                                                        { id: 'BALEARES', label: 'Bal' },
                                                        { id: 'CANARIAS', label: 'Can' },
                                                        { id: 'CEUTA', label: 'Ceu' },
                                                        { id: 'MELILLA', label: 'Mel' }
                                                    ].map(r => (
                                                        <button
                                                            key={r.id}
                                                            type="button"
                                                            onClick={() => setFormData({ ...formData, region: r.id })}
                                                            className={`flex-1 py-2 rounded-lg text-[10px] lg:text-[12px] font-black uppercase transition-all ${
                                                                formData.region === r.id
                                                                    ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-md shadow-blue-500/20'
                                                                    : 'text-slate-600 hover:text-blue-700 hover:bg-white'
                                                            }`}
                                                        >
                                                            {r.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="col-span-12">
                                                <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Energía</label>
                                                <div className="grid grid-cols-2 gap-1 p-1 bg-gradient-to-r from-white to-slate-50 rounded-xl border-2 border-blue-100 shadow-sm">
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormData({ ...formData, energyType: 'electricidad' })}
                                                        className={`py-2 rounded-lg text-[10px] lg:text-[12px] font-black uppercase transition-all ${
                                                            formData.energyType === 'electricidad'
                                                                ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-md shadow-blue-500/20'
                                                                : 'text-slate-600 hover:text-blue-700 hover:bg-white'
                                                        }`}
                                                    >
                                                        Luz
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormData({ ...formData, energyType: 'gas' })}
                                                        className={`py-2 rounded-lg text-[10px] lg:text-[12px] font-black uppercase transition-all ${
                                                            formData.energyType === 'gas'
                                                                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-orange-500/20'
                                                                : 'text-slate-600 hover:text-orange-700 hover:bg-white'
                                                        }`}
                                                    >
                                                        Gas
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Técnico */}
                                <div className="col-span-12 lg:col-span-4 rounded-2xl bg-white/50 border border-white/70 p-4 comparador-form-panel">
                                    <h3 className="text-[11px] lg:text-[13px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-3">
                                        <span className="w-7 h-7 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-400 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
                                            <Zap size={14} />
                                        </span>
                                        Técnico
                                    </h3>

                                    {formData.energyType === 'electricidad' ? (
                                        <>
                                            <div className="grid grid-cols-12 gap-2 mb-2">
                                                <div className="col-span-12 md:col-span-7">
                                                    <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Tarifa</label>
                                                    <div className="flex gap-1 bg-white border border-slate-200 p-0.5 rounded-md">
                                                        {[
                                                            { id: '2.0TD', label: '2.0TD' },
                                                            { id: '3.0TD', label: '3.0TD' },
                                                            { id: '6.1TD', label: '6.1TD' }
                                                        ].map(t => (
                                                            <button
                                                                key={t.id}
                                                                onClick={() => setFormData({ ...formData, tariffType: t.id })}
                                                                className={`flex-1 py-1.5 lg:py-2 rounded text-[10px] lg:text-[12px] font-black uppercase transition-all ${formData.tariffType === t.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-blue-600 hover:bg-slate-50'}`}
                                                            >
                                                                {t.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="col-span-12 md:col-span-5">
                                                    <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block whitespace-nowrap">Cons. Anual kWh</label>
                                                    <input
                                                        ref={caeInputRef}
                                                        type="number"
                                                        name="cae"
                                                        value={formData.cae}
                                                        onChange={handleInputChange}
                                                        className={[
                                                            "w-full bg-white border-2 border-slate-200/90 rounded-lg px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.8)] outline-none transition-all placeholder:text-slate-300",
                                                            formError && (!formData.cae || Number(formData.cae) <= 0)
                                                                ? "focus:ring-2 focus:ring-red-200 focus:border-red-500 border-red-400"
                                                                : "focus:ring-2 focus:ring-blue-200 focus:border-blue-600"
                                                        ].join(' ')}
                                                        placeholder="kWh/año"
                                                    />
                                                </div>
                                            </div>

                                            {(() => {
                                                const consumptionPeriods = formData.tariffType === '2.0TD' ? 3 : 6
                                                const powerPeriods = formData.tariffType === '2.0TD' ? 2 : 6

                                                return (
                                                    <div className="space-y-2 bg-white p-3 rounded-xl border border-blue-100 shadow-sm">
                                                        <div>
                                                            <label className="text-[10px] lg:text-[12px] font-black text-blue-300 uppercase tracking-widest mb-1 block flex items-center gap-2">
                                                                <BarChart3 size={12} /> Consumo (kWh)
                                                            </label>
                                                            <div className="grid grid-cols-3 gap-2">
                                                                {[...Array(consumptionPeriods)].map((_, idx) => {
                                                                    const p = idx + 1
                                                                    return (
                                                                        <div key={`c${p}`} className="relative">
                                                                            <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] lg:text-[12px] font-bold text-blue-300 pointer-events-none">P{p}</div>
                                                                            <input
                                                                                type="number"
                                                                                name={`consumptionP${p}`}
                                                                                placeholder="0"
                                                                                value={formData[`consumptionP${p}`]}
                                                                                onChange={handleInputChange}
                                                                                className="w-full text-right bg-slate-50 border-2 border-slate-200/90 rounded-lg py-1.5 lg:py-2 pr-2 pl-6 font-semibold text-slate-800 text-xs lg:text-sm shadow-[0_1px_0_rgba(255,255,255,0.8)] focus:ring-2 focus:ring-blue-200 focus:border-blue-600 outline-none transition-all focus:bg-white"
                                                                            />
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div className="border-t border-slate-100 pt-2">
                                                            <label className="text-[10px] lg:text-[12px] font-black text-blue-300 uppercase tracking-widest mb-1 block flex items-center gap-2">
                                                                <Zap size={12} /> Potencia (kW)
                                                            </label>
                                                            <div className={`grid ${powerPeriods === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
                                                                {[...Array(powerPeriods)].map((_, idx) => {
                                                                    const p = idx + 1
                                                                    return (
                                                                        <div key={`p${p}`} className="relative">
                                                                            <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] lg:text-[12px] font-bold text-blue-300 pointer-events-none">P{p}</div>
                                                                            <input
                                                                                type="number"
                                                                                name={`potenciaP${p}`}
                                                                                placeholder="0"
                                                                                value={formData[`potenciaP${p}`]}
                                                                                onChange={handleInputChange}
                                                                                className="w-full text-right bg-slate-50 border-2 border-slate-200/90 rounded-lg py-1.5 lg:py-2 pr-2 pl-6 font-semibold text-slate-800 text-xs lg:text-sm shadow-[0_1px_0_rgba(255,255,255,0.8)] focus:ring-2 focus:ring-blue-200 focus:border-blue-600 outline-none transition-all focus:bg-white"
                                                                            />
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })()}
                                        </>
                                    ) : (
                                        <div className="grid grid-cols-12 gap-2">
                                            <div className="col-span-12">
                                                <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Tarifa Gas</label>
                                                <div className="flex gap-1 bg-white border border-slate-200 p-0.5 rounded-md">
                                                    {[
                                                        { id: 'RL1', label: 'RL.1' },
                                                        { id: 'RL2', label: 'RL.2' },
                                                        { id: 'RL3', label: 'RL.3' },
                                                        { id: 'RL4', label: 'RL.4' },
                                                        { id: 'RL5', label: 'RL.5' }
                                                    ].map(t => (
                                                        <button
                                                            key={t.id}
                                                            onClick={() => setFormData({ ...formData, gasTariffBand: t.id })}
                                                            className={`flex-1 py-1.5 lg:py-2 rounded text-[10px] lg:text-[12px] font-black uppercase transition-all ${formData.gasTariffBand === t.id ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-500 hover:text-orange-600 hover:bg-slate-50'}`}
                                                        >
                                                            {t.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="col-span-6">
                                                <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Consumo Mes</label>
                                                <input
                                                    type="number"
                                                    name="gasMonthlyConsumption"
                                                    value={formData.gasMonthlyConsumption}
                                                    onChange={handleInputChange}
                                                    className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                                                    placeholder="kWh"
                                                />
                                            </div>
                                            <div className="col-span-6">
                                                <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Fijo Diario</label>
                                                <input
                                                    type="number"
                                                    name="gasFixedDaily"
                                                    value={formData.gasFixedDaily}
                                                    onChange={handleInputChange}
                                                    className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                                                    placeholder="€/día"
                                                />
                                            </div>
                                            <div className="col-span-12">
                                                <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block whitespace-nowrap">Cons. Anual kWh</label>
                                                <input
                                                    ref={caeInputRef}
                                                    type="number"
                                                    name="cae"
                                                    value={formData.cae}
                                                    onChange={handleInputChange}
                                                    className={[
                                                        "w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-700 outline-none",
                                                        formError && (!formData.cae || Number(formData.cae) <= 0)
                                                            ? "focus:ring-1 focus:ring-red-300 focus:border-red-500 border-red-400"
                                                            : "focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
                                                    ].join(' ')}
                                                    placeholder="kWh/año"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                        <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-0.5 block">Segmento</label>
                                        <div className="mb-2 text-[10px] lg:text-[11px] font-semibold text-slate-500 leading-snug max-w-[32rem]">
                                            Todas muestra el catálogo completo. Usa un segmento para limitar resultados.
                                        </div>
                                        <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-gradient-to-r from-white to-slate-50 rounded-xl border-2 border-blue-100 shadow-sm">
                                            {[
                                                { id: 'todos', label: 'Todas', icon: Sparkles },
                                                { id: 'residencial', label: 'Residencial', icon: Home },
                                                { id: 'autonomo', label: 'Autónomo', icon: User },
                                                { id: 'pyme', label: 'Pyme', icon: Building2 }
                                            ].map(segment => {
                                                const Icon = segment.icon
                                                const active = formData.clientType === segment.id || (segment.id === 'todos' && !formData.clientType) || (segment.id === 'residencial' && formData.clientType === 'hogar')
                                                return (
                                                    <button
                                                        key={segment.id}
                                                        type="button"
                                                        onClick={() => setFormData({ ...formData, clientType: segment.id })}
                                                        className={`min-w-0 h-9 flex items-center justify-center gap-1.5 px-2.5 rounded-lg text-[10px] lg:text-[11px] font-black uppercase tracking-normal transition-all ${
                                                            active
                                                                ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-md shadow-blue-500/20'
                                                                : 'text-slate-600 hover:text-blue-700 hover:bg-white'
                                                        }`}
                                                        title={segment.label}
                                                    >
                                                        <Icon size={13} className="shrink-0" />
                                                        <span className="leading-none whitespace-nowrap">{segment.label}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>

                                </div>

                                {/* Factura + acciones */}
                                <div className="col-span-12 lg:col-span-3 rounded-2xl bg-white/60 border border-white/70 p-4 flex flex-col comparador-form-panel">
                                    <h3 className="text-[11px] lg:text-[13px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-3">
                                        <span className="w-7 h-7 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-400 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                                            <FileDigit size={14} />
                                        </span>
                                        Factura
                                    </h3>

                                    <div className="grid grid-cols-12 gap-2">
                                        <div className="col-span-12">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-green-700 uppercase tracking-wider mb-1 block">Total Factura</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-700 font-black text-sm">€</span>
                                                <input
                                                    type="number"
                                                    name="currentBill"
                                                    value={formData.currentBill}
                                                    onChange={handleInputChange}
                                                    className="w-full bg-green-50/60 border border-green-200 rounded-md pl-7 pr-3 py-2 font-black text-green-800 text-sm focus:ring-1 focus:ring-green-500 focus:border-green-500 outline-none transition-all placeholder:text-green-300"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                            <div className="mt-1 text-[11px] font-semibold text-slate-500">
                                                Si el total es un abono, introduce el signo negativo (por ejemplo: -1516.92).
                                            </div>
                                            {invoiceUsed && Number(invoiceExtractedCurrentBill) < 0 && (
                                                <div className="mt-1 text-[11px] font-semibold text-amber-700">
                                                    Factura leída con total negativo. Mantén el signo negativo para que el ahorro sea correcto.
                                                </div>
                                            )}
                                        </div>

                                        <div className="col-span-6">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Días</label>
                                            <input
                                                type="number"
                                                name="billingDays"
                                                value={formData.billingDays}
                                                onChange={handleInputChange}
                                                className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
                                                placeholder="30"
                                            />
                                        </div>

                                        <div className="col-span-6">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Alquiler</label>
                                            <input
                                                type="number"
                                                name="equipmentRental"
                                                value={formData.equipmentRental}
                                                onChange={handleInputChange}
                                                className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 text-right"
                                                placeholder="0"
                                            />
                                        </div>

                                        <div className="col-span-6">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Otros</label>
                                            <input
                                                type="number"
                                                name="otherCosts"
                                                value={formData.otherCosts}
                                                onChange={handleInputChange}
                                                className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 text-right"
                                                placeholder="0"
                                            />
                                        </div>
                                        <div className="col-span-6">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Bono</label>
                                            <input
                                                type="number"
                                                name="socialBonus"
                                                value={formData.socialBonus}
                                                onChange={handleInputChange}
                                                className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 text-right"
                                                placeholder="0"
                                            />
                                        </div>
                                        <div className="col-span-12 text-[10px] lg:text-[11px] font-semibold text-slate-500">
                                            Excesos, reactiva y excedentes son campos manuales: la lectura de factura no los autocompleta.
                                        </div>
                                        <div className="col-span-6">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Excesos</label>
                                            <input
                                                type="number"
                                                name="excessPower"
                                                value={formData.excessPower}
                                                onChange={handleInputChange}
                                                className="w-full bg-red-50/70 border border-red-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-red-700 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400 text-right placeholder:text-red-200"
                                                placeholder="0"
                                            />
                                        </div>
                                        <div className="col-span-6">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-blue-900/60 uppercase tracking-wider mb-1 block">Reactiva</label>
                                            <input
                                                type="number"
                                                name="reactiveEnergy"
                                                value={formData.reactiveEnergy}
                                                onChange={handleInputChange}
                                                className="w-full bg-red-50/70 border border-red-200 rounded-md px-3 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold text-red-700 outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400 text-right placeholder:text-red-200"
                                                placeholder="0"
                                            />
                                        </div>
                                        <div className="col-span-12">
                                            <label className="text-[10px] lg:text-[12px] font-bold text-green-700 uppercase tracking-wider mb-1 block">Excedentes (Descuento)</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-700 font-black text-sm">-€</span>
                                                <input
                                                    type="number"
                                                    name="surpluses"
                                                    value={formData.surpluses}
                                                    onChange={handleInputChange}
                                                    className="w-full bg-emerald-50/70 border border-emerald-200 rounded-md pl-9 pr-3 py-2 font-black text-emerald-800 text-sm focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all placeholder:text-emerald-200"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-3 pt-3 border-t border-white/70 flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={resetForm}
                                            className="text-[10px] lg:text-[12px] font-black text-slate-700 uppercase tracking-widest bg-white/70 hover:bg-white border border-white/80 px-3 py-2 rounded-xl transition shadow-sm"
                                        >
                                            <span className="inline-flex items-center gap-2">
                                                <RefreshCw size={12} /> Limpiar
                                            </span>
                                        </button>

                                        <button
                                            onClick={handleCalculate}
                                            disabled={isCalculating || !isCaeValid}
                                            title={!isCaeValid ? 'Completa el Cons. Anual (kWh) para poder calcular' : 'Calcular'}
                                            className="ml-auto bg-gradient-to-r from-[#0017ff] via-[#0077ff] to-[#00d4ff] text-white px-4 py-2 rounded-xl text-[11px] lg:text-[13px] font-extrabold uppercase tracking-widest shadow-xl shadow-blue-700/25 hover:brightness-110 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {isCalculating ? 'Calculando…' : 'Calcular'} <ChevronRight size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

}
