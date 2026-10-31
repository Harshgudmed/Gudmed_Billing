import { gudmedDocument, escapeHtml, printViaIframe } from '@/lib/printTemplate'
import { formatMoney, formatDateTime } from '@/lib/format'
// Billing's rupees-in-words, so a PO and an invoice spell an amount the same way.
import { amountInWords } from '@/components/billing/utils/printBilling'

// The printed purchase order — the hospital's letterhead (the shared GudMed
// print shell), the vendor, each line with HSN and GST, the totals split as the
// vendor charges them, the amount in words, the terms, and the signature line.

const GST_TYPE = { intra: 'CGST + SGST', inter: 'IGST', none: 'Not GST-registered — no GST' }

export function printOrder(po) {
  const v = po.vendor || {}
  const vendorAddress = [v.houseNumber, v.street, v.locality, v.city, v.district, v.pincode].filter(Boolean).join(', ')
  const hospitalAddress = [po.hospital?.address, po.hospital?.city].filter(Boolean).join(', ')
  const rows = po.lines.map((l, i) => `<tr>
    <td class="po-center">${i + 1}</td>
    <td><strong>${escapeHtml(l.itemName)}</strong><br><span class="po-item-code">${escapeHtml(l.itemCode)}${l.note ? ` · ${escapeHtml(l.note)}` : ''}</span></td>
    <td>${escapeHtml(l.hsnCode || '—')}</td>
    <td class="po-number">${l.quantity} ${escapeHtml(l.unitCode)}</td>
    <td class="po-number">${formatMoney(l.rate)}</td>
    <td class="po-number">${l.discountPct ? `${l.discountPct}%` : '—'}</td>
    <td class="po-number">${po.gstType === 'none' ? '—' : `${l.gstRate}%`}</td>
    <td class="po-number">${formatMoney(l.lineTotal)}</td>
  </tr>`).join('')
  const tax = po.gstType === 'intra'
    ? `<tr><td colspan="7" style="text-align:right">CGST</td><td style="text-align:right">${formatMoney(po.cgst)}</td></tr>
       <tr><td colspan="7" style="text-align:right">SGST</td><td style="text-align:right">${formatMoney(po.sgst)}</td></tr>`
    : po.gstType === 'inter'
      ? `<tr><td colspan="7" style="text-align:right">IGST</td><td style="text-align:right">${formatMoney(po.igst)}</td></tr>`
      : ''
  const words = `${amountInWords(Number(po.total) || 0)} Rupee(s) Only`

  const body = `
<style>
  .po-document{min-height:218mm;display:flex;flex-direction:column;color:#1f2937;font-size:10pt}
  .po-document *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .po-title{margin:0 0 11px;padding:5px 0 8px;border-bottom:2px solid #1e3a5f;text-align:center;color:#1e3a5f;font-size:15pt;font-weight:700;letter-spacing:1.2px}
  .po-party-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
  .po-party{border:1px solid #cbd5e1;break-inside:avoid}
  .po-section-title{padding:5px 9px;border-bottom:1px solid #cbd5e1;background:#edf2f7;color:#1e3a5f;font-size:9pt;font-weight:700;letter-spacing:.4px;text-transform:uppercase}
  .po-party-body{min-height:29mm;padding:8px 10px}
  .po-party-name{margin-bottom:4px;color:#111827;font-size:11pt;font-weight:700}
  .po-party-detail{color:#475569;font-size:9pt;line-height:1.45;overflow-wrap:anywhere}
  .po-meta{display:grid;grid-template-columns:1.15fr .9fr 1.1fr 1fr;margin-bottom:10px;border:1px solid #cbd5e1}
  .po-meta-cell{min-height:17mm;padding:7px 9px;border-right:1px solid #e2e8f0}
  .po-meta-cell:last-child{border-right:0}
  .po-label{display:block;margin-bottom:4px;color:#64748b;font-size:8pt;font-weight:700;text-transform:uppercase}
  .po-value{color:#111827;font-size:9.5pt;font-weight:600;overflow-wrap:anywhere}
  .po-table{width:100%;margin:0 0 9px;border:1px solid #cbd5e1;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}
  .po-table th{padding:7px 5px;border:1px solid #cbd5e1;background:#edf2f7;color:#1e3a5f;text-align:left;font-size:7.5pt;line-height:1.25;vertical-align:bottom}
  .po-table td{height:16mm;padding:7px 5px;border:1px solid #cbd5e1;vertical-align:top;overflow-wrap:anywhere}
  .po-table tbody tr:nth-child(even) td{background:#fafbfd}
  .po-center{text-align:center!important}
  .po-number{text-align:right!important;white-space:nowrap;font-variant-numeric:tabular-nums}
  .po-item-code{color:#64748b;font-size:7.5pt}
  .po-table tfoot td{padding:7px 6px;border-top:1px solid #cbd5e1;background:#f8fafc!important}
  .po-table tfoot tr:last-child td{border-top:2px solid #1e3a5f;background:#edf2f7!important;color:#111827;font-weight:700}
  .po-total-label{text-align:right;font-weight:600}
  .po-amount-words,.po-terms{margin-bottom:9px;padding:8px 10px;border-left:3px solid #1e3a5f;background:#f3f6fa;line-height:1.45}
  .po-terms{white-space:pre-wrap}
  .po-amount-words strong,.po-terms strong{color:#1e3a5f}
  .po-signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:auto;padding-top:11px}
  .po-signature{min-height:23mm;padding-top:12mm;border-top:1px solid #475569;text-align:center;font-size:9pt;font-weight:600}
  .po-signature small{display:block;margin-top:3px;color:#64748b;font-size:8pt;font-weight:400}
  .po-document table{break-inside:auto}.po-document tr,.po-document .po-party{break-inside:avoid}
  @media print{.po-document{min-height:218mm}.po-table thead{display:table-header-group}}
</style>
<div class="po-document">
  <div class="po-title">PURCHASE ORDER</div>
  <div class="po-party-grid">
    <section class="po-party">
      <div class="po-section-title">Supplier</div>
      <div class="po-party-body">
        <div class="po-party-name">${escapeHtml(v.name || po.vendorName)}</div>
        <div class="po-party-detail">${vendorAddress ? `${escapeHtml(vendorAddress)}<br>` : ''}${v.gstNumber ? `GSTIN: ${escapeHtml(v.gstNumber)}<br>` : 'GSTIN: Not registered<br>'}${[v.contactPerson, v.phone, v.email].filter(Boolean).map(escapeHtml).join(' · ') || 'Contact details not provided'}</div>
      </div>
    </section>
    <section class="po-party">
      <div class="po-section-title">Deliver to</div>
      <div class="po-party-body">
        <div class="po-party-name">${escapeHtml(po.hospital?.name || 'Hospital')}</div>
        <div class="po-party-detail">${hospitalAddress ? escapeHtml(hospitalAddress) : 'Delivery address not provided'}</div>
      </div>
    </section>
  </div>
  <div class="po-meta">
    <div class="po-meta-cell"><span class="po-label">Purchase order number</span><span class="po-value">${escapeHtml(po.number)}</span></div>
    <div class="po-meta-cell"><span class="po-label">Order date</span><span class="po-value">${formatDateTime(po.orderDate, { withTime: false })}</span></div>
    <div class="po-meta-cell"><span class="po-label">Required delivery</span><span class="po-value">${po.expectedDate ? formatDateTime(po.expectedDate, { withTime: false }) : 'As soon as possible'}</span></div>
    <div class="po-meta-cell"><span class="po-label">Payment terms</span><span class="po-value">${po.paymentTermsDays != null ? `${po.paymentTermsDays} days from invoice` : 'As agreed'}</span></div>
  </div>
  <div class="po-section-title" style="margin-bottom:0">Items ordered</div>
  <table class="po-table">
    <colgroup><col style="width:4%"><col style="width:25%"><col style="width:12%"><col style="width:11%"><col style="width:12%"><col style="width:9%"><col style="width:8%"><col style="width:19%"></colgroup>
    <thead><tr><th class="po-center">#</th><th>Item description</th><th>HSN/SAC</th><th class="po-number">Quantity</th><th class="po-number">Unit rate</th><th class="po-number">Discount</th><th class="po-number">GST</th><th class="po-number">Line amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="7" class="po-total-label">Subtotal (before GST)</td><td class="po-number">${formatMoney(po.subtotal)}</td></tr>
      ${tax}
      <tr><td colspan="7" class="po-total-label">Order total — ${escapeHtml(GST_TYPE[po.gstType] || '')}</td><td class="po-number">${formatMoney(po.total)}</td></tr>
    </tfoot>
  </table>
  ${words ? `<div class="po-amount-words"><strong>Amount in words</strong><br>${escapeHtml(words)}</div>` : ''}
  ${po.terms ? `<div class="po-terms"><strong>Terms and delivery instructions</strong><br>${escapeHtml(po.terms)}</div>` : ''}
  <div class="po-signatures">
    <div class="po-signature">Prepared by<small>${escapeHtml(po.createdByName || 'Name and signature')} · Date</small></div>
    <div class="po-signature">Authorised signatory — GudMed Hospital<small>Name, signature and date</small></div>
    <div class="po-signature">Supplier acknowledgement<small>Name, signature and company seal · Date</small></div>
  </div>
</div>`

  printViaIframe(gudmedDocument({
    orgInfo: { name: po.hospital?.name, address: po.hospital?.address, city: po.hospital?.city },
    title: po.number, subtitle: 'Purchase Department',
    headerRight: `PO ${escapeHtml(po.number)}<br>Supplier copy`,
    body, variant: 'purchase purchase-custom',
  }))
}

