import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const fmtEUR = (n, decimals = 2) => {
  const v = Number(n || 0)
  return v.toFixed(decimals)
}

const absoluteUrl = (path) => {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  if (!origin) return path
  return path.startsWith('/') ? origin + path : origin + '/' + path
}

export async function generateComparePdf({ offers, showCommissions = true } = {}) {
  const selected = Array.isArray(offers) ? offers.filter(Boolean).slice(0, 3) : []
  if (selected.length < 2) return

  const today = new Date()
  const dateStr = today.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
  const logoUrl = absoluteUrl('/LogoLoviluz.svg')

	  const offerCards = selected.map((offer) => {
	    const supplier = offer?.supplier || '—'
	    const product = offer?.productName || '—'

	    const consumoEntries = Object.entries(offer?.pricingConsumo || {})
	    const potenciaEntries = Object.entries(offer?.pricingPotencia || {})
	    const commissionVal = Number(
	      offer?.commission ??
	      offer?.comisionAmount ??
	      offer?.comision ??
	      offer?.commissionAmount ??
	      offer?.commissionBase ??
	      offer?.comisionBase ??
	      0
	    ) || 0

	    const comBox = showCommissions
	      ? `
	        <div class="metric metric--purple">
	          <div class="metric-k">COMISION</div>
	          <div class="metric-v">&euro; ${fmtEUR(commissionVal, 2)}</div>
	        </div>`
	      : ''

    return `
      <div class="card">
        <div class="card-top">
          <div class="sup">${supplier}</div>
          <div class="prod">${product}</div>
        </div>
        <div class="metrics ${showCommissions ? '' : 'metrics--no-com'}">
          <div class="metric metric--slate">
            <div class="metric-k">PROPUESTA</div>
            <div class="metric-v">&euro; ${fmtEUR(offer?.total || 0, 2)}</div>
          </div>
          <div class="metric metric--green">
            <div class="metric-k">AHORRO</div>
            <div class="metric-v">&euro; ${fmtEUR(Math.abs(offer?.savings || 0), 2)}</div>
          </div>
          <div class="metric metric--green2">
            <div class="metric-k">ANUAL</div>
            <div class="metric-v">&euro; ${fmtEUR(offer?.annualSavings || 0, 0)}</div>
          </div>
          ${comBox}
        </div>
        <div class="box">
          <div class="box-h">CONSUMO (&euro;/kWh)</div>
          ${consumoEntries.length === 0 ? '<div class="empty">—</div>' : `
            <div class="rows">
              ${consumoEntries.map(([k, v]) => `
                <div class="row">
                  <div class="row-k">${k}</div>
                  <div class="row-v">${Number(v).toFixed(6)}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
        <div class="box">
          <div class="box-h">POTENCIA (&euro;/kW·dia)</div>
          ${potenciaEntries.length === 0 ? '<div class="empty">—</div>' : `
            <div class="rows">
              ${potenciaEntries.map(([k, v]) => `
                <div class="row">
                  <div class="row-k">${k}</div>
                  <div class="row-v">${Number(v).toFixed(6)}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `
  }).join('')

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #fff; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f172a; }
        .page { width: 1120px; padding: 18px; background: #fff; }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
        .h-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .logo { width: 140px; height: auto; object-fit: contain; }
        .title { min-width: 0; }
        .title-k { font-size: 11px; letter-spacing: 0.22em; font-weight: 900; color: #64748b; text-transform: uppercase; }
        .title-v { font-size: 20px; font-weight: 900; color: #0f172a; margin-top: 2px; }
        .title-s { font-size: 12px; color: #64748b; font-weight: 700; margin-top: 2px; }
        .h-right { text-align: right; }
        .pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; border: 1px solid #e2e8f0; background: #f8fafc; color: #334155; font-weight: 800; font-size: 12px; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .card { border: 1px solid #e2e8f0; border-radius: 18px; background: #fff; padding: 14px; }
        .card-top { margin-bottom: 12px; }
        .sup { font-size: 14px; font-weight: 900; color: #0f172a; letter-spacing: 0.02em; }
        .prod { font-size: 11px; font-weight: 800; color: #64748b; margin-top: 2px; text-transform: uppercase; }
        .metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px; }
        .metrics--no-com { grid-template-columns: repeat(2, 1fr); }
        .metric { border-radius: 14px; padding: 10px 12px; border: 1px solid #e2e8f0; background: #fff; }
        .metric-k { font-size: 9px; letter-spacing: 0.22em; font-weight: 900; text-transform: uppercase; color: #94a3b8; }
        .metric-v { font-size: 14px; font-weight: 900; margin-top: 6px; }
        .metric--slate { background: #f8fafc; }
        .metric--green { background: #ecfdf5; border-color: #bbf7d0; }
        .metric--green .metric-k { color: #15803d; opacity: 0.9; }
        .metric--green .metric-v { color: #065f46; }
        .metric--green2 { background: rgba(236, 253, 245, 0.6); border-color: rgba(187, 247, 208, 0.9); }
        .metric--green2 .metric-k { color: #15803d; opacity: 0.9; }
        .metric--green2 .metric-v { color: #065f46; }
        .metric--purple { background: #f5f3ff; border-color: #ddd6fe; }
        .metric--purple .metric-k { color: #6d28d9; opacity: 0.9; }
        .metric--purple .metric-v { color: #4c1d95; }
        .box { border: 1px solid #e2e8f0; border-radius: 14px; padding: 10px 12px; margin-top: 10px; }
        .box-h { font-size: 9px; letter-spacing: 0.22em; font-weight: 900; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
        .rows { display: grid; gap: 6px; }
        .row { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700; color: #475569; }
        .row-v { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; color: #0f172a; }
        .empty { font-size: 12px; color: #94a3b8; font-weight: 700; padding: 6px 0; }
        .footer { margin-top: 14px; font-size: 10px; color: #94a3b8; font-weight: 700; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header">
          <div class="h-left">
            <img class="logo" src="${logoUrl}" alt="Loviluz" />
            <div class="title">
              <div class="title-k">COMPARATIVA</div>
              <div class="title-v">Ofertas seleccionadas</div>
              <div class="title-s">Generado el ${dateStr}</div>
            </div>
          </div>
          <div class="h-right">
            <div class="pill">Comparador Loviluz PRO</div>
          </div>
        </div>
        <div class="grid">
          ${offerCards}
        </div>
        <div class="footer">Cálculo realizado por LOVILUZ</div>
      </div>
    </body>
  </html>`

  // Render in an iframe for consistent capture (avoid dark overlays/backdrops).
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.top = '0'
  iframe.style.left = '0'
  iframe.style.width = '1120px'
  iframe.style.height = '0'
  iframe.style.border = 'none'
  iframe.style.visibility = 'hidden'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()

  // Wait for logo to load.
  await new Promise((resolve) => setTimeout(resolve, 800))

  iframe.style.visibility = 'visible'
  iframe.style.opacity = '0.01'

  const canvas = await html2canvas(doc.body, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: 1120
  })

  const imgData = canvas.toDataURL('image/jpeg', 0.95)
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()
  const margin = 8
  let imgWidth = pdfWidth - margin * 2
  let imgHeight = (canvas.height * imgWidth) / canvas.width
  const maxHeight = pdfHeight - margin * 2
  if (imgHeight > maxHeight) {
    const scale = maxHeight / imgHeight
    imgWidth *= scale
    imgHeight *= scale
  }
  const x = (pdfWidth - imgWidth) / 2
  const y = (pdfHeight - imgHeight) / 2
  pdf.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight)

  const fileDate = today.toISOString().split('T')[0]
  pdf.save(`Comparativa_Ofertas_${fileDate}.pdf`)

  document.body.removeChild(iframe)
}
