// The GudMed printed-document shell — one definition of what a printed page
// from this hospital looks like.
//
// It existed only as copy-pasted CSS inside LaboratoryModule / RadiologyModule /
// PatientProfile, so any document that didn't copy it printed as raw browser
// default (Times New Roman, no header) — which is exactly what the pharmacy
// label did. Build documents through `gudmedDocument()` instead of hand-rolling
// another <html> string.
import { format } from 'date-fns'

// Brand navy for print. Matches the existing lab/radiology reports.
export const PRINT_NAVY = '#1e3a5f'

/** Print without tripping popup blockers. */
export function printViaIframe(html) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;'
  document.body.appendChild(iframe)
  iframe.contentDocument.open()
  iframe.contentDocument.write(html)
  iframe.contentDocument.close()
  iframe.contentWindow.focus()
  setTimeout(() => {
    iframe.contentWindow.print()
    setTimeout(() => document.body.removeChild(iframe), 1000)
  }, 300)
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;background:#fff}
.page{max-width:210mm;margin:0 auto;padding:12mm 14mm}
.hosp-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${PRINT_NAVY};padding-bottom:10px;margin-bottom:10px}
.hosp-name{font-size:19pt;font-weight:bold;color:${PRINT_NAVY}}
.hosp-sub{font-size:9pt;color:#555;margin-top:2px}
.hosp-contact{font-size:8.5pt;color:#555;text-align:right;line-height:1.6}
.report-banner{background:${PRINT_NAVY};color:#fff;text-align:center;padding:5px 0;font-size:13pt;font-weight:bold;letter-spacing:3px;margin-bottom:10px}
.info-box{border:1px solid #333;margin-bottom:10px}
.info-box-hdr{background:${PRINT_NAVY};color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr)}
.info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-label{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase}
.info-value{font-size:10pt;margin-top:1px}
.note-bar{padding:7px 12px;background:#f0f4f8;border-left:4px solid ${PRINT_NAVY};margin-bottom:10px;font-size:10pt}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:9.5pt}
thead th{background:${PRINT_NAVY};color:#fff;padding:6px 8px;text-align:left;font-size:9pt}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8}
tr:nth-child(even) td{background:#f9f9f9}
tfoot td{font-weight:bold;border-top:2px solid ${PRINT_NAVY};background:#fff!important}
.footer{margin-top:12px;border-top:1px solid #ccc;padding-top:5px;font-size:8pt;color:#888;text-align:center}
.print-btn{display:block;margin:16px auto 0;background:${PRINT_NAVY};color:#fff;border:none;padding:9px 28px;font-size:13px;font-weight:600;border-radius:6px;cursor:pointer}
@media print{.print-btn{display:none}body{padding:0}.page{padding:8mm}}
`

/**
 * A complete, branded, printable document.
 *
 * @param orgInfo     { name, address, city } — the hospital, from settings
 * @param title       browser/tab + PDF title
 * @param banner      the wide navy strip (e.g. "PHARMACY LABEL")
 * @param subtitle    small line under the hospital name (e.g. "Pharmacy Department")
 * @param headerRight right-hand block of the letterhead (doc no, printed-at)
 * @param body        the document's own HTML (already escaped by the caller)
 * @param showPrintButton  on-screen "Print / Save as PDF" button (hidden when printing)
 */
export function gudmedDocument({ orgInfo = {}, title, banner, subtitle = '', headerRight = '', body = '', showPrintButton = false }) {
  const printedAt = format(new Date(), 'dd MMM yyyy HH:mm')
  const addr = [orgInfo.address, orgInfo.city].filter(Boolean).join(', ')
  const hospital = orgInfo.name || 'Hospital'
  return `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body>
<div class="page">
  <div class="hosp-header">
    <div>
      <div class="hosp-name">${escapeHtml(hospital)}</div>
      ${subtitle ? `<div class="hosp-sub">${escapeHtml(subtitle)}</div>` : ''}
      ${addr ? `<div class="hosp-sub">${escapeHtml(addr)}</div>` : ''}
    </div>
    <div class="hosp-contact">${headerRight || `Printed: ${printedAt}`}</div>
  </div>
  ${banner ? `<div class="report-banner">${escapeHtml(banner)}</div>` : ''}
  ${body}
  <div class="footer">${escapeHtml(hospital)}${subtitle ? ` — ${escapeHtml(subtitle)}` : ''} &nbsp;|&nbsp; Confidential &nbsp;|&nbsp; Printed: ${printedAt}</div>
  ${showPrintButton ? '<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>' : ''}
</div>
</body></html>`
}

/** A 4-cell letterhead info strip: [{ label, value }] */
export function infoBox(hdr, cells) {
  return `<div class="info-box">
  <div class="info-box-hdr">${escapeHtml(hdr)}</div>
  <div class="info-grid">
    ${cells.map((c) => `<div class="info-cell"><div class="info-label">${escapeHtml(c.label)}</div><div class="info-value">${c.html || escapeHtml(c.value ?? '—')}</div></div>`).join('')}
  </div>
</div>`
}
