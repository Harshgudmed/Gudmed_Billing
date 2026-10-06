import { gudmedDocument, infoBox, escapeHtml, printViaIframe } from '@/lib/printTemplate'
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
  const rows = po.lines.map((l, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(l.itemName)}<br><span style="color:#666;font-size:8pt">${escapeHtml(l.itemCode)}${l.note ? ` · ${escapeHtml(l.note)}` : ''}</span></td>
    <td>${escapeHtml(l.hsnCode || '—')}</td>
    <td style="text-align:right">${l.quantity} ${escapeHtml(l.unitCode)}</td>
    <td style="text-align:right">${formatMoney(l.rate)}</td>
    <td style="text-align:right">${l.discountPct ? `${l.discountPct}%` : '—'}</td>
    <td style="text-align:right">${po.gstType === 'none' ? '—' : `${l.gstRate}%`}</td>
    <td style="text-align:right">${formatMoney(l.lineTotal)}</td>
  </tr>`).join('')
  const tax = po.gstType === 'intra'
    ? `<tr><td colspan="7" style="text-align:right">CGST</td><td style="text-align:right">${formatMoney(po.cgst)}</td></tr>
       <tr><td colspan="7" style="text-align:right">SGST</td><td style="text-align:right">${formatMoney(po.sgst)}</td></tr>`
    : po.gstType === 'inter'
      ? `<tr><td colspan="7" style="text-align:right">IGST</td><td style="text-align:right">${formatMoney(po.igst)}</td></tr>`
      : ''
  const words = `${amountInWords(Number(po.total) || 0)} Rupee(s) Only`

  const body = `
${infoBox('Vendor', [
    { label: 'Name', value: v.name || po.vendorName },
    { label: 'GSTIN', value: v.gstNumber || 'Not registered' },
    { label: 'Contact', value: [v.contactPerson, v.phone].filter(Boolean).join(' · ') || '—' },
    { label: 'Address', value: vendorAddress || '—' },
  ])}
${infoBox('Order', [
    { label: 'PO number', value: po.number },
    { label: 'Date', value: formatDateTime(po.orderDate, { withTime: false }) },
    { label: 'Deliver by', value: po.expectedDate ? formatDateTime(po.expectedDate, { withTime: false }) : 'As soon as possible' },
    { label: 'Payment', value: po.paymentTermsDays != null ? `${po.paymentTermsDays} days from invoice` : 'As agreed' },
  ])}
<table>
  <thead><tr><th>#</th><th>Item</th><th>HSN/SAC</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Disc</th><th style="text-align:right">GST</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr><td colspan="7" style="text-align:right">Subtotal</td><td style="text-align:right">${formatMoney(po.subtotal)}</td></tr>
    ${tax}
    <tr><td colspan="7" style="text-align:right">Total (${escapeHtml(GST_TYPE[po.gstType] || '')})</td><td style="text-align:right">${formatMoney(po.total)}</td></tr>
  </tfoot>
</table>
${words ? `<div class="note-bar"><b>Amount in words:</b> ${escapeHtml(words)}</div>` : ''}
${po.terms ? `<div class="note-bar"><b>Terms</b><br>${escapeHtml(po.terms).replace(/\n/g, '<br>')}</div>` : ''}
<div style="display:flex;justify-content:space-between;margin-top:36px;font-size:9.5pt">
  <div>Prepared by: ${escapeHtml(po.createdByName || '')}</div>
  <div style="text-align:center">______________________<br>Authorised signatory</div>
</div>`

  printViaIframe(gudmedDocument({
    orgInfo: { name: po.hospital?.name, address: po.hospital?.address, city: po.hospital?.city },
    title: po.number, banner: 'PURCHASE ORDER', subtitle: 'Purchase Department',
    headerRight: `${escapeHtml(po.number)}<br>${formatDateTime(po.orderDate, { withTime: false })}`,
    body,
  }))
}

// The printed goods receipt note (GRN): what came against which order, what
// was accepted and what turned back, with batch and expiry, signed by the
// store. A store login's copy has no money in it — the server sent none.
export function printReceipt(grn) {
  const money = grn.totalValue !== undefined
  const date = (d) => (d ? formatDateTime(d, { withTime: false }) : '—')
  const rows = grn.lines.map((l, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(l.itemName)}<br><span style="color:#666;font-size:8pt">${escapeHtml(l.itemCode)}</span></td>
    <td style="text-align:right">${l.receivedQty} ${escapeHtml(l.unitCode)}</td>
    <td style="text-align:right">${l.rejectedQty ? `${l.rejectedQty}<br><span style="color:#666;font-size:8pt">${escapeHtml(l.rejectReason || '')}</span>` : '—'}</td>
    <td style="text-align:right"><b>${l.acceptedQty}</b></td>
    <td>${escapeHtml(l.batchNumber || '—')}</td>
    <td>${date(l.expiryDate)}</td>
    ${money ? `<td style="text-align:right">${formatMoney(l.rate)}</td><td style="text-align:right">${formatMoney(l.acceptedQty * l.rate)}</td>` : ''}
  </tr>`).join('')

  const body = `
${infoBox('Vendor', [
    { label: 'Name', value: grn.vendorName },
    { label: 'Challan / invoice', value: grn.challanNumber || '—' },
    { label: 'Challan date', value: date(grn.challanDate) },
  ])}
${infoBox('Receipt', [
    { label: 'GRN number', value: grn.number },
    { label: 'Against order', value: grn.order?.number || '—' },
    { label: 'Received on', value: formatDateTime(grn.receivedAt) },
    { label: 'Received by', value: grn.receivedByName },
  ])}
${grn.status === 'cancelled' ? `<div class="note-bar"><b>CANCELLED</b> by ${escapeHtml(grn.cancelledByName || '')}: ${escapeHtml(grn.cancelReason || '')}</div>` : ''}
<table>
  <thead><tr><th>#</th><th>Item</th><th style="text-align:right">Received</th><th style="text-align:right">Rejected</th><th style="text-align:right">Accepted</th><th>Batch</th><th>Expiry</th>${money ? '<th style="text-align:right">Rate</th><th style="text-align:right">Value</th>' : ''}</tr></thead>
  <tbody>${rows}</tbody>
  ${money ? `<tfoot><tr><td colspan="8" style="text-align:right">Value accepted (before GST)</td><td style="text-align:right">${formatMoney(grn.totalValue)}</td></tr></tfoot>` : ''}
</table>
${grn.notes ? `<div class="note-bar"><b>Note:</b> ${escapeHtml(grn.notes)}</div>` : ''}
<div style="display:flex;justify-content:space-between;gap:16px;margin-top:40px;font-size:9.5pt;text-align:center">
  <div>______________________<br>Received by</div>
  <div>______________________<br>Checked by</div>
  <div>______________________<br>Store in-charge</div>
</div>`

  printViaIframe(gudmedDocument({
    orgInfo: { name: grn.hospital?.name, address: grn.hospital?.address, city: grn.hospital?.city },
    title: grn.number, banner: 'GOODS RECEIPT NOTE', subtitle: 'Stores',
    headerRight: `${escapeHtml(grn.number)}<br>${formatDateTime(grn.receivedAt, { withTime: false })}`,
    body,
  }))
}
