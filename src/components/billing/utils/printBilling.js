import { format } from 'date-fns'
import { toast } from 'sonner'

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
@media print{body{padding:10px}}</style></head><body>
<div class="header">
  <div>
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
<div class="banner">INVOICE</div>
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
  <div class="total-row total-final"><span>TOTAL DUE</span><span>₹${Number(bill.total).toLocaleString('en-IN')}</span></div>
</div></div>
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
  <div class="amt-label">Amount Paid</div>
  <div class="amt-value">₹${Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
</div>

<!-- Payment Method -->
<div style="text-align:center; margin: 6px 0;">
  <span class="method-badge">${p.paymentMethod}</span>
</div>

<hr class="divider"/>

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
