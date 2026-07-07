import { format } from 'date-fns'
import { toast } from 'sonner'

// Shared by every print-window builder below — user-entered text (names,
// addresses, drug names) must never be interpolated into these HTML strings
// unescaped, or a value like `<script>` in a patient/drug name would execute
// in the print window.
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
// Names arrive in whatever case the front-desk typed them in — title-case them.
const titleCase = (s) => String(s ?? '').trim().toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
// Indian-rupee money formatter — ₹ symbol + en-IN grouping + 2 decimals. Used by
// EVERY receipt (Pharmacy, Lab, Radiology, Payment table) so amounts look the same.
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── SHARED multi-payment "Payment" table (Pharmacy / Lab / Radiology / Billing) ──
// One bill can be settled across several receipts and methods (e.g. ₹3000 Cash +
// ₹2000 UPI). This renders the DRLOGY-style Payment ledger block used by EVERY
// receipt renderer below, so the layout is identical everywhere. Pass the list of
// payment records; returns '' when there are 0/1 payments (no ledger needed — the
// single "Paid Amount" line in the totals box already says everything).
//   payments = [{ receiptNumber, paymentDate|date, invoiceNumber|invoiceNo,
//                 amount, paymentMethod|method|paymode, reference }]
// opts.force = true  → always render even for a single payment (some hospitals
//                      want the ledger printed even when there's one row).
export function renderPaymentTable(payments, opts = {}) {
  const list = Array.isArray(payments) ? payments.filter(Boolean) : []
  if (list.length === 0) return ''
  if (list.length === 1 && !opts.force) return ''

  const rows = list.map((p, i) => {
    const rcpt = p.receiptNumber || p.receiptNo || '—'
    const when = p.paymentDate || p.date || p.paidAt || p.createdAt
    const dateStr = when ? format(new Date(when), 'dd MMM yyyy, hh:mm aa') : '—'
    const inv = p.invoiceNumber || p.invoiceNo || p.invoice || '—'
    const amt = Number(p.amount || 0)
    const mode = p.paymentMethod || p.method || p.paymode || p.mode || '—'
    return `<tr>
      <td class="sno">${i + 1}</td>
      <td>${esc(rcpt)}</td>
      <td>${esc(dateStr)}</td>
      <td>${esc(inv)}</td>
      <td style="text-align:right">${inr(amt)}</td>
      <td>${esc(String(mode).charAt(0).toUpperCase() + String(mode).slice(1))}</td>
    </tr>`
  }).join('')

  const totalPaid = list.reduce((s, p) => s + Number(p.amount || 0), 0)
  const words = amountInWords(totalPaid)

  return `
<div class="paytitle">Payment</div>
<table class="paytable"><thead><tr>
  <th style="width:38px">SN</th><th style="width:110px">Receipt No</th><th style="width:110px">Date</th>
  <th>Invoice No</th><th style="width:110px">Amount (Rs)</th><th style="width:90px">Paymode</th>
</tr></thead><tbody>${rows}
  <tr class="paytotal">
    <td colspan="4" style="text-align:right">Total</td>
    <td style="text-align:right">${inr(totalPaid)}</td>
    <td></td>
  </tr>
</tbody></table>
<div class="paythanks">Received with Thanks: Rs. ${esc(words)} Only</div>`
}

// CSS for the shared Payment table — injected into each receipt's <style> block.
const PAYMENT_TABLE_CSS = `
.paytitle{text-align:center;font-weight:700;font-size:11pt;color:#1a3e6f;margin:14px 0 6px;letter-spacing:.5px}
.paytable{width:100%;border-collapse:collapse;margin-bottom:6px;border:1px solid #e2e8f0;border-radius:5px;overflow:hidden}
.paytable thead th{background:#f1f5f9;color:#1a3e6f;border-bottom:2px solid #1a3e6f;padding:7px 10px;text-align:left;font-size:8pt;letter-spacing:.3px;text-transform:uppercase;font-weight:700}
.paytable tbody td{padding:7px 10px;border-bottom:1px solid #eef1f4;font-size:9pt}
.paytable tbody tr:nth-child(even){background:#fafbfc}
.paytable td.sno{text-align:center;color:#94a3b8;font-weight:700}
.paytable tr.paytotal td{background:#eef2f8;font-weight:800;color:#1a3e6f;font-size:9.5pt}
.paythanks{font-size:8.5pt;color:#475569;margin-bottom:12px}`

