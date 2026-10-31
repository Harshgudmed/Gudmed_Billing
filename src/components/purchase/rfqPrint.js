import { gudmedDocument, escapeHtml, printViaIframe } from '@/lib/printTemplate'
import { formatDateTime } from '@/lib/format'

// The printed request for quotation — the hospital's letterhead (the shared
// GudMed print shell), what is asked and by when, and blank columns for the
// vendor to fill in: what goes to a vendor who is not e-mailed, or is handed
// the paper. It carries no other vendor's rates.

const day = (d) => (d ? formatDateTime(d, { withTime: false }) : '—')

export function printRfq(rfq) {
  const rows = rfq.lines.map((l, i) => `<tr>
    <td class="rfq-center">${i + 1}</td>
    <td><strong>${escapeHtml(l.itemName)}</strong><br><span class="rfq-item-code">${escapeHtml(l.itemCode)}${l.item?.hsnCode ? ` · HSN ${escapeHtml(l.item.hsnCode)}` : ''}</span></td>
    <td class="rfq-center rfq-nowrap">${l.quantity} ${escapeHtml(l.unitCode)}</td>
    <td></td><td></td><td></td><td class="rfq-center"></td>
  </tr>`).join('')

  const body = `
<style>
  .rfq-document{min-height:218mm;display:flex;flex-direction:column;color:#1f2937;font-size:10pt}
  .rfq-document *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .rfq-title{margin:0 0 10px;padding:5px 0 8px;border-bottom:2px solid #1e3a5f;text-align:center;color:#1e3a5f;font-size:15pt;font-weight:700;letter-spacing:1.5px}
  .rfq-subject{margin-bottom:10px;padding:9px 12px;border-left:4px solid #1e3a5f;background:#f3f6fa}
  .rfq-kicker{margin-bottom:3px;color:#64748b;font-size:8pt;font-weight:700;letter-spacing:.7px;text-transform:uppercase}
  .rfq-subject-title{color:#1e3a5f;font-size:12pt;font-weight:700}
  .rfq-reference{margin-top:3px;color:#526176;font-size:9pt}
  .rfq-meta{display:grid;grid-template-columns:repeat(3,1fr);margin-bottom:10px;border:1px solid #cbd5e1}
  .rfq-meta-cell{min-height:15mm;padding:7px 9px;border-right:1px solid #cbd5e1}
  .rfq-meta-cell:last-child{border-right:0}
  .rfq-label{display:block;margin-bottom:4px;color:#64748b;font-size:8pt;font-weight:700;text-transform:uppercase}
  .rfq-value{color:#111827;font-size:10.5pt;font-weight:600}
  .rfq-section{margin-bottom:10px;border:1px solid #cbd5e1;break-inside:avoid}
  .rfq-section-title{padding:5px 9px;border-bottom:1px solid #cbd5e1;background:#edf2f7;color:#1e3a5f;font-size:9pt;font-weight:700;letter-spacing:.4px;text-transform:uppercase}
  .rfq-vendor-grid{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr}
  .rfq-vendor-field{min-height:19mm;padding:7px 9px;border-right:1px solid #e2e8f0}
  .rfq-vendor-field:last-child{border-right:0}
  .rfq-write-line{height:8mm;border-bottom:1px solid #94a3b8}
  .rfq-table{width:100%;margin:0 0 9px;border:1px solid #cbd5e1;border-collapse:collapse;table-layout:fixed;font-size:9pt}
  .rfq-table th{padding:7px 5px;border:1px solid #cbd5e1;background:#edf2f7;color:#1e3a5f;text-align:left;font-size:8pt;line-height:1.25;vertical-align:bottom}
  .rfq-table td{height:22mm;padding:7px 5px;border:1px solid #cbd5e1;vertical-align:top}
  .rfq-table tbody tr:nth-child(even) td{background:#fafbfd}
  .rfq-center{text-align:center!important}
  .rfq-nowrap{white-space:nowrap}
  .rfq-item-code{color:#64748b;font-size:8pt}
  .rfq-instructions{margin-bottom:9px;padding:8px 10px;border:1px solid #cbd5e1;background:#f8fafc;line-height:1.5}
  .rfq-instructions strong{color:#1e3a5f}
  .rfq-terms{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;margin-bottom:9px;padding:8px 10px;border:1px solid #cbd5e1}
  .rfq-term{min-height:8mm;border-bottom:1px solid #94a3b8;color:#475569;font-size:9pt}
  .rfq-note{margin-bottom:9px;padding:8px 10px;border-left:3px solid #1e3a5f;background:#f3f6fa;white-space:pre-wrap}
  .rfq-signatures{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:auto;padding-top:12px;font-size:9pt}
  .rfq-signature{min-height:25mm;padding-top:12mm;border-top:1px solid #475569;text-align:center}
  .rfq-document table{break-inside:auto}.rfq-document tr,.rfq-document .rfq-section{break-inside:avoid}
  @media print{.rfq-document{min-height:218mm}.rfq-table thead{display:table-header-group}}
</style>
<div class="rfq-document">
  <div class="rfq-title">REQUEST FOR QUOTATION</div>
  <section class="rfq-subject">
    <div class="rfq-kicker">Quotation requested for</div>
    <div class="rfq-subject-title">${escapeHtml(rfq.title)}</div>
    ${rfq.request?.number ? `<div class="rfq-reference">Purchase request reference: <strong>${escapeHtml(rfq.request.number)}</strong></div>` : ''}
  </section>
  <div class="rfq-meta">
    <div class="rfq-meta-cell"><span class="rfq-label">RFQ number</span><span class="rfq-value">${escapeHtml(rfq.number)}</span></div>
    <div class="rfq-meta-cell"><span class="rfq-label">Issue date</span><span class="rfq-value">${day(rfq.sentAt || rfq.createdAt)}</span></div>
    <div class="rfq-meta-cell"><span class="rfq-label">Quote submission deadline</span><span class="rfq-value">${day(rfq.dueDate)}</span></div>
  </div>
  <section class="rfq-section">
    <div class="rfq-section-title">Supplier details</div>
    <div class="rfq-vendor-grid">
      <div class="rfq-vendor-field"><span class="rfq-label">Supplier name</span><div class="rfq-write-line"></div></div>
      <div class="rfq-vendor-field"><span class="rfq-label">GSTIN</span><div class="rfq-write-line"></div></div>
      <div class="rfq-vendor-field"><span class="rfq-label">Contact person / phone</span><div class="rfq-write-line"></div></div>
      <div class="rfq-vendor-field"><span class="rfq-label">Quotation date</span><div class="rfq-write-line"></div></div>
    </div>
  </section>
  <table class="rfq-table">
    <colgroup><col style="width:5%"><col style="width:28%"><col style="width:12%"><col style="width:18%"><col style="width:10%"><col style="width:9%"><col style="width:18%"></colgroup>
    <thead><tr><th>#</th><th>Item description</th><th class="rfq-center">Required quantity</th><th>Unit rate (₹)<br>before GST</th><th>Discount<br>(%)</th><th>GST<br>(%)</th><th>Can supply?<br>Yes / No</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="rfq-instructions"><strong>Supplier instructions</strong><br>Enter your unit rate before GST, discount and GST rate for each item. Mark whether you can supply the requested quantity. If you cannot supply an item, write “No” and note any available quantity or alternative.</div>
  <div class="rfq-terms">
    <div class="rfq-term">Estimated delivery time (days):</div>
    <div class="rfq-term">Quotation valid until:</div>
  </div>
  ${rfq.notes ? `<div class="rfq-note"><strong>Additional note:</strong> ${escapeHtml(rfq.notes)}</div>` : ''}
  <div class="rfq-signatures">
    <div><strong>Requested by</strong><br>${escapeHtml(rfq.createdByName || '')}<br>Purchase Department</div>
    <div class="rfq-signature"><strong>Authorised supplier representative</strong><br>Name, signature and company seal</div>
  </div>
</div>`

  printViaIframe(gudmedDocument({
    orgInfo: { name: rfq.hospital?.name, address: rfq.hospital?.address, city: rfq.hospital?.city },
    title: rfq.number, subtitle: 'Purchase Department',
    headerRight: `RFQ ${escapeHtml(rfq.number)}<br>Vendor copy`,
    body, variant: 'purchase purchase-custom',
  }))
}