// The printed goods receipt note (GRN): what came against which order, what
// was accepted and what turned back, with batch and expiry, signed by the
// store. A store login's copy has no money in it — the server sent none.
export function printReceipt(grn) {
  const money = grn.totalValue !== undefined
  const date = (d) => (d ? formatDateTime(d, { withTime: false }) : '—')
  const rows = grn.lines.map((l, i) => `<tr>
    <td class="grn-center">${i + 1}</td>
    <td><strong>${escapeHtml(l.itemName)}</strong><br><span class="grn-item-code">${escapeHtml(l.itemCode)}</span></td>
    <td class="grn-number">${l.receivedQty} ${escapeHtml(l.unitCode)}</td>
    <td class="grn-number">${l.rejectedQty ? `<span class="grn-rejected">${l.rejectedQty} ${escapeHtml(l.unitCode)}</span>${l.rejectReason ? `<br><span class="grn-reason">${escapeHtml(l.rejectReason)}</span>` : ''}` : '—'}</td>
    <td class="grn-number"><strong>${l.acceptedQty} ${escapeHtml(l.unitCode)}</strong></td>
    <td>${escapeHtml(l.batchNumber || '—')}</td>
    <td>${date(l.expiryDate)}</td>
    ${money ? `<td class="grn-number">${formatMoney(l.rate)}</td><td class="grn-number">${formatMoney(l.acceptedQty * l.rate)}</td>` : ''}
  </tr>`).join('')

  const body = `
<style>
  .grn-document{min-height:205mm;display:flex;flex-direction:column;color:#1f2937;font-size:10pt}
  .grn-document *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .grn-title{margin:0 0 11px;padding:5px 0 8px;border-bottom:2px solid #1e3a5f;text-align:center;color:#1e3a5f;font-size:15pt;font-weight:700;letter-spacing:1.2px}
  .grn-status{margin-bottom:9px;padding:8px 10px;border:1px solid #fecaca;background:#fff7f7;color:#991b1b;font-weight:700}
  .grn-section{margin-bottom:10px;border:1px solid #cbd5e1;break-inside:avoid}
  .grn-section-title{padding:5px 9px;border-bottom:1px solid #cbd5e1;background:#edf2f7;color:#1e3a5f;font-size:9pt;font-weight:700;letter-spacing:.4px;text-transform:uppercase}
  .grn-vendor-grid{display:grid;grid-template-columns:1.3fr 1fr 1fr}
  .grn-receipt-grid{display:grid;grid-template-columns:1fr 1fr 1.2fr 1fr}
  .grn-field{min-height:17mm;padding:7px 9px;border-right:1px solid #e2e8f0}
  .grn-field:last-child{border-right:0}
  .grn-label{display:block;margin-bottom:4px;color:#64748b;font-size:8pt;font-weight:700;text-transform:uppercase}
  .grn-value{color:#111827;font-size:10pt;font-weight:600;overflow-wrap:anywhere}
  .grn-table{width:100%;margin:0 0 9px;border:1px solid #cbd5e1;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}
  .grn-table th{padding:7px 4px;border:1px solid #cbd5e1;background:#edf2f7;color:#1e3a5f;text-align:left;font-size:7.5pt;line-height:1.25;vertical-align:bottom}
  .grn-table td{height:18mm;padding:7px 4px;border:1px solid #cbd5e1;vertical-align:top;overflow-wrap:anywhere}
  .grn-table tbody tr:nth-child(even) td{background:#fafbfd}
  .grn-center{text-align:center!important}
  .grn-number{text-align:right!important;white-space:nowrap;font-variant-numeric:tabular-nums}
  .grn-item-code,.grn-reason{color:#64748b;font-size:7.5pt}
  .grn-rejected{color:#991b1b;font-weight:600}
  .grn-table tfoot td{padding:8px 6px;border-top:2px solid #1e3a5f;background:#f3f6fa!important;font-weight:700}
  .grn-notes{margin-bottom:9px;padding:8px 10px;border-left:3px solid #1e3a5f;background:#f3f6fa;white-space:pre-wrap}
  .grn-signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:auto;padding-top:12px;text-align:center}
  .grn-signature{min-height:24mm;padding-top:12mm;border-top:1px solid #475569;font-size:9pt;font-weight:600}
  .grn-signature small{display:block;margin-top:3px;color:#64748b;font-size:8pt;font-weight:400}
  .grn-document table{break-inside:auto}.grn-document tr,.grn-document .grn-section{break-inside:avoid}
  @media print{.grn-document{min-height:205mm}.grn-table thead{display:table-header-group}}
</style>
<div class="grn-document">
  <div class="grn-title">GOODS RECEIPT NOTE</div>
  ${grn.status === 'cancelled' ? `<div class="grn-status">CANCELLED${grn.cancelledByName ? ` by ${escapeHtml(grn.cancelledByName)}` : ''}${grn.cancelReason ? ` — ${escapeHtml(grn.cancelReason)}` : ''}</div>` : ''}
  <section class="grn-section">
    <div class="grn-section-title">Supplier and delivery reference</div>
    <div class="grn-vendor-grid">
      <div class="grn-field"><span class="grn-label">Supplier</span><div class="grn-value">${escapeHtml(grn.vendorName || '—')}</div></div>
      <div class="grn-field"><span class="grn-label">Challan / invoice number</span><div class="grn-value">${escapeHtml(grn.challanNumber || '—')}</div></div>
      <div class="grn-field"><span class="grn-label">Challan date</span><div class="grn-value">${date(grn.challanDate)}</div></div>
    </div>
  </section>
  <section class="grn-section">
    <div class="grn-section-title">Receipt details</div>
    <div class="grn-receipt-grid">
      <div class="grn-field"><span class="grn-label">GRN number</span><div class="grn-value">${escapeHtml(grn.number)}</div></div>
      <div class="grn-field"><span class="grn-label">Purchase order</span><div class="grn-value">${escapeHtml(grn.order?.number || '—')}</div></div>
      <div class="grn-field"><span class="grn-label">Received on</span><div class="grn-value">${formatDateTime(grn.receivedAt)}</div></div>
      <div class="grn-field"><span class="grn-label">Recorded by</span><div class="grn-value">${escapeHtml(grn.receivedByName || '—')}</div></div>
    </div>
  </section>
  <div class="grn-section-title" style="margin-bottom:0">Items received</div>
  <table class="grn-table">
    <colgroup>${money
      ? '<col style="width:4%"><col style="width:21%"><col style="width:10%"><col style="width:11%"><col style="width:11%"><col style="width:12%"><col style="width:9%"><col style="width:11%"><col style="width:11%">'
      : '<col style="width:5%"><col style="width:29%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:16%"><col style="width:14%">'}</colgroup>
    <thead><tr><th class="grn-center">#</th><th>Item</th><th class="grn-number">Received</th><th class="grn-number">Rejected</th><th class="grn-number">Accepted</th><th>Batch</th><th>Expiry</th>${money ? '<th class="grn-number">Rate</th><th class="grn-number">Accepted value</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
    ${money ? `<tfoot><tr><td colspan="8" class="grn-number">Accepted value (before GST)</td><td class="grn-number">${formatMoney(grn.totalValue)}</td></tr></tfoot>` : ''}
  </table>
  ${grn.notes ? `<div class="grn-notes"><strong>Receipt notes</strong><br>${escapeHtml(grn.notes)}</div>` : ''}
  <div class="grn-signatures">
    <div class="grn-signature">Received by<small>Name, signature and date</small></div>
    <div class="grn-signature">Checked by<small>Quality / quantity verification</small></div>
    <div class="grn-signature">Store in-charge<small>Signature and date</small></div>
  </div>
</div>`

  printViaIframe(gudmedDocument({
    orgInfo: { name: grn.hospital?.name, address: grn.hospital?.address, city: grn.hospital?.city },
    title: grn.number, subtitle: 'Stores',
    headerRight: `GRN ${escapeHtml(grn.number)}<br>Stores copy`,
    body, variant: 'purchase purchase-custom',
  }))
}
