import { gudmedDocument, infoBox, escapeHtml, printViaIframe } from '@/lib/printTemplate'
import { formatDateTime } from '@/lib/format'

// The printed request for quotation — the hospital's letterhead (the shared
// GudMed print shell), what is asked and by when, and blank columns for the
// vendor to fill in: what goes to a vendor who is not e-mailed, or is handed
// the paper. It carries no other vendor's rates.

const day = (d) => (d ? formatDateTime(d, { withTime: false }) : '—')

export function printRfq(rfq) {
  const rows = rfq.lines.map((l, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(l.itemName)}<br><span style="color:#666;font-size:8pt">${escapeHtml(l.itemCode)}${l.item?.hsnCode ? ` · HSN ${escapeHtml(l.item.hsnCode)}` : ''}</span></td>
    <td style="text-align:right">${l.quantity} ${escapeHtml(l.unitCode)}</td>
    <td style="width:16%"></td><td style="width:9%"></td><td style="width:9%"></td><td style="width:10%"></td>
  </tr>`).join('')

  const body = `
${infoBox('Request for quotation', [
    { label: 'RFQ number', value: rfq.number },
    { label: 'Subject', value: rfq.title },
    { label: 'Date', value: day(rfq.sentAt || rfq.createdAt) },
    { label: 'Quote by', value: day(rfq.dueDate) },
  ])}
${infoBox('Vendor', [
    { label: 'Name', value: '' }, { label: 'GSTIN', value: '' }, { label: 'Contact', value: '' }, { label: 'Date of quote', value: '' },
  ])}
<table>
  <thead><tr><th>#</th><th>Item</th><th style="text-align:right">Quantity</th><th>Rate / unit (₹, before GST)</th><th>Disc %</th><th>GST %</th><th>Can supply?</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="note-bar">Please fill in the rate per unit before GST, any discount and the GST for each item, and mark any item you cannot supply.
Delivery time (days): ________ &nbsp;&nbsp; Rates valid till: ____________. Quote RFQ number <b>${escapeHtml(rfq.number)}</b>.</div>
${rfq.notes ? `<div class="note-bar"><b>Note:</b> ${escapeHtml(rfq.notes)}</div>` : ''}
<div style="display:flex;justify-content:space-between;margin-top:36px;font-size:9.5pt">
  <div>Asked by: ${escapeHtml(rfq.createdByName || '')}, Purchase Department</div>
  <div style="text-align:center">______________________<br>Vendor's signature and seal</div>
</div>`

  printViaIframe(gudmedDocument({
    orgInfo: { name: rfq.hospital?.name, address: rfq.hospital?.address, city: rfq.hospital?.city },
    title: rfq.number, banner: 'REQUEST FOR QUOTATION', subtitle: 'Purchase Department',
    headerRight: `${escapeHtml(rfq.number)}<br>Quote by ${day(rfq.dueDate)}`,
    body,
  }))
}