export function printInvoice(bill, orgInfo, clinic) {
  const win = window.open('', '_blank', 'width=900,height=780')
  if (!win) { toast.error('Allow pop-ups to print'); return }
  
  const itemRows = (bill.items || []).map((it, i) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${i + 1}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${it.name}${it.sub ? `<br/><span style="font-size:9pt;color:#888">${it.sub}</span>` : ''}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${it.qty}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">₹${Number(it.amt).toLocaleString('en-IN')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">₹${(it.qty * it.amt).toLocaleString('en-IN')}</td>
    </tr>`).join('')
  
  const calcSubtotal = bill.subtotal || (bill.items || []).reduce((a, i) => a + i.qty * i.amt, 0)

  const html = `<!DOCTYPE html><html><head><title>Invoice ${bill.invoiceNo}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;color:#222;padding:30px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px}
.hosp-name{font-size:18pt;font-weight:700;color:#1e3a5f}.hosp-sub{font-size:9pt;color:#555;margin-top:3px}
.banner{background:#1e3a5f;color:#fff;text-align:center;padding:6px;font-size:13pt;font-weight:700;letter-spacing:2px;margin-bottom:14px}
.patient-box{background:#f0f4f8;border:1px solid #ddd;border-radius:4px;padding:10px 14px;margin-bottom:14px;display:flex;gap:24px;flex-wrap:wrap}
.patient-field label{font-size:8pt;color:#666;font-weight:700;text-transform:uppercase;display:block}
.patient-field span{font-size:11pt;font-weight:600}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
thead th{background:#1e3a5f;color:#fff;padding:7px 10px;text-align:left;font-size:9.5pt}
.total-wrap{display:flex;justify-content:flex-end;margin-bottom:12px}
.total-box{border:2px solid #1e3a5f;border-radius:4px;overflow:hidden;width:260px}
.total-row{display:flex;justify-content:space-between;padding:6px 12px;border-bottom:1px solid #eee;font-size:10.5pt}
.total-final{background:#1e3a5f;color:#fff;font-weight:700;font-size:12pt;border-bottom:none}
.status-badge{display:inline-block;padding:2px 12px;border-radius:20px;font-size:10pt;font-weight:700}
.footer{border-top:1px solid #ccc;padding-top:8px;margin-top:14px;font-size:8pt;color:#888;text-align:center}
${PAYMENT_TABLE_CSS}
@media print{body{padding:10px}}</style></head><body>
<div class="header">
  <div>
    ${orgInfo.logoUrl ? `<img src="${orgInfo.logoUrl}" alt="" style="height:46px;max-width:170px;object-fit:contain;margin-bottom:6px"/>` : ''}
    <div class="hosp-name">${orgInfo.name || clinic.clinicName}</div>
    <div class="hosp-sub">${clinic.address || ''}${clinic.phone ? ' · Ph: ' + clinic.phone : ''}</div>
    ${clinic.regNo ? `<div class="hosp-sub">Reg: ${clinic.regNo}${clinic.gstNo ? ' · GST: ' + clinic.gstNo : ''}</div>` : ''}
  </div>
  <div style="text-align:right">
    <div style="font-size:10pt;color:#555">Invoice #: <strong>${bill.invoiceNo}</strong></div>
    <div style="font-size:9pt;color:#555">Date: ${bill.date}</div>
    <span class="status-badge" style="background:${bill.paid ? '#d1fae5' : '#fef3c7'};color:${bill.paid ? '#065f46' : '#92400e'};border:1px solid ${bill.paid ? '#6ee7b7' : '#fde68a'};margin-top:6px;display:inline-block">${bill.paid ? 'PAID' : 'PENDING'}</span>
  </div>
</div>
<div class="banner">${(bill.department ? bill.department.toUpperCase() + ' ' : '')}INVOICE</div>
<div class="patient-box">
  <div class="patient-field"><label>Patient</label><span>${bill.patientName}</span></div>
  ${bill.phone ? `<div class="patient-field"><label>Phone</label><span>${bill.phone}</span></div>` : ''}
  ${bill.uhid ? `<div class="patient-field"><label>UHID</label><span>${bill.uhid}</span></div>` : ''}
  ${bill.age ? `<div class="patient-field"><label>Age</label><span>${bill.age} yrs</span></div>` : ''}
</div>
<table>
  <thead><tr><th>#</th><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<div class="total-wrap"><div class="total-box">
  <div class="total-row"><span>Subtotal</span><span>₹${Number(calcSubtotal).toLocaleString('en-IN')}</span></div>
  ${(bill.discountAmt || 0) > 0 ? `<div class="total-row" style="color:#16a34a"><span>Discount (${bill.discount}%)</span><span>-₹${Number(bill.discountAmt).toLocaleString('en-IN')}</span></div>` : ''}
  ${(bill.homeCollectionCharge || 0) > 0 ? `<div class="total-row"><span>Home Collection</span><span>₹${Number(bill.homeCollectionCharge).toLocaleString('en-IN')}</span></div>` : ''}
  <div class="total-row total-final"><span>NET PAYABLE</span><span>₹${Number(bill.total).toLocaleString('en-IN')}</span></div>
  ${bill.amountPaid !== undefined ? `<div class="total-row" style="color:#065f46"><span>Amount Paid</span><span>₹${Number(bill.amountPaid || 0).toLocaleString('en-IN')}</span></div>` : ''}
  ${bill.balanceDue !== undefined ? `<div class="total-row" style="${(bill.balanceDue || 0) > 0 ? 'color:#b91c1c' : 'color:#065f46'}"><span>Balance Due</span><span>₹${Number(bill.balanceDue || 0).toLocaleString('en-IN')}</span></div>` : ''}
</div></div>
${renderPaymentTable(bill.payments, { force: true })}
${bill.notes ? `<div style="background:#f8fafc;border:1px solid #eee;border-radius:4px;padding:8px 12px;font-size:10pt;margin-bottom:12px">Notes: ${bill.notes}</div>` : ''}
<div class="footer">${orgInfo.name || clinic.clinicName} · Computer-generated invoice · gudmed.in</div>
</body></html>`
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 500)
}

export function printReceipt(p, orgInfo, clinic) {
  const win = window.open('', '_blank', 'width=480,height=680')
  if (!win) { toast.error('Allow pop-ups to print'); return }

  const patientName = p.invoice?.patient
    ? `${p.invoice.patient.firstName} ${p.invoice.patient.lastName}`
    : (p.patient ? `${p.patient.firstName} ${p.patient.lastName}` : 'Patient')
  const mrn     = p.invoice?.patient?.mrn || p.patient?.mrn || ''
  const rxDate  = p.paymentDate ? format(new Date(p.paymentDate), 'dd MMM yyyy, hh:mm aa') : format(new Date(), 'dd MMM yyyy, hh:mm aa')
  const invNo   = p.invoice?.invoiceNumber || '—'
  const hospName  = orgInfo.name   || clinic.clinicName || 'Hospital'
  const hospAddr  = clinic.address || orgInfo.address   || ''
  const hospPhone = clinic.phone   || orgInfo.phone     || ''
  const hospEmail = orgInfo.email  || ''
  const regNo     = clinic.regNo   || ''
  const upi       = clinic.upiId   || ''

  const html = `<!DOCTYPE html>
<html><head><title>Receipt ${p.receiptNumber}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Courier New', monospace; font-size: 11pt; color: #111; background: #fff; padding: 0; }
.page { max-width: 360px; margin: 0 auto; padding: 18px 20px; }

/* Header */
.hosp-name { font-size: 16pt; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
.hosp-sub  { font-size: 8.5pt; text-align: center; color: #444; margin-top: 2px; line-height: 1.5; }
.divider   { border: none; border-top: 1px dashed #666; margin: 8px 0; }
.divider-solid { border: none; border-top: 2px solid #111; margin: 8px 0; }

/* Title */
.receipt-title { text-align: center; font-size: 13pt; font-weight: 700; letter-spacing: 3px; margin: 6px 0; }

/* Info rows */
.row { display: flex; justify-content: space-between; font-size: 9.5pt; margin: 3px 0; }
.row .lbl { color: #555; }
.row .val { font-weight: 600; text-align: right; }

/* Amount box */
.amount-box { background: #111; color: #fff; text-align: center; padding: 10px 0; margin: 10px 0; border-radius: 2px; }
.amount-box .amt-label { font-size: 8pt; letter-spacing: 2px; text-transform: uppercase; opacity: 0.7; }
.amount-box .amt-value { font-size: 22pt; font-weight: 700; }

/* Method */
.method-badge { display: inline-block; background: #e8f5e9; color: #1b5e20; border: 1px solid #a5d6a7; padding: 3px 12px; border-radius: 20px; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }

/* Footer */
.footer { text-align: center; font-size: 8pt; color: #666; margin-top: 10px; line-height: 1.6; }
.thank-you { text-align: center; font-size: 11pt; font-weight: 700; margin: 8px 0 4px; }

@media print {
  body { padding: 0; }
  .page { max-width: 100%; padding: 10px 14px; }
  button { display: none; }
}
</style>
</head><body>
<div class="page">

<!-- Hospital Header -->
${orgInfo.logoUrl ? `<img src="${orgInfo.logoUrl}" alt="" style="display:block;margin:0 auto 6px;height:48px;max-width:70%;object-fit:contain"/>` : ''}
<div class="hosp-name">${hospName}</div>
<div class="hosp-sub">
  ${hospAddr ? hospAddr + '<br/>' : ''}
  ${hospPhone ? 'Ph: ' + hospPhone : ''}${hospEmail ? ' | ' + hospEmail : ''}
  ${regNo ? '<br/>Reg. No: ' + regNo : ''}
</div>

<hr class="divider-solid" style="margin-top:10px"/>

<div class="receipt-title">PAYMENT RECEIPT</div>

<hr class="divider"/>

<!-- Receipt Details -->
<div class="row"><span class="lbl">Receipt No.</span><span class="val">${p.receiptNumber}</span></div>
<div class="row"><span class="lbl">Date & Time</span><span class="val">${rxDate}</span></div>
<div class="row"><span class="lbl">Invoice No.</span><span class="val">${invNo}</span></div>

<hr class="divider"/>

<!-- Patient Details -->
<div class="row"><span class="lbl">Patient Name</span><span class="val">${patientName}</span></div>
${mrn ? `<div class="row"><span class="lbl">UHID / MRN</span><span class="val">${mrn}</span></div>` : ''}

<hr class="divider"/>

<!-- Amount -->
<div class="amount-box">
  <div class="amt-label">${p.isRefund ? 'Amount Refunded' : 'Amount Paid'}</div>
  <div class="amt-value">₹${Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
</div>

<!-- Payment Method -->
<div style="text-align:center; margin: 6px 0;">
  <span class="method-badge">${p.isRefund ? 'REFUND · ' : ''}${p.paymentMethod}</span>
</div>

<hr class="divider"/>

<!-- Invoice financial summary (Dr-Lal style): Order Value / Paid / Balance -->
${p.invoice ? `
<div class="row"><span class="lbl">Order Value</span><span class="val">₹${Number(p.invoice.totalAmount || 0).toLocaleString('en-IN')}</span></div>
<div class="row"><span class="lbl">Total Paid</span><span class="val">₹${Number(p.invoice.amountPaid || 0).toLocaleString('en-IN')}</span></div>
<div class="row"><span class="lbl">Balance Due</span><span class="val" style="${(p.invoice.balanceDue || 0) > 0 ? 'color:#b91c1c' : 'color:#065f46'}">₹${Number(p.invoice.balanceDue || 0).toLocaleString('en-IN')}</span></div>
<hr class="divider"/>` : ''}

<!-- UPI / Bank info if available -->
${upi ? `<div class="row"><span class="lbl">UPI ID</span><span class="val">${upi}</span></div>` : ''}
${clinic.bankName ? `<div class="row"><span class="lbl">Bank</span><span class="val">${clinic.bankName}</span></div>` : ''}

<hr class="divider"/>

<div class="thank-you">Thank you for your payment!</div>
<div class="footer">
  This is a computer-generated receipt.<br/>
  No signature required.<br/>
  ${hospName} · gudmed.in
</div>

<hr class="divider" style="margin-top:14px"/>
</div>

<script>window.onload = function() { window.print() }<\/script>
</body></html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
}

// ── Amount → words (Indian numbering) ───────────────────────────────────────────
export function amountInWords(num) {
  num = Math.round(Number(num) || 0)
  if (num === 0) return 'Zero'
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const two = (n) => n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '')
  const three = (n) => n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n)
  let out = '', crore = Math.floor(num / 10000000); num %= 10000000
  const lakh = Math.floor(num / 100000); num %= 100000
  const thou = Math.floor(num / 1000); num %= 1000
  if (crore) out += three(crore) + ' Crore '
  if (lakh) out += three(lakh) + ' Lakh '
  if (thou) out += three(thou) + ' Thousand '
  if (num) out += three(num)
  return out.trim()
}

// ── Code 39 barcode → inline SVG (scannable, no external library) ───────────────
export function barcode39(text, height = 44) {
  const C39 = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
    '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
    'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
    'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
    'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
    'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
    'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
    'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
  }
  const data = '*' + String(text).toUpperCase().replace(/[^0-9A-Z\-. ]/g, '') + '*'
  const N = 1.5, W = N * 3
  let x = 0
  const rects = []
  for (const ch of data) {
    const pat = C39[ch]
    if (!pat) continue
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === 'w' ? W : N
      if (i % 2 === 0) rects.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}"/>`)
      x += w
    }
    x += N // inter-character gap
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x.toFixed(2)}" height="${height}" viewBox="0 0 ${x.toFixed(2)} ${height}" preserveAspectRatio="none" fill="#000" style="display:block;margin-left:auto;max-width:240px;height:${height}px">${rects.join('')}</svg>`
}

// ── SHARED Dr-Lal-PathLabs-style diagnostic receipt (Lab + Radiology) ───────────
// One renderer so the Laboratory bill and the Radiology bill are structurally
// IDENTICAL everywhere (Billing module AND each module's own print button) —
// only the department-specific wording (headers/footer/timing copy) differs,
// via the `dept` config below. Hospital header comes from org Settings.
//   r = { invoiceNo, labId, patientName, uhid, age, sex, contact, dateTime,
//         refDoctor, mode, items:[{code,name,eta,price}],
//         orderValue, homeCollection, discount, netPayable, paid, balance }
const LAB_DEPT = {
  idFieldLabel: 'Lab ID',
  labCodeFieldLabel: 'Lab Code / CC Code',
  itemCodeHeader: 'Test Code',
  itemNameHeader: 'Test Name',
  footerDept: 'Laboratory & Pathology Department',
  reportsDownloadLabel: 'Pathology Lab reports',
  timingLine: 'Sample Collection Timing: 07:00 - 16:00 &nbsp;|&nbsp; Report Timing: As per test schedule.',
  newIdNote: 'A new Lab ID will be issued for any sample submitted after the above registration date.',
}

const RADIOLOGY_DEPT = {
  idFieldLabel: 'Order ID',
  labCodeFieldLabel: 'Radiology Code / CC Code',
  itemCodeHeader: 'Test Code',
  itemNameHeader: 'Test Name',
  footerDept: 'Radiology & Imaging Department',
  reportsDownloadLabel: 'Radiology reports',
  timingLine: 'Scan Timing: 07:00 - 20:00 &nbsp;|&nbsp; Report Timing: As per exam schedule.',
  newIdNote: 'A new Order ID will be issued for any exam scheduled after the above registration date.',
  
}

function printDiagnosticReceipt(r, orgInfo = {}, clinic = {}, dept = LAB_DEPT) {
  const win = window.open('', '_blank', 'width=880,height=780')
  if (!win) { toast.error('Allow pop-ups to print'); return }
  const gh = orgInfo.name || clinic.clinicName || 'Hospital'
  // Value resolver: per-invoice (clinic) first, then hospital Settings (orgInfo).
  const val = (k) => clinic[k] || orgInfo[k] || ''
  // Hospital decides: show blank fields as "NA" (Dr Lal style) or hide them.
  const showEmpty = clinic.showEmptyReceiptFields ?? orgInfo.showEmptyReceiptFields ?? true
  const rows = (r.items || []).map((it, i) => `
    <tr><td>${i + 1}</td><td class="code">${esc(it.code)}</td>
    <td><strong>${esc(it.name)}</strong></td><td>${esc(it.eta || '')}</td>
    <td>${inr(it.price)}</td></tr>`).join('')
  const orderValue = Number(r.orderValue || 0)
  const home = r.homeCollection !== undefined ? Number(r.homeCollection) : Number(orgInfo.homeCollectionCharge || clinic.homeCollectionCharge || 0)
  const disc = Number(r.discount || 0)
  const net = r.netPayable !== undefined ? Number(r.netPayable) : orderValue + home - disc
  const paid = Number(r.paid || 0), bal = r.balance !== undefined ? Number(r.balance) : net - paid

  // Build ONE clean address line. The Address field often already contains the
  // city/state, so only append city/region if they aren't already present
  // (prevents "…Gurugram, Haryana … Gurugram, Haryana" duplication).
  const baseAddr = clinic.address || orgInfo.address || ''
  const lower = baseAddr.toLowerCase()
  const addrParts = [baseAddr]
  if (orgInfo.city && !lower.includes(orgInfo.city.toLowerCase())) addrParts.push(orgInfo.city)
  if (orgInfo.region && !lower.includes(orgInfo.region.toLowerCase())) addrParts.push(orgInfo.region)
  const fullAddr = addrParts.filter(Boolean).join(', ')
  // 3-column grid rows: [label] [:] [value]. Colon aligns; long value wraps
  // under the value column (not under the label). Label column = widest label.
  const regLines = [
    ['Address', fullAddr],
    ['Phone', orgInfo.phone],
    ['Email', orgInfo.email],
    ['Website', val('website')],
  ].filter(([, v]) => v && String(v).trim() !== '')
    .map(([k, v]) => `<span class="k">${k}</span><span class="c">:</span><span class="v">${esc(v)}</span>`).join('')

  // Info-grid fields — hidden when blank unless the hospital enabled "show as NA".
  // Left and right columns are built as TWO SEPARATE lists (not one flat array
  // read in pairs) — if a field in one column is blank and gets hidden, only
  // that column shifts up; the other column's fields never move. Otherwise a
  // single blank field (e.g. no Mode of Payment yet) would push every field
  // after it — including Contact Number — into the wrong slot.
  const isBlank = v => v === undefined || v === null || String(v).trim() === ''
  const visible = (fields) => fields.filter(([, v]) => showEmpty || !isBlank(v))

  const leftFields = visible([
    ['Invoice Number', r.invoiceNo],
    [dept.idFieldLabel, r.labId || r.uhid],
    ['Date & Time', r.dateTime],
    ['Reference Doctor', r.refDoctor || 'self'],
    ['Mode of Payment', r.mode],
    ['SAC Code', val('sacCode')],
    [dept.labCodeFieldLabel, val('labCode')],
    ['Card No', r.cardNo],
  ])
  const rightFields = visible([
    ['Patient ID / UHID', r.uhid],
    ['Patient Name', titleCase(r.patientName)],
    ['Age / Sex', [r.age, r.sex].filter(Boolean).join(' / ')],
    ['Contact Number', r.contact],
    ['GST No', val('gstNo')],
    ['CIN No', val('cin') || clinic.regNo],
    ['Patient Emp. Code', r.empCode],
    ['Corporate Code', r.corporateCode],
  ])
  const cellHtml = ([l, v]) => `<div class="cell"><span class="l">${l}</span><span class="v">${esc(isBlank(v) ? 'NA' : v)}</span></div>`
  const rowCount = Math.max(leftFields.length, rightFields.length)
  let gridCells = ''
  for (let i = 0; i < rowCount; i++) {
    gridCells += leftFields[i] ? cellHtml(leftFields[i]) : '<div class="cell"></div>'
    gridCells += rightFields[i] ? cellHtml(rightFields[i]) : '<div class="cell"></div>'
  }

  // Browsers use the document <title> as the suggested filename when the user
  // does "Save as PDF" from the print dialog — hospitals usually want that file
  // named "PatientName_LabID" (falling back to the invoice number if no lab ID).
  const fileName = `${titleCase(r.patientName).replace(/\s+/g, '_') || 'Patient'}_${r.labId || r.invoiceNo || ''}`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(fileName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:9pt;color:#1f2937;background:#eef1f5;padding:16px}
.page{max-width:200mm;margin:0 auto;background:#fff;padding:24px 26px 34px;border:1px solid #d7dce3;border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.08)}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a3e6f;padding-bottom:12px;margin-bottom:14px}
.left{max-width:72%}
.namerow{display:flex;align-items:center;gap:12px;margin-bottom:4px}
.brand{font-size:17pt;font-weight:700;color:#1a3e6f;line-height:1.1}
.reg{display:grid;grid-template-columns:auto auto 1fr;column-gap:6px;row-gap:3px;font-size:7.5pt;line-height:1.45;margin-top:4px;max-width:520px}
.reg .k{font-weight:700;color:#334155;white-space:nowrap}
.reg .c{color:#334155}
.reg .v{color:#64748b}
.labid{text-align:right;min-width:200px}
.labnum{font-size:13pt;font-weight:700;letter-spacing:3px;text-align:right;margin-top:3px;color:#111827}
.title{text-align:center;font-weight:700;font-size:12pt;letter-spacing:1px;color:#1a3e6f;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:6px;margin-bottom:2px}
.subtitle{text-align:center;font-size:7.5pt;color:#64748b;letter-spacing:.5px;margin:4px 0 12px}
.grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e2e8f0;border-radius:5px;overflow:hidden;margin-bottom:12px}
.cell{display:flex;padding:5px 12px;border-bottom:1px solid #eef1f4;font-size:8.5pt}
.cell:nth-child(4n+1),.cell:nth-child(4n+2){background:#fafbfc}
.cell:nth-child(odd){border-right:1px solid #eef1f4}
.cell .l{min-width:132px;color:#64748b;font-weight:600}.cell .v{flex:1;font-weight:700;color:#1f2937}
table{width:100%;border-collapse:collapse;margin-bottom:14px;border:1px solid #e2e8f0;border-radius:5px;overflow:hidden}
thead th{background:#f1f5f9;color:#1a3e6f;border-bottom:2px solid #1a3e6f;padding:10px 12px;text-align:left;font-size:9pt;letter-spacing:.3px;text-transform:uppercase;font-weight:700}
thead th:last-child{text-align:right}
tbody td{padding:10px 12px;border-bottom:1px solid #eef1f4;font-size:10pt}
tbody tr:nth-child(even){background:#fafbfc}
tbody td:last-child{text-align:right;font-weight:700}
.code{font-family:'Courier New',monospace;color:#1a3e6f;font-weight:700}
.totwrap{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:16px}
.words{font-size:9pt;color:#475569;padding-bottom:4px}.words b{color:#1f2937}
.totals{width:300px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}
.trow{display:flex;justify-content:space-between;padding:7px 16px;font-size:10pt;color:#475569}
.trow.sub{background:#fafbfc;font-weight:700;color:#1f2937}
.trow.net{background:#eef2f8;color:#1a3e6f;font-weight:800;font-size:11.5pt;border-top:1px solid #cdd7e5;border-bottom:1px solid #cdd7e5}
.note{background:#f9fafb;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;font-size:7.5pt;color:#64748b;line-height:1.7}.note b{color:#334155}
.foot{text-align:center;font-size:7.5pt;color:#94a3b8;margin-top:28px}
.pbtn{position:fixed;top:12px;right:12px;background:#1a3e6f;color:#fff;border:0;padding:8px 16px;border-radius:5px;font-size:10pt;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.2)}
${PAYMENT_TABLE_CSS}
@media print{body{background:#fff;padding:0}.page{box-shadow:none;border:none;border-radius:0}.pbtn{display:none}@page{size:A4;margin:10mm}}
</style></head><body>
<button class="pbtn" onclick="window.print()">Print</button>
<div class="page">
<div class="top">
  <div class="left">
    <div class="namerow">
      ${orgInfo.logoUrl ? `<img src="${esc(orgInfo.logoUrl)}" alt="" style="height:52px;max-width:130px;object-fit:contain"/>` : ''}
      <div class="brand">${esc(gh)}</div>
    </div>
    ${regLines ? `<div class="reg">${regLines}</div>` : ''}
  </div>
  <div class="labid">${barcode39(r.labId || r.invoiceNo || '')}<div class="labnum">${esc(r.labId || r.invoiceNo || '')}</div></div>
</div>
<div class="title">Bill Of Supply / Cash Receipt</div>
<div class="subtitle">(PLEASE BRING THIS RECEIPT FOR REPORT COLLECTION)</div>
<div class="grid">${gridCells}</div>
<table><thead><tr>
  <th style="width:34px">S.No.</th><th style="width:90px">${esc(dept.itemCodeHeader)}</th><th>${esc(dept.itemNameHeader)}</th>
  <th style="width:130px">Estimate of report by</th><th style="width:80px">Price</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="totwrap">
  <div class="words">Amount Paid In Words : <b>${amountInWords(paid || net)} Rupee(s) Only</b></div>
  <div class="totals">
    <div class="trow"><span>Order Value</span><span>${inr(orderValue)}</span></div>
    ${home ? `<div class="trow"><span>Home Collection Charges</span><span>${inr(home)}</span></div>` : ''}
    ${disc ? `<div class="trow"><span>Discount</span><span>-${inr(disc)}</span></div>` : ''}
    <div class="trow sub"><span>Total Order Value</span><span>${inr(orderValue + home)}</span></div>
    <div class="trow net"><span>Net Payable Amount</span><span>${inr(net)}</span></div>
    <div class="trow"><span>Paid Amount</span><span>${inr(paid)}</span></div>
    <div class="trow" style="color:${bal > 0 ? '#b91c1c' : '#065f46'}"><span>Balance Amount</span><span>${inr(bal)}</span></div>
  </div>
</div>
${renderPaymentTable(r.payments, { force: true })}
<div class="note">
  This is a computer generated receipt and does not require signature/stamp.<br/>
  <b>*${esc(gh)} is exempt from GST being a health care services provider.</b>
  <div style="margin-top:5px"><b>Note:</b></div>
   "Estimate of report by" is on a best-effort basis and tentative in nature. Delays may occur due to complexity of each case, diagnostic procedures and other unforeseen circumstances.<br/>
  ${dept.newIdNote}<br/>
  ${dept.timingLine}<br/>
  ${esc(dept.reportsDownloadLabel)} can be downloaded from our website${val('website') ? ' (' + esc(val('website')) + ')' : ''} or Mobile App (Android / iOS). Online reports can be downloaded only after complete payment.<br/>
  ${dept.cumulativeNote}<br/>
  By accepting this invoice / transacting with us, I agree/confirm having understood the Terms &amp; Conditions and Privacy Policy of ${esc(gh)}.
  ${val('receiptFooter') ? '<br/><b>' + esc(val('receiptFooter')) + '</b>' : ''}
</div>
<div class="foot">${esc(gh)} — ${esc(dept.footerDept)} &nbsp;|&nbsp; Printed: ${esc(r.dateTime || '')}</div>
</div></body></html>`
  win.document.open(); win.document.write(html); win.document.close(); win.focus()
  setTimeout(() => win.print(), 400)
}

export function printLabReceipt(r, orgInfo = {}, clinic = {}) {
  return printDiagnosticReceipt(r, orgInfo, clinic, LAB_DEPT)
}

export function printRadiologyReceipt(r, orgInfo = {}, clinic = {}) {
  return printDiagnosticReceipt(r, orgInfo, clinic, RADIOLOGY_DEPT)
}

// ── SHARED Indian pharmacy GST retail-invoice receipt ───────────────────────────
// Matches the standard "medical store" bill format: Bill No/Date/Time header,
// Qty/Particulars/GST%/Batch/Expiry/Amount item table, tax-slab breakdown by
// GST rate with CGST+SGST split, MRP Total/Discount/Paid footer. One shared
// renderer so Direct Sale, Prescription Purchase, and the Sales & Reports tab all
// print an IDENTICAL bill — same "one shared function" pattern as the Lab/
// Radiology receipt above.
//   sale = { receiptNumber, saleDate, patientName (or patient:{firstName,lastName}),
//            patientAddress, prescribedBy, paymentMethod, discountAmount, amountPaid,
//            totalAmount, items: [{drugName, gstRate, batchNumber,
//            expiryDate, quantity, unitPrice, total}] }
export function printPharmacyReceipt(sale, orgInfo = {}, clinic = {}) {
  const win = window.open('', '_blank', 'width=880,height=780')
  if (!win) { toast.error('Allow pop-ups to print'); return }

  const items = (typeof sale.items === 'string' ? JSON.parse(sale.items || '[]') : sale.items) || []
  // payments is stored as a JSON string on PharmacySale — normalize to an array
  // so the shared renderPaymentTable() can build the multi-payment ledger.
  const payments = (typeof sale.payments === 'string' ? JSON.parse(sale.payments || '[]') : sale.payments) || []
  const gh = orgInfo.name || clinic.clinicName || 'Hospital'
  const val = (k) => clinic[k] || orgInfo[k] || ''
  const patientName = titleCase(
    sale.patientName || sale.customerName || (sale.patient ? `${sale.patient.firstName || ''} ${sale.patient.lastName || ''}`.trim() : '')
  ) || 'Walk-in'
  const saleDate = sale.saleDate || sale.createdAt || new Date()
  const dateStr = format(new Date(saleDate), 'dd MMM yyyy')
  const timeStr = format(new Date(saleDate), 'hh:mm aa')
  const invoiceNo = sale.receiptNumber || sale.invoiceNumber || '—'

  // Prices are treated as GST-inclusive (the standard for MRP-based pharmacy
  // billing in India) — taxable value and tax are backed OUT of each line's
  // total, not added on top. India only has these 5 GST slabs for goods.
  const SLABS = [5, 12, 18, 28]
  const bySlab = Object.fromEntries(SLABS.map((s) => [s, { taxable: 0, tax: 0 }]))
  let taxFree = 0

  const rows = items.map((it, i) => {
    const total = Number(it.total || 0)
    const gstRate = Number(it.gstRate || 0)
    const expiry = it.expiryDate ? format(new Date(it.expiryDate), 'MM/yy') : ''
    if (gstRate > 0) {
      const slab = SLABS.reduce((closest, s) => (Math.abs(s - gstRate) < Math.abs(closest - gstRate) ? s : closest), SLABS[0])
      const taxable = total / (1 + gstRate / 100)
      bySlab[slab].taxable += taxable
      bySlab[slab].tax += total - taxable
    } else {
      taxFree += total
    }
    return `<tr>
      <td class="sno">${i + 1}</td>
      <td class="qty">${Number(it.quantity || 0)}</td>
      <td><strong>${esc(it.drugName)}</strong></td>
      <td class="gst">${gstRate ? gstRate.toFixed(1) : '—'}</td>
      <td class="batch">${esc(it.batchNumber || '—')}</td>
      <td>${esc(expiry || '—')}</td>
      <td style="text-align:right">${inr(total)}</td>
    </tr>`
  }).join('')

  const cgstTotal = SLABS.reduce((s, slab) => s + bySlab[slab].tax / 2, 0)
  const sgstTotal = cgstTotal // intra-state sale: CGST == SGST
  const mrpTotal = items.reduce((s, it) => s + Number(it.total || 0), 0)
  const discount = Number(sale.discountAmount || 0)
  const paid = Number(sale.amountPaid ?? sale.totalAmount ?? (mrpTotal - discount))
  const netPayable = mrpTotal - discount
  const balance = netPayable - paid
  const fileName = `${(patientName || 'Patient').replace(/\s+/g, '_')}_${invoiceNo}`

  // ── Header address / registration lines (identical build to Lab/Radiology) ──
  const baseAddr = clinic.address || orgInfo.address || ''
  const lower = baseAddr.toLowerCase()
  const addrParts = [baseAddr]
  if (orgInfo.city && !lower.includes(orgInfo.city.toLowerCase())) addrParts.push(orgInfo.city)
  if (orgInfo.region && !lower.includes(orgInfo.region.toLowerCase())) addrParts.push(orgInfo.region)
  const fullAddr = addrParts.filter(Boolean).join(', ')
  const regLines = [
    ['Address', fullAddr],
    ['Phone', orgInfo.phone || clinic.phone],
    ['Email', orgInfo.email],
    ['Website', val('website')],
  ].filter(([, v]) => v && String(v).trim() !== '')
    .map(([k, v]) => `<span class="k">${k}</span><span class="c">:</span><span class="v">${esc(v)}</span>`).join('')

  // ── Patient detail grid (same two-column layout as Lab/Radiology) ──
  const isBlank = v => v === undefined || v === null || String(v).trim() === ''
  const leftFields = [
    ['Invoice Number', invoiceNo],
    ['Date & Time', `${dateStr} ${timeStr}`],
    ['Reference Doctor', sale.referenceDoctor || 'self'],
    ['Mode of Payment', (sale.paymentMethod || 'cash').charAt(0).toUpperCase() + (sale.paymentMethod || 'cash').slice(1)],
  ]
  const rightFields = [
    ['Patient ID / UHID', sale.uhid],
    ['Patient Name', patientName],
    ['Contact Number', sale.phone || sale.contactNumber],
    ['GST No', val('gstNo')],
  ]
  const cellHtml = ([l, v]) => `<div class="cell"><span class="l">${l}</span><span class="v">${esc(isBlank(v) ? 'NA' : v)}</span></div>`
  const rowCount = Math.max(leftFields.length, rightFields.length)
  let gridCells = ''
  for (let i = 0; i < rowCount; i++) {
    gridCells += leftFields[i] ? cellHtml(leftFields[i]) : '<div class="cell"></div>'
    gridCells += rightFields[i] ? cellHtml(rightFields[i]) : '<div class="cell"></div>'
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(fileName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:9pt;color:#1f2937;background:#eef1f5;padding:16px}
.page{max-width:200mm;margin:0 auto;background:#fff;padding:24px 26px 34px;border:1px solid #d7dce3;border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.08)}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a3e6f;padding-bottom:12px;margin-bottom:14px}
.left{max-width:72%}
.namerow{display:flex;align-items:center;gap:12px;margin-bottom:4px}
.brand{font-size:17pt;font-weight:700;color:#1a3e6f;line-height:1.1}
.reg{display:grid;grid-template-columns:auto auto 1fr;column-gap:6px;row-gap:3px;font-size:7.5pt;line-height:1.45;margin-top:4px;max-width:520px}
.reg .k{font-weight:700;color:#334155;white-space:nowrap}
.reg .c{color:#334155}
.reg .v{color:#64748b}
.labid{text-align:right;min-width:200px}
.labnum{font-size:13pt;font-weight:700;letter-spacing:3px;text-align:right;margin-top:3px;color:#111827}
.title{text-align:center;font-weight:700;font-size:12pt;letter-spacing:1px;color:#1a3e6f;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:6px;margin-bottom:2px}
.subtitle{text-align:center;font-size:7.5pt;color:#64748b;letter-spacing:.5px;margin:4px 0 12px}
.grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e2e8f0;border-radius:5px;overflow:hidden;margin-bottom:12px}
.cell{display:flex;padding:5px 12px;border-bottom:1px solid #eef1f4;font-size:8.5pt}
.cell:nth-child(4n+1),.cell:nth-child(4n+2){background:#fafbfc}
.cell:nth-child(odd){border-right:1px solid #eef1f4}
.cell .l{min-width:132px;color:#64748b;font-weight:600}.cell .v{flex:1;font-weight:700;color:#1f2937}
table{width:100%;border-collapse:collapse;margin-bottom:14px;border:1px solid #e2e8f0;border-radius:5px;overflow:hidden}
thead th{background:#f1f5f9;color:#1a3e6f;border-bottom:2px solid #1a3e6f;padding:10px 12px;text-align:left;font-size:9pt;letter-spacing:.3px;text-transform:uppercase;font-weight:700}
thead th:last-child{text-align:right}
tbody td{padding:9px 12px;border-bottom:1px solid #eef1f4;font-size:9.5pt}
tbody tr:nth-child(even){background:#fafbfc}
tbody td:last-child{text-align:right;font-weight:700}
tbody td.sno{text-align:center;color:#94a3b8;font-weight:700}
tbody td.qty{text-align:center}
tbody td.gst{text-align:center}
tbody td.batch{white-space:nowrap;font-size:8.5pt}
thead th:first-child,thead th:nth-child(2),thead th:nth-child(4){text-align:center}
.totwrap{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:16px}
.words{font-size:9pt;color:#475569;padding-bottom:4px}.words b{color:#1f2937}
.totals{width:300px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}
.trow{display:flex;justify-content:space-between;padding:7px 16px;font-size:10pt;color:#475569}
.trow.sub{background:#fafbfc;font-weight:700;color:#1f2937}
.trow.net{background:#eef2f8;color:#1a3e6f;font-weight:800;font-size:11.5pt;border-top:1px solid #cdd7e5;border-bottom:1px solid #cdd7e5}
.note{background:#f9fafb;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;font-size:7.5pt;color:#64748b;line-height:1.7}.note b{color:#334155}
.foot{text-align:center;font-size:7.5pt;color:#94a3b8;margin-top:28px}
.pbtn{position:fixed;top:12px;right:12px;background:#1a3e6f;color:#fff;border:0;padding:8px 16px;border-radius:5px;font-size:10pt;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.2)}
${PAYMENT_TABLE_CSS}
@media print{body{background:#fff;padding:0}.page{box-shadow:none;border:none;border-radius:0}.pbtn{display:none}@page{size:A4;margin:10mm}}
</style></head><body>
<button class="pbtn" onclick="window.print()">Print</button>
<div class="page">
<div class="top">
  <div class="left">
    <div class="namerow">
      ${orgInfo.logoUrl ? `<img src="${esc(orgInfo.logoUrl)}" alt="" style="height:52px;max-width:130px;object-fit:contain"/>` : ''}
      <div class="brand">${esc(gh)}</div>
    </div>
    ${regLines ? `<div class="reg">${regLines}</div>` : ''}
  </div>
  <div class="labid">${barcode39(invoiceNo)}<div class="labnum">${esc(invoiceNo)}</div></div>
</div>
<div class="title">Bill Of Supply / Cash Receipt</div>
<div class="subtitle">(PLEASE BRING THIS RECEIPT FOR NEXT COLLECTION)</div>
<div class="grid">${gridCells}</div>
<table><thead><tr>
  <th style="width:44px">S.No</th><th style="width:46px">Qty</th><th>Particulars</th>
  <th style="width:60px">GST%</th><th style="width:100px">Batch</th><th style="width:64px">Expiry</th><th style="width:100px">Amount</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="totwrap">
  <div class="words">Amount Paid In Words : <b>${amountInWords(paid || netPayable)} Rupee(s) Only</b></div>
  <div class="totals">
    <div class="trow"><span>MRP Total</span><span>${inr(mrpTotal)}</span></div>
    <div class="trow"><span>CGST</span><span>${inr(cgstTotal)}</span></div>
    <div class="trow"><span>SGST</span><span>${inr(sgstTotal)}</span></div>
    ${discount ? `<div class="trow"><span>Discount</span><span>-${inr(discount)}</span></div>` : ''}
    <div class="trow net"><span>Net Payable Amount</span><span>${inr(netPayable)}</span></div>
    <div class="trow"><span>Paid Amount</span><span>${inr(paid)}</span></div>
    <div class="trow" style="color:${balance > 0 ? '#b91c1c' : '#065f46'}"><span>Balance Amount</span><span>${inr(balance)}</span></div>
  </div>
</div>
${renderPaymentTable(payments, { force: true })}
<div class="note">
  This is a computer generated GST invoice and does not require signature/stamp.<br/>
  Prices shown are MRP (GST-inclusive). CGST &amp; SGST are computed as the tax component already contained in the MRP.
  <div style="margin-top:5px"><b>Note:</b></div>
  Please bring this receipt for next collection / refill.<br/>
  ${(clinic.phone || orgInfo.phone) ? 'Call &amp; WhatsApp on ' + esc(clinic.phone || orgInfo.phone) + '.<br/>' : ''}
  By accepting this invoice / transacting with us, I agree/confirm having understood the Terms &amp; Conditions and Privacy Policy of ${esc(gh)}.
  ${val('receiptFooter') ? '<br/><b>' + esc(val('receiptFooter')) + '</b>' : ''}
</div>
<div class="foot">${esc(gh)} — Pharmacy Department &nbsp;|&nbsp; Printed: ${dateStr}, ${timeStr}</div>
</div></body></html>`
  win.document.open(); win.document.write(html); win.document.close(); win.focus()
  setTimeout(() => win.print(), 400)
}
