
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { recordComparison } from './historyStore';
import { recordPdfDownload } from './pdfDownloadStore';

export async function generatePDF(formData, selectedResult, { commercialCode, commercialName, fromHistory = false } = {}) {
    if (!selectedResult) return;

    try {
        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const commercialDisplayRaw = (commercialName || '').trim() || (commercialCode || '').trim();
        const commercialMetaHtml = commercialDisplayRaw
            ? `<div class="meta">Comercial: ${escapeHtml(commercialDisplayRaw)}</div>`
            : '';

        // iOS/Safari + html2canvas can crash when rendering CSS gradients (createPattern with 0x0 canvas).
        // Use solid-color fallbacks to keep PDF generation reliable on iPad (notably with some brand configs).
        const pdfCanvasSafeMode = (() => {
            try {
                if (typeof navigator === 'undefined') return false;
                const ua = navigator.userAgent || '';
                const isIOS = /iPad|iPhone|iPod/i.test(ua);
                const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
                return isIOS || isIPadOS;
            } catch {
                return false;
            }
        })();

        const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
        const resolveAssetUrl = (p) => {
            if (!p) return '';
            const s = String(p);
            if (/^https?:\/\//i.test(s)) return s;
            if (!origin) return s;
            if (s.startsWith('/')) return origin + s;
            return origin + '/' + s.replace(/^\.?\//, '');
        };
        const waitForIframeImages = async (doc, timeoutMs = 5000) => {
            const imgs = Array.from(doc?.images || []);
            if (imgs.length === 0) return;

            const withTimeout = (promise) => new Promise((resolve) => {
                const t = setTimeout(() => resolve(false), timeoutMs);
                promise.then(() => { clearTimeout(t); resolve(true); }).catch(() => { clearTimeout(t); resolve(false); });
            });

            await Promise.all(imgs.map(img => {
                if (img.complete && img.naturalWidth > 0) return Promise.resolve(true);
                return withTimeout(new Promise((resolve) => {
                    const cleanup = () => {
                        img.removeEventListener('load', onLoad);
                        img.removeEventListener('error', onError);
                    };
                    const onLoad = () => { cleanup(); resolve(true); };
                    const onError = () => { cleanup(); resolve(false); };
                    img.addEventListener('load', onLoad);
                    img.addEventListener('error', onError);
                }));
            }));
        };

        // Load supplier branding data
        let supplierBranding = {};
        try {
            const brandingRes = await fetch('/supplier-branding.json');
            if (brandingRes.ok) {
                supplierBranding = await brandingRes.json();
            }
        } catch (err) {
            console.warn('Could not load supplier branding:', err);
        }

        const today = new Date();
        const dateStr = today.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
        
        // Get supplier-specific branding or fallback
        const supplierKey = (selectedResult.supplier || '').toString().trim().toUpperCase();
        const supplierData = supplierBranding[supplierKey] || {};
        
        const branding = {
            primaryColor: supplierData.primaryColor || '#ff6b00',
            secondaryColor: supplierData.secondaryColor || '#1e293b',
            // In production (Vercel), only `/public/*` is served. Use a public logo as fallback.
            logo: supplierData.logo || '/LogoLoviluz.svg',
            name: supplierData.name || selectedResult.supplier || 'Comercializadora'
        };
        // Normalize logo path and make it absolute for html2canvas inside the iframe.
        const logoPath = (branding.logo || '').startsWith('/') ? branding.logo : `/${branding.logo || ''}`;
        branding.logo = resolveAssetUrl(logoPath);

        const isGasPdf = formData.energyType === 'gas';
        const tariffType = isGasPdf ? 'GAS' : (formData.tariffType || '2.0TD');
        
        const periodsConsumo = isGasPdf ? [] : (tariffType === "2.0TD" ? ["P1", "P2", "P3"] : ["P1", "P2", "P3", "P4", "P5", "P6"]);
        const periodsPotencia = isGasPdf ? [] : (tariffType === "2.0TD" ? ["P1", "P2"] : ["P1", "P2", "P3", "P4", "P5", "P6"]);

        let consumoPrices = selectedResult.pricingConsumo || {};
        let potenciaPrices = selectedResult.pricingPotencia || {};

        // Fallback: Extract prices from details if missing at top level
        // details already defined above
        const details = selectedResult.details || {};
        
        if (Object.keys(consumoPrices).length === 0 && details.energyBreakdown) {
            Object.entries(details.energyBreakdown).forEach(([p, data]) => {
                consumoPrices[p] = data.price;
            });
        }
        if (Object.keys(potenciaPrices).length === 0 && details.powerBreakdown) {
             Object.entries(details.powerBreakdown).forEach(([p, data]) => {
                 potenciaPrices[p] = data.price;
             });
        }

        const cae = parseFloat(formData.cae) || 0;
        const currentBill = parseFloat(formData.currentBill) || 0;
        
        // Ensure maxBill is at least 1 to avoid division by zero
        const maxBill = Math.max(currentBill, selectedResult.total) || 1;
        const currentPct = Math.max(5, Math.min(100, (currentBill / maxBill) * 100));
        const proposedPct = Math.max(5, Math.min(100, (selectedResult.total / maxBill) * 100));
        const derivedSavingsPct = currentBill > 0 ? ((currentBill - selectedResult.total) / currentBill) * 100 : 0;
        const rawSavingsPct = Number(selectedResult.savingsPercent);
        const savingsPctNum = Number.isFinite(rawSavingsPct) ? rawSavingsPct : (Number.isFinite(derivedSavingsPct) ? derivedSavingsPct : 0);
        const savingsPctClamped = Math.max(0, Math.min(100, savingsPctNum));
        const savingsPercentDisplay = savingsPctClamped.toFixed(2);

        const consumoValues = periodsConsumo.map(p => parseFloat(formData[`consumption${p}`]) || 0);
        const potenciaValues = periodsPotencia.map(p => parseFloat(formData[`potencia${p}`]) || 0);

        const maxConsumoVal = Math.max(...consumoValues, 1);
        const maxPotVal = Math.max(...potenciaValues, 1);
        const maxPotenciaPdf = Math.max(...potenciaValues, 0);

        // Tax Logic Placeholder
        const impLabelPdf = isGasPdf ? 'Impuesto hidrocarburos' : 'Impuesto Energía';
        
        const d_energyCost = details.energyCost || 0;
        const d_powerCost = details.powerCost || 0;
        const d_equipmentRental = details.equipmentRental || 0;
        const d_otherCosts = details.otherCosts || 0;
        const d_subtotal = details.subtotal || 0;
        const d_electricityTax = details.electricityTax || 0;
        const d_vat = details.vatAmount || details.vat || 0; 
        const d_discounts = details.discounts || { energy: 0, power: 0 };
        const d_extras = details.extras || { reactiveEnergy: 0, excessPower: 0 };
        const d_serviceAdjustment = Number(details.serviceAdjustmentAmount ?? selectedResult.serviceAdjustmentAmount ?? 0) || 0;
        const serviceAdjustmentLabel = details.serviceAdjustmentLabel || selectedResult.serviceAdjustmentLabel || 'Ajustes de servicio';
        const serviceAdjustmentLabelSuffix = '';

        // Calculate VAT rate properly
        const vatRatePdf = details.vatRate ? details.vatRate * 100 : 21;
        const vatLabelPdf = `IVA/IGIC/IPSI ${vatRatePdf.toFixed(1)}%`;
        const annualSavingsVal = parseFloat(selectedResult.annualSavings) || 0;
        const colorActual = '#ef4444';
        const colorAhorro = '#16a34a';

        // --- Extra Graphs logic (Pareto, Columns, Stacks) ---
        const netEnergy = Math.max(0, d_energyCost - (d_discounts.energy || 0));
        const netPower = Math.max(0, d_powerCost - (d_discounts.power || 0));
        const netTaxes = Math.max(0, (d_electricityTax || 0) + (d_vat || 0));
        const netExtras = Math.max(0, (d_extras.reactiveEnergy || 0) + (d_extras.excessPower || 0) + d_serviceAdjustment + d_equipmentRental + d_otherCosts);
        const totalComponents = netEnergy + netPower + netTaxes + netExtras || 1;
        const savingsTotal = Math.max(0, currentBill - selectedResult.total);

        const paretoBase = [
            { label: 'Energía', value: netEnergy, color: '#16a34a' },
            { label: 'Potencia', value: netPower, color: '#0ea5e9' },
            { label: 'Impuestos', value: netTaxes, color: '#6b7280' },
            { label: 'Extras', value: netExtras, color: '#f59e0b' }
        ].filter(i => i.value > 0);

        const paretoItems = paretoBase
            .map(i => ({ ...i, contrib: savingsTotal * (i.value / totalComponents) }))
            .sort((a, b) => b.contrib - a.contrib)
            .slice(0, 4)
            .map(i => ({ ...i, perc: savingsTotal ? (i.contrib / savingsTotal) * 100 : 0 }));

        const impactRows = paretoItems.map(i => `
            <div class="impact-row">
                <div class="impact-label">${i.label}</div>
                <div class="impact-bar"><div class="impact-fill" style="width:${Math.min(100, i.perc).toFixed(1)}%;background:${i.color};"></div></div>
                <div class="impact-num">€ ${i.contrib.toFixed(2)}</div>
                <div class="impact-pct">${i.perc.toFixed(1)}%</div>
            </div>
        `).join('') || '<div class="impact-row"><div class="impact-label">Sin datos detallados</div></div>';

        const totalConsumo = consumoValues.reduce((a, b) => a + b, 0) || 1;
        const totalPot = potenciaValues.reduce((a, b) => a + b, 0) || 1;
        const consumoPalette = ['#16a34a','#22c55e','#4ade80','#86efac','#bbf7d0','#e2f6e9'];
        const potenciaPalette = ['#ef4444','#f87171','#fca5a5','#fecdd3','#fee2e2','#fff1f2'];

        const consumoLegend = periodsConsumo.map((p, idx) => `<div class="legend-item"><div class="legend-swatch" style="background:${consumoPalette[idx % consumoPalette.length]};"></div><div class="legend-label">${p}</div></div>`).join('');
        const potenciaLegend = periodsPotencia.map((p, idx) => `<div class="legend-item"><div class="legend-swatch" style="background:${potenciaPalette[idx % potenciaPalette.length]};"></div><div class="legend-label">${p}</div></div>`).join('');

        const consumoStack = periodsConsumo.map((p, idx) => {
            const kwh = consumoValues[idx];
            const pct = Math.max(0, (kwh / totalConsumo) * 100);
            return `<div class="stack-segment" style="width:${pct}%;background:${consumoPalette[idx % consumoPalette.length]}"><span>${pct.toFixed(0)}%</span></div>`;
        }).join('');

        const potenciaStack = periodsPotencia.map((p, idx) => {
            const kw = potenciaValues[idx];
            const pct = Math.max(0, (kw / totalPot) * 100);
            return `<div class="stack-segment" style="width:${pct}%;background:${potenciaPalette[idx % potenciaPalette.length]}"><span>${pct.toFixed(0)}%</span></div>`;
        }).join('');

        const consumoColumns = periodsConsumo.map((p, idx) => {
            const kwh = parseFloat(formData[`consumption${p}`]) || 0;
            const h = Math.max(8, (kwh / maxConsumoVal) * 60);
            return `<div class="mini-col"><div class="mini-bar" style="height:${h}px"></div><div class="mini-col-label">${p}</div><div class="mini-col-value">${kwh.toFixed(0)} kWh</div></div>`;
        }).join("");

        const potenciaColumns = periodsPotencia.map((p, idx) => {
            const kw = parseFloat(formData[`potencia${p}`]) || 0;
            const h = Math.max(8, (kw / maxPotVal) * 60);
            return `<div class="mini-col"><div class="mini-bar" style="height:${h}px"></div><div class="mini-col-label">${p}</div><div class="mini-col-value">${kw.toFixed(0)} kW</div></div>`;
        }).join("");

        const miniBarBg = pdfCanvasSafeMode
            ? colorAhorro
            : `linear-gradient(180deg, ${colorAhorro} 0%, ${branding.secondaryColor} 100%)`;
        const chartCardBg = pdfCanvasSafeMode
            ? '#f8fafc'
            : `linear-gradient(135deg,#f8fafc 0%,#ffffff 70%,#f8fafc 100%)`;
        const currentBarFillBg = colorActual;
        const proposedBarFillBg = colorAhorro;

        const extraCss = `
            /* Evitar CSS Grid en PDF (html2canvas puede solapar elementos) */
            .mini-section{display:flex;gap:8px;margin-top:6px;margin-bottom:6px;align-items:stretch}
            .mini-chart{flex:1 1 0;min-width:0}
            .mini-chart{border:1px solid ${branding.primaryColor}22;border-radius:10px;padding:6px 6px 7px 6px;background:#ffffff;box-shadow:0 2px 4px rgba(0,0,0,.05)}
            .mini-title{font-weight:900;color:${branding.secondaryColor};font-size:10px;margin-bottom:8px;display:flex;align-items:center;gap:4px;letter-spacing:.15px}
            .mini-cols{display:flex;align-items:flex-end;gap:10px;justify-content:space-between}
            .mini-col{display:flex;flex-direction:column;align-items:center;gap:2px}
            .mini-bar{width:14px;background:${miniBarBg};border-radius:4px 4px 2px 2px;border:1px solid ${branding.primaryColor}33;box-shadow:0 2px 4px rgba(0,0,0,.08)}
            .mini-col-label{text-align:center;font-size:9px;margin-top:3px;color:#475569}
            .mini-col-value{text-align:center;font-size:9px;color:#0f172a;font-weight:700}
            .impact-row{display:flex;align-items:center;gap:6px;font-size:9px;margin-bottom:5px}
            .impact-label{font-weight:700;color:#0f172a}
            .impact-bar{height:9px;background:#f1f5f9;border-radius:999px;border:1px solid ${branding.primaryColor}22;overflow:hidden}
            .impact-fill{height:100%;border-radius:999px}
            .impact-num{text-align:right;font-weight:700;color:#0f172a}
            .impact-pct{text-align:right;font-weight:800;color:${branding.primaryColor}}
            .impact-label{flex:0 0 90px}
            .impact-bar{flex:1 1 auto}
            .impact-num{flex:0 0 60px}
            .impact-pct{flex:0 0 40px}
            .stack-section {
                display:flex;
                flex-direction: column;
                gap: 8px;
                margin-top: 6px;
            }
            .stack-title{
                font-size:9px;
                font-weight:700;
                color:${branding.secondaryColor};
                margin-bottom:8px;
            }
            .stack-bar{
                display:flex;
                height:20px;
                border-radius:4px;
                overflow:hidden;
                border:1px solid ${branding.primaryColor}22;
            }
            .stack-segment{
                display:flex;
                align-items:center;
                justify-content:center;
                font-size:8.5px;
                font-weight:700;
                color:#ffffff;
                text-shadow:0 1px 2px rgba(0,0,0,0.3);
                position:relative;
            }
            .stack-segment span{
                position:absolute;
                inset:0;
                display:flex;
                align-items:center;
                justify-content:center;
                min-width:24px;
                white-space:nowrap;
                overflow:hidden;
            }
            .stack-legend{
                display:flex;
                flex-wrap:wrap;
                gap:8px;
                margin-top:6px;
            }
            .legend-item{
                display:flex;
                align-items:center;
                gap:4px;
                font-size:8px;
            }
            .legend-swatch{
                width:10px;
                height:10px;
                border-radius:2px;
                border:1px solid #cbd5e1;
            }
            .legend-label{
                font-weight:600;
                color:#475569;
            }
            .title{
                font-size:10px;
                font-weight:700;
                color:${branding.secondaryColor};
                margin-bottom:8px;
            }
            .chart-extras{
                display:flex;
                gap:10px;
                margin-top:8px;
                margin-bottom:10px;
                align-items:stretch;
                page-break-inside: avoid;
            }
            .card-lite {
                padding: 8px;
                border:1px solid ${branding.primaryColor}22;
                border-radius:10px;
                background:#ffffff;
                box-shadow:0 2px 4px rgba(0,0,0,.05);
                height: 100%;
                display: flex;
                flex-direction: column;
            }
            .chart-extras>.card-lite{flex:1 1 0;min-width:0}
            .card-lite,.mini-chart{break-inside:avoid}
        `;
        // Footer is added laterally via jsPDF, no need for HTML footer

        // --- HTML Construction ---
        
        // Gauge SVG
        const circRadius = 62;
        const circPerimeter = 2 * Math.PI * circRadius;
        const gaugeDash = (savingsPctClamped / 100) * circPerimeter;
        const gaugeSVG = `
            <svg class="gauge-svg" viewBox="0 0 180 180" width="128" height="128" aria-label="Ahorro">
                <circle cx="90" cy="90" r="${circRadius}" fill="none" stroke="#e5e7eb" stroke-width="16" />
                <circle cx="90" cy="90" r="${circRadius}" fill="none" stroke="${colorAhorro}" stroke-width="16"
                    stroke-linecap="round" stroke-dasharray="${gaugeDash} ${circPerimeter}"
                    transform="rotate(-90 90 90)" />
                <text x="90" y="82" text-anchor="middle" class="gauge-text-main">${savingsPercentDisplay}%</text>
                <text x="90" y="100" text-anchor="middle" class="gauge-text-sub">AHORRO ANUAL</text>
                <text x="90" y="118" text-anchor="middle" class="gauge-text-amount">€ ${annualSavingsVal.toFixed(2)}/año</text>
            </svg>`;

        let htmlContent;

        // Service adjustment note
        const needsServiceNote = d_serviceAdjustment > 0;
        const serviceAdjustmentFootnoteHtml = needsServiceNote ? `<div style="font-size:8px;color:#94a3b8;margin-top:6px;font-style:italic">* Servicios de ajuste aproximados, puede variar el precio ligeramente.</div>` : ''

        if (isGasPdf) {
            // Gas Specific Data
            const gasMonthly = parseFloat(formData.gasMonthlyConsumption) || 0;
            const gasAnnual = parseFloat(formData.cae) || 0;
            const gasBand = selectedResult.gasBand || formData.gasTariffBand;
            const gasFixedDaily = selectedResult.fixedDaily ?? 0;
            const gasBillingDays = parseInt(formData.billingDays) || 30;
            const gasFixedCost = gasFixedDaily * gasBillingDays;
            const gasVariableKwh = selectedResult.variableKwh ?? 0;
            const gasVariableCost = d_energyCost || (gasMonthly * gasVariableKwh);
            
            const gasExtras = d_equipmentRental + d_otherCosts;
            
            // Gas Stack
            const gasStackParts = [
                { label: 'Fijo', value: gasFixedCost, color: '#0ea5e9' },
                { label: 'Variable', value: gasVariableCost, color: '#16a34a' },
                { label: 'Impuestos', value: (d_electricityTax || 0) + (d_vat || 0), color: '#6b7280' },
                { label: 'Otros', value: gasExtras, color: '#f59e0b' }
            ].filter(i => i.value > 0);
            
            const gasTotalStack = gasStackParts.reduce((acc, i) => acc + i.value, 0) || 1;
            const gasStackBar = gasStackParts.map(i => {
                const pct = Math.max(0, (i.value / gasTotalStack) * 100);
                return `<div class="stack-segment" style="width:${pct}%;background:${i.color}"><span>${pct.toFixed(0)}%</span></div>`
            }).join('');

            htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            *{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
            @media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
            .page{padding:6mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#334155;background:#ffffff;width:210mm;min-height:297mm;line-height:1.25}
            .topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:3px solid ${branding.primaryColor}}
            .topbar-left{display:flex;align-items:center;gap:12px}
            .logo-img{width:80px;height:auto;max-height:50px;object-fit:contain}
            .title{font-size:18px;font-weight:700;color:${branding.primaryColor};letter-spacing:.5px}
            .subtitle{font-size:10px;color:${branding.secondaryColor};font-weight:500;margin-top:2px}
            .topbar-right{text-align:right;font-size:9px;color:#64748b}
            .box{border:1.5px solid ${branding.primaryColor}33;border-radius:10px;background:#ffffff;box-shadow:0 2px 5px rgba(0,0,0,.04);margin-bottom:6px}
            .box .hd{background:${branding.primaryColor};padding:5px 7px;font-weight:700;color:#ffffff;font-size:10px;display:flex;align-items:center;gap:6px;border-radius:8px 8px 0 0;text-transform:uppercase;letter-spacing:.3px}
            .box .bd{padding:6px 7px}
            .info-grid{display:flex;flex-wrap:wrap;gap:4px}
            .info-item{flex:1 1 calc(33.333% - 4px);background:${branding.primaryColor}10;border-left:4px solid ${branding.primaryColor};border-radius:6px;padding:6px 8px;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px}
            .info-label{font-weight:800;color:${branding.secondaryColor};font-size:8px;text-transform:uppercase;letter-spacing:.35px;line-height:1.1}
            .info-value{font-weight:800;color:#0f172a;font-size:10.5px;margin-top:0;word-break:break-word;line-height:1.2}
            table{width:100%;border-collapse:separate;border-spacing:0;font-size:9px;table-layout:fixed}
            thead th{background:${branding.primaryColor};color:#ffffff;font-weight:600;border:1px solid ${branding.secondaryColor};padding:5px 6px}
            tbody td{border:1px solid ${branding.primaryColor}33;background:#ffffff;padding:4px 5px}
            tfoot td{border:1px solid ${branding.primaryColor}66;padding:4px 5px}
            th,td{text-align:right}
            th:first-child,td:first-child{text-align:left}
            th,td{vertical-align:middle}
            .tot{font-weight:700;background:${branding.primaryColor}22;color:${branding.secondaryColor}}
            .highlight-red{color:#dc2626;font-weight:600;font-size:12px}
            .highlight-green{color:#15803d;font-weight:600;font-size:12px}
            .annual-savings{color:#facc15;font-size:16px;font-weight:900;margin-bottom:2px;text-transform:uppercase}
            .annual-percent{color:${branding.secondaryColor};font-size:10px;font-weight:700}
            .split{display:flex;gap:6px;align-items:stretch}
            .split>.box{flex:1 1 0;min-width:0}
            .compact-table{font-size:8.4px}
            .compact-table th,.compact-table td{padding:4px 5px;line-height:1.25}
            .bar-chart{margin-top:6px}
            .bar-row{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:9px;color:#334155;line-height:1.1}
            .bar-label{flex:0 0 95px;font-weight:700}
            .mini-bars{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
            .bar-wrap{flex:1;display:flex;align-items:center;gap:6px;min-width:0}
            .bar{flex:1 1 160px;min-width:140px;height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;position:relative;border:1px solid #cbd5e1}
            .bar-fill{height:100%;border-radius:999px;transition:width .3s ease;box-shadow:0 2px 6px rgba(0,0,0,.1)}
            .bar-value{min-width:62px;text-align:right;font-weight:900;color:${branding.secondaryColor};font-size:9px}
            .chart-card{background:${chartCardBg};border:1px solid ${branding.primaryColor}22;border-radius:12px;padding:6px;box-shadow:0 3px 10px rgba(0,0,0,.08)}
            .chart-layout{display:flex;gap:10px;align-items:center}
            .gauge{position:relative;flex:0 0 128px;width:128px;height:128px;display:flex;align-items:center;justify-content:center}
            .gauge-svg text{font-family:Arial,Helvetica,sans-serif}
            .gauge-text-main{font-weight:900;font-size:16px;fill:#0f172a}
            .gauge-text-sub{font-size:9px;font-weight:800;letter-spacing:.25px;text-transform:uppercase;fill:#334155}
            .gauge-text-amount{font-size:10px;font-weight:900;fill:${colorAhorro}}
            .pill{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:999px;font-size:8.5px;font-weight:800;border:1px solid ${branding.primaryColor}22;background:${branding.primaryColor}08;color:${branding.secondaryColor};margin-top:4px}
            .pill span{font-weight:600;color:#0f172a}
            .pill-alt{border-color:${branding.secondaryColor}33;background:${branding.secondaryColor}12;color:${branding.primaryColor}}
            .pill-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
            .pill-negative{border-color:${colorActual}33;background:${colorActual}12;color:${colorActual}}
            .pill-positive{border-color:${colorAhorro}33;background:${colorAhorro}12;color:${colorAhorro}}
            .legend-item{display:flex;align-items:center;gap:4px}
            .legend-swatch{width:10px;height:10px;border-radius:2px;border:1px solid #cbd5e1}
            .legend-label{font-weight:600}
            ${extraCss}
            </style></head><body>
            <div class="page">
                <style>${extraCss}</style>
                <div class="topbar">
                    <div class="topbar-left">
                        <img class="logo-img" src="${branding.logo}" alt="Logo" onerror="this.style.display='none'"/>
                        <div><div class="subtitle">Propuesta de Gas Personalizada</div></div>
                    </div>
                    <div class="topbar-right"><div class="meta">Fecha: ${dateStr}</div>${commercialMetaHtml}</div>
                </div>

                <div class="box"><div class="hd">Datos del cliente</div><div class="bd"><div class="info-grid">
                    <div class="info-item"><div class="info-label">Cliente / CUPS</div><div class="info-value">${formData.clientName || '-'} | ${formData.cups || '-'}</div></div>
                    <div class="info-item"><div class="info-label">Peaje / Días</div><div class="info-value">${gasBand} | ${formData.billingDays || '-'} días</div></div>
                    <div class="info-item"><div class="info-label">Consumo</div><div class="info-value">${gasMonthly.toFixed(0)} kWh/factura | ${gasAnnual.toFixed(0)} kWh/año</div></div>
                </div></div></div>

                <div class="split">
                    <div class="box"><div class="hd">Producto recomendado</div><div class="bd">
                        <strong style="font-size:14px;color:${branding.primaryColor}">${selectedResult.supplier}</strong><br>
                        <span style="font-size:11px;color:#334155;font-weight:500;margin-top:3px;display:block">${selectedResult.productName}</span>
                    </div></div>
                    <div class="box"><div class="hd">Resumen de ahorro</div><div class="bd" style="text-align:center">
                        <div style="font-size:11px;margin-bottom:6px">Actual: <span class="highlight-red">&euro; ${currentBill.toFixed(2)}</span>  | Propuesta: <span class="highlight-green">&euro; ${selectedResult.total.toFixed(2)}</span></div>
                        <div class="annual-savings"> &euro; ${selectedResult.annualSavings.toFixed(2)} / AHORRO ANUAL</div>
                        <div class="annual-percent">${savingsPercentDisplay}% de ahorro</div>
                    </div></div>
                </div>

                <div class="split">
                    <div class="box"><div class="hd">Detalle gas</div><div class="bd">
                        <table class="compact-table"><tbody>
                            <tr><td>Peaje</td><td>${gasBand}</td></tr>
                            <tr><td>Consumo factura</td><td>${gasMonthly.toFixed(0)} kWh</td></tr>
                            <tr><td>Consumo a\u00f1o</td><td>${gasAnnual.toFixed(0)} kWh</td></tr>
                            <tr><td>Fijo diario</td><td>&euro; ${gasFixedDaily.toFixed(6)} / d\u00eda</td></tr>
                            <tr><td>Coste fijo</td><td>&euro; ${gasFixedCost.toFixed(2)}</td></tr>
                            <tr><td>Variable kWh</td><td>&euro; ${gasVariableKwh.toFixed(6)}</td></tr>
                            <tr><td>Coste variable</td><td>&euro; ${gasVariableCost.toFixed(2)}</td></tr>
                        </tbody></table>
                    </div></div>
                    <div class="box"><div class="hd">Totales</div><div class="bd"><table class="compact-table">
                        <tr><td>Alquiler</td><td>&euro; ${d_equipmentRental.toFixed(2)}</td></tr>
                        <tr><td>Otros</td><td>&euro; ${d_otherCosts.toFixed(2)}</td></tr>
                        <tr><td>Subtotal</td><td>&euro; ${d_subtotal.toFixed(2)}</td></tr>
                        <tr><td>${impLabelPdf}</td><td>&euro; ${d_electricityTax.toFixed(2)}</td></tr>
                        <tr><td>${vatLabelPdf}</td><td>&euro; ${d_vat.toFixed(2)}</td></tr>
                        <tr class="tot"><td>TOTAL</td><td>&euro; ${selectedResult.total.toFixed(2)}</td></tr>
                    </table></div></div>
                </div>

                <div class="box"><div class="bd bar-chart chart-card" style="padding-top:2px">
                    <div class="chart-layout">
                    <div class="gauge">${gaugeSVG}</div>
                    <div class="mini-bars">
                                    <div class="bar-row bar-row-current">
                                        <div class="bar-label" style="color:${colorActual};font-weight:700">Factura actual</div>
                                        <div class="bar-wrap">
                                            <div class="bar"><div class="bar-fill" style="width:${currentPct}%;background:${currentBarFillBg};"></div></div>
                                            <div class="bar-value" style="color:${colorActual}">&euro; ${currentBill.toFixed(2)}</div>
                                        </div>
                                    </div>
                                    <div class="bar-row bar-row-proposed">
                                        <div class="bar-label" style="color:${colorAhorro};font-weight:700">Propuesta</div>
                                        <div class="bar-wrap">
                                            <div class="bar"><div class="bar-fill" style="width:${proposedPct}%;background:${proposedBarFillBg};"></div></div>
                                            <div class="bar-value" style="color:${colorAhorro}">&euro; ${selectedResult.total.toFixed(2)}</div>
                                        </div>
                                    </div>
                            <div class="bar-row" style="margin-top:2px;color:${colorAhorro};font-weight:700">
                                <div class="bar-label">Ahorro por factura</div>
                                <div class="bar-value" style="text-align:left;color:${colorAhorro}">&euro; ${selectedResult.monthlySavings.toFixed(2)} (${savingsPercentDisplay}%)</div>
                            </div>
                        </div>
                    </div>
                    <div class="pill-row">
                        <div class="pill pill-negative"><span>Factura:</span>&euro; ${currentBill.toFixed(2)}</div>
                        <div class="pill pill-positive"><span>Propuesta:</span>&euro; ${selectedResult.total.toFixed(2)}</div>
                        <div class="pill"><span>Peaje:</span>${gasBand}</div>
                        <div class="pill pill-alt"><span>Consumo factura:</span>${gasMonthly.toFixed(0)} kWh/factura</div>
                    </div>
                    <div class="card-lite" style="margin-top:8px">
                        <div class="title">Distribución fija / variable / impuestos</div>
                        <div class="stack-section">
                            <div class="stack-title">Reparto de la factura</div>
                            <div class="stack-bar">${gasStackBar || '<div class="stack-segment" style="width:100%;background:#e5e7eb"><span>Sin datos</span></div>'}</div>
                            <div class="stack-legend">
                                <div class="legend-item"><div class="legend-swatch" style="background:#0ea5e9"></div><div class="legend-label">Fijo</div></div>
                                <div class="legend-item"><div class="legend-swatch" style="background:#16a34a"></div><div class="legend-label">Variable</div></div>
                                <div class="legend-item"><div class="legend-swatch" style="background:#6b7280"></div><div class="legend-label">Impuestos</div></div>
                                <div class="legend-item"><div class="legend-swatch" style="background:#f59e0b"></div><div class="legend-label">Otros</div></div>
                            </div>
                        </div>
                    </div>
                </div></div>
                ${serviceAdjustmentFootnoteHtml}
                </div></body></html>`;

        } else {
            // Electricity Implementation
            let consumoDetailRows = periodsConsumo.map(p => {
                const kwh = parseFloat(formData[`consumption${p}`]) || 0;
                const price = consumoPrices[p] || 0;
                const cost = kwh * price;
                return `<tr><td>${p}</td><td>${kwh.toFixed(2)} kWh</td><td>€ ${price.toFixed(6)}</td><td>€ ${cost.toFixed(2)}</td></tr>`;
            }).join('');

            // const consumoPriceSuffix = '*'; // Example
            if (consumoDetailRows.includes('kWh') && false) {
                 // Logic from before
            }

            const potenciaDetailRows = periodsPotencia.map(p => {
                const kw = parseFloat(formData[`potencia${p}`]) || 0;
                const priceDay = potenciaPrices[p] || 0;
                const cost = kw * priceDay * parseInt(formData.billingDays);
                return `<tr><td>${p}</td><td>${kw.toFixed(2)} kW</td><td>€ ${priceDay.toFixed(6)}</td><td>€ ${cost.toFixed(2)}</td></tr>`;
            }).join('');

            htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            *{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
            @media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
            .page{padding:6mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#334155;background:#ffffff;width:210mm;min-height:297mm;line-height:1.25}
            .topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:3px solid ${branding.primaryColor}}
            .topbar-left{display:flex;align-items:center;gap:12px}
            .logo-img{width:80px;height:auto;max-height:50px;object-fit:contain}
            .title{font-size:18px;font-weight:700;color:${branding.primaryColor};letter-spacing:.5px}
            .subtitle{font-size:10px;color:${branding.secondaryColor};font-weight:500;margin-top:2px}
            .topbar-right{text-align:right;font-size:9px;color:#64748b}
            .box{border:1.5px solid ${branding.primaryColor}33;border-radius:10px;background:#ffffff;box-shadow:0 2px 5px rgba(0,0,0,.04);margin-bottom:6px}
            .box .hd{background:${branding.primaryColor};padding:5px 7px;font-weight:700;color:#ffffff;font-size:10px;display:flex;align-items:center;gap:6px;border-radius:8px 8px 0 0;text-transform:uppercase;letter-spacing:.3px}
            .box .bd{padding:6px 7px}
            .info-grid{display:flex;flex-wrap:wrap;gap:4px}
            .info-item{flex:1 1 calc(33.333% - 4px);background:${branding.primaryColor}10;border-left:4px solid ${branding.primaryColor};border-radius:6px;padding:6px 8px;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px}
            .info-label{font-weight:800;color:${branding.secondaryColor};font-size:8px;text-transform:uppercase;letter-spacing:.35px;line-height:1.1}
            .info-value{font-weight:800;color:#0f172a;font-size:10.5px;margin-top:0;word-break:break-word;line-height:1.2}
            table{width:100%;border-collapse:separate;border-spacing:0;font-size:9px;table-layout:fixed}
            thead th{background:${branding.primaryColor};color:#ffffff;font-weight:600;border:1px solid ${branding.secondaryColor};padding:5px 6px}
            tbody td{border:1px solid ${branding.primaryColor}33;background:#ffffff;padding:4px 5px}
            tfoot td{border:1px solid ${branding.primaryColor}66;padding:4px 5px}
            th,td{text-align:right}
            th:first-child,td:first-child{text-align:left}
            th,td{vertical-align:middle}
            .tot{font-weight:700;background:${branding.primaryColor}22;color:${branding.secondaryColor}}
            .highlight-red{color:#dc2626;font-weight:600;font-size:12px}
            .highlight-green{color:#15803d;font-weight:600;font-size:12px}
            .annual-savings{color:#facc15;font-size:16px;font-weight:900;margin-bottom:2px;text-transform:uppercase}
            .annual-percent{color:${branding.secondaryColor};font-size:10px;font-weight:700}
            .split{display:flex;gap:6px;align-items:stretch}
            .split>.box{flex:1 1 0;min-width:0}
            .compact-table{font-size:8.4px}
            .compact-table th,.compact-table td{padding:4px 5px;line-height:1.25}
            .bar-chart{margin-top:6px}
            .bar-row{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:9px;color:#334155;line-height:1.1}
            .bar-label{flex:0 0 95px;font-weight:700}
            .bar-wrap{flex:1;display:flex;align-items:center;gap:6px;min-width:0}
            .bar{flex:1 1 160px;min-width:140px;height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;position:relative;border:1px solid #cbd5e1}
            .bar-fill{height:100%;border-radius:999px;transition:width .3s ease;box-shadow:0 2px 6px rgba(0,0,0,.1)}
            .bar-value{min-width:62px;text-align:right;font-weight:900;color:${branding.secondaryColor};font-size:9px}
            .chart-card{background:${chartCardBg};border:1px solid ${branding.primaryColor}22;border-radius:12px;padding:6px;box-shadow:0 3px 10px rgba(0,0,0,.08)}
            .chart-layout{display:flex;gap:10px;align-items:center}
            .gauge{position:relative;flex:0 0 128px;width:128px;height:128px;display:flex;align-items:center;justify-content:center}
            .gauge-svg text{font-family:Arial,Helvetica,sans-serif}
            .gauge-text-main{font-weight:900;font-size:16px;fill:#0f172a}
            .gauge-text-sub{font-size:9px;font-weight:800;letter-spacing:.25px;text-transform:uppercase;fill:#334155}
            .gauge-text-amount{font-size:10px;font-weight:900;fill:${colorAhorro}}
            .mini-bars{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
            .pill{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:999px;font-size:8.5px;font-weight:800;border:1px solid ${branding.primaryColor}22;background:${branding.primaryColor}08;color:${branding.secondaryColor};margin-top:4px}
            .pill span{font-weight:600;color:#0f172a}
            .pill-alt{border-color:${branding.secondaryColor}33;background:${branding.secondaryColor}12;color:${branding.primaryColor}}
            .pill-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
            .pill-negative{border-color:${colorActual}33;background:${colorActual}12;color:${colorActual}}
            .pill-positive{border-color:${colorAhorro}33;background:${colorAhorro}12;color:${colorAhorro}}
            ${extraCss}
            </style></head><body>
            <div class="page">
                <style>${extraCss}</style>
                <div class="topbar">
                    <div class="topbar-left">
                        <img class="logo-img" src="${branding.logo}" alt="Logo" onerror="this.style.display='none'"/>
                        <div><div class="subtitle">Propuesta Energética Personalizada</div></div>
                    </div>
                    <div class="topbar-right"><div class="meta">Fecha: ${dateStr}</div>${commercialMetaHtml}</div>
                </div>

                <div class="box"><div class="hd">Datos del cliente</div><div class="bd"><div class="info-grid">
                    <div class="info-item"><div class="info-label">Cliente / CUPS</div><div class="info-value">${formData.clientName || '-'} | ${formData.cups || '-'}</div></div>
                    <div class="info-item"><div class="info-label">Tarifa / Zona</div><div class="info-value">${tariffType} | ${formData.region || '-'}</div></div>
                    <div class="info-item"><div class="info-label">CAE / Días</div><div class="info-value">${cae.toFixed(0)} kWh/año | ${formData.billingDays || '-'} días</div></div>
                </div></div></div>

                <div class="split">
                    <div class="box"><div class="hd">Producto recomendado</div><div class="bd">
                        <strong style="font-size:14px;color:${branding.primaryColor}">${selectedResult.supplier}</strong><br>
                        <span style="font-size:11px;color:#334155;font-weight:500;margin-top:3px;display:block">${selectedResult.productName}</span>
                    </div></div>
                    <div class="box"><div class="hd">Resumen de ahorro</div><div class="bd" style="text-align:center">
                        <div style="font-size:11px;margin-bottom:6px">Actual: <span class="highlight-red">€${currentBill.toFixed(2)}</span> → Propuesta: <span class="highlight-green">€${selectedResult.total.toFixed(2)}</span></div>
                        <div class="annual-savings"> €${selectedResult.annualSavings.toFixed(2)} / AHORRO ANUAL</div>
                        <div class="annual-percent">✓ ${savingsPercentDisplay}% de ahorro</div>
                    </div></div>
                </div>

                <div class="split">
                    <div class="box"><div class="hd">Consumo por periodo</div><div class="bd">
                        <table class="compact-table"><thead><tr><th>P</th><th>kWh</th><th>€/kWh</th><th>€</th></tr></thead><tbody>${consumoDetailRows}</tbody>
                        <tfoot>
                            <tr><td colspan="3">Subtotal</td><td>€${d_energyCost.toFixed(2)}</td></tr>
                            ${d_serviceAdjustment > 0 ? `<tr><td colspan="3">${serviceAdjustmentLabel}</td><td>€${d_serviceAdjustment.toFixed(2)}</td></tr>` : ''}
                            <tr class="tot"><td colspan="3">Total</td><td>€${(d_energyCost + d_serviceAdjustment).toFixed(2)}</td></tr>
                        </tfoot></table>
                    </div></div>
                    <div class="box"><div class="hd">Potencia por periodo</div><div class="bd">
                        <table class="compact-table"><thead><tr><th>P</th><th>kW</th><th>€/kW·d</th><th>€</th></tr></thead><tbody>${potenciaDetailRows}</tbody>
                        <tfoot><tr class="tot"><td colspan="3">Total</td><td>€${d_powerCost.toFixed(2)}</td></tr></tfoot></table>
                    </div></div>
                </div>

                <div class="split">
                    <div class="box"><div class="hd">Conceptos</div><div class="bd"><table class="compact-table">
                        <tr><td>Desc. consumo</td><td>€${(d_discounts.energy || 0).toFixed(2)}</td></tr>
                        <tr><td>Desc. potencia</td><td>€${(d_discounts.power || 0).toFixed(2)}</td></tr>
                        <tr><td>E. reactiva</td><td>€${(d_extras.reactiveEnergy || 0).toFixed(2)}</td></tr>
                        <tr><td>Exceso pot.</td><td>€${(d_extras.excessPower || 0).toFixed(2)}</td></tr>
                    </table></div></div>
                    <div class="box"><div class="hd">Totales</div><div class="bd"><table class="compact-table">
                        <tr><td>Alquiler</td><td>€${d_equipmentRental.toFixed(2)}</td></tr>
                        <tr><td>Otros</td><td>€${d_otherCosts.toFixed(2)}</td></tr>
                        <tr><td>Subtotal</td><td>€${d_subtotal.toFixed(2)}</td></tr>
                        <tr><td>${impLabelPdf}</td><td>€${d_electricityTax.toFixed(2)}</td></tr>
                        <tr><td>${vatLabelPdf}</td><td>€${d_vat.toFixed(2)}</td></tr>
                        <tr class="tot"><td>TOTAL</td><td>€${selectedResult.total.toFixed(2)}</td></tr>
                    </table></div></div>
                </div>

                <div class="box"><div class="bd bar-chart chart-card" style="padding-top:2px">
                    <div class="chart-layout">
                    <div class="gauge">${gaugeSVG}</div>
                    <div class="mini-bars">
                                    <div class="bar-row bar-row-current">
                                        <div class="bar-label" style="color:${colorActual};font-weight:700">Factura actual</div>
                                        <div class="bar-wrap">
                                            <div class="bar"><div class="bar-fill" style="width:${currentPct}%;background:${currentBarFillBg};"></div></div>
                                            <div class="bar-value" style="color:${colorActual}">&euro; ${currentBill.toFixed(2)}</div>
                                        </div>
                                    </div>
                                    <div class="bar-row bar-row-proposed">
                                        <div class="bar-label" style="color:${colorAhorro};font-weight:700">Propuesta</div>
                                        <div class="bar-wrap">
                                            <div class="bar"><div class="bar-fill" style="width:${proposedPct}%;background:${proposedBarFillBg};"></div></div>
                                            <div class="bar-value" style="color:${colorAhorro}">&euro; ${selectedResult.total.toFixed(2)}</div>
                                        </div>
                                    </div>
                            <div class="bar-row" style="margin-top:2px;color:${colorAhorro};font-weight:700">
                                <div class="bar-label">Ahorro por factura</div>
                                <div class="bar-value" style="text-align:left;color:${colorAhorro}">&euro; ${selectedResult.monthlySavings.toFixed(2)} (${savingsPercentDisplay}%)</div>
                            </div>
                        </div>
                    </div>
                </div></div>
                <div class="mini-section">
                    <div class="mini-chart">
                        <div class="mini-title">Consumo por periodo</div>
                        <div class="mini-cols">${consumoColumns}</div>
                    </div>
                    <div class="mini-chart">
                        <div class="mini-title">Potencia por periodo</div>
                        <div class="mini-cols">${potenciaColumns}</div>
                    </div>
                </div>
                <div class="chart-extras">
                    <div class="card-lite">
                        <div class="title">Impacto del ahorro (€ y %)</div>
                        ${impactRows}
                    </div>
                    <div class="card-lite">
                        <div class="title">Distribución consumo / potencia</div>
                        <div class="stack-section">
                            <div>
                                <div class="stack-title">Consumo (kWh)</div>
                                <div class="stack-bar">${consumoStack}</div>
                            </div>
                            <div>
                                <div class="stack-title">Potencia (kW)</div>
                                <div class="stack-bar">${potenciaStack}</div>
                            </div>
                            <div class="stack-legend">
                                ${consumoLegend}
                                ${potenciaLegend}
                            </div>
                        </div>
                    </div>
                </div>
                ${serviceAdjustmentFootnoteHtml}
                </div></body></html>`;
        }

        const isRetryableCanvasError = (err) => {
            const msg = String(err?.message || err || '');
            return /createPattern/i.test(msg) || /width or height of 0/i.test(msg) || /CanvasRenderingContext2D/i.test(msg);
        };

        const renderPdfCanvas = async ({ forceSafeMode = false } = {}) => {
            let iframe = null;
            try {
                iframe = document.createElement('iframe');
                iframe.style.position = 'fixed';
                // Keep it off-screen but with a real size so layout/images render correctly
                iframe.style.top = '-10000px';
                iframe.style.left = '0';
                iframe.style.width = '210mm';
                iframe.style.height = '297mm';
                iframe.style.border = 'none';
                iframe.style.visibility = 'hidden'; // Avoid flash
                iframe.style.pointerEvents = 'none';
                document.body.appendChild(iframe);

                const doc = iframe.contentWindow.document;
                doc.open();
                doc.write(htmlContent);
                doc.close();

                // Wait for images inside the iframe. In production, 500ms is often not enough.
                await waitForIframeImages(doc, 6000);
                // Hide any images that failed to load (prevents html2canvas crash with 0x0 canvases).
                try {
                    Array.from(doc.images || []).forEach((img) => {
                        const ok = Boolean(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
                        if (!ok) img.style.display = 'none';
                    });
                } catch {}

                if (forceSafeMode) {
                    try {
                        const safe = doc.createElement('style');
                        safe.textContent = `
                            .chart-card{background:#ffffff !important;background-image:none !important;box-shadow:none !important}
                            .bar-fill{background-image:none !important;box-shadow:none !important}
                            .bar-row-current .bar-fill{background:${colorActual} !important}
                            .bar-row-proposed .bar-fill{background:${colorAhorro} !important}
                            .mini-bar{background:${colorAhorro} !important;background-image:none !important;box-shadow:none !important}
                        `;
                        doc.head.appendChild(safe);
                    } catch {}
                }

                await new Promise(resolve => setTimeout(resolve, 250));

                // Force display before capture (html2canvas needs it 'visible' in DOM)
                iframe.style.visibility = 'visible';
                iframe.style.opacity = '0.01'; // Almost invisible to user but visible to engine

                const canvas = await html2canvas(doc.body, {
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    backgroundColor: '#ffffff',
                    windowWidth: 794 // A4 px at 96dpi approx
                });

                if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
                    throw new Error('El render del PDF devolvió un canvas vacío.');
                }
                return canvas;
            } finally {
                try {
                    if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
                } catch {}
            }
        };

        let canvas;
        try {
            canvas = await renderPdfCanvas({ forceSafeMode: pdfCanvasSafeMode });
        } catch (err) {
            if (isRetryableCanvasError(err)) {
                canvas = await renderPdfCanvas({ forceSafeMode: true });
            } else {
                throw err;
            }
        }

        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const margin = 8;
        let imgWidth = pdfWidth - (margin * 2);
        let imgHeight = (canvas.height * imgWidth) / canvas.width;
        const pageContentHeight = pdfHeight - (margin * 2);

        if (imgHeight > pageContentHeight) {
            const scale = pageContentHeight / imgHeight;
            imgWidth *= scale;
            imgHeight *= scale;
        }

        const positionX = (pdfWidth - imgWidth) / 2;
        const positionY = margin;
        pdf.addImage(imgData, 'JPEG', positionX, positionY, imgWidth, imgHeight);

        // Firma lateral (más fiable que hacerlo en HTML por html2canvas)
        const firmaText = 'Cálculo realizado por LOVILUZ';
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(7);
        pdf.setTextColor(90, 90, 90);
        for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
            pdf.setPage(page);
            pdf.text(firmaText, 12, pdfHeight / 2, { angle: 90, baseline: 'bottom' });
        }

        pdf.save(`Comparativa_${formData.clientName}_${today.toISOString().split('T')[0]}.pdf`);

        if (!fromHistory) {
            try {
                recordPdfDownload({ commercialCode, commercialName, formData, offer: selectedResult });
            } catch (storeErr) {
                console.error('[PDF STORE] Error guardando historial de PDF:', storeErr);
            }
        }
        
        // Track statistics BEFORE trying to record history
        const savingsVal = parseFloat(selectedResult.annualSavings) || 0;
        const commissionVal = parseFloat(selectedResult.commission) || parseFloat(selectedResult.commissionBase) || 0;
        
        const trackingPayload = {
            type: 'download',
            commercial: commercialCode || 'unknown',
            supplier: selectedResult.supplier || 'unknown',
            product: selectedResult.productName || 'unknown',
            commission: commissionVal,
            savings: Math.abs(savingsVal), // Remove signs as requested
            timestamp: new Date().toISOString()
        };
        
        if (!fromHistory) {
            try {
                const trackResponse = await fetch('/api/stats/track', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(trackingPayload)
                });
                
                if (!trackResponse.ok) {
                    const errorText = await trackResponse.text();
                    console.error('[PDF TRACKING] Error en respuesta:', trackResponse.status, errorText);
                } else {
                    await trackResponse.json().catch(() => ({}));
                }
            } catch (trackErr) {
                console.error('[PDF TRACKING] ✗ Error al enviar tracking:', trackErr);
            }
            
            // Now try to record in history
            try {
                await recordComparison({ commercialCode, formData, offers: [selectedResult] });
            } catch (err) {
                console.error('[PDF HISTORY] Error saving history:', err);
            }
        }
        
    } catch (err) {
        console.error('Error generating PDF:', err);
        alert('Error al generar PDF: ' + err.message);
    }
}
