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
import { formatMoney as inr } from '@/lib/format'

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
    const isRefund = !!p.isRefund
    const statusTag = isRefund && p.status && p.status !== 'APPROVED'
      ? ` <span style="color:#b45309">(${p.status === 'PENDING_APPROVAL' ? 'Pending' : p.status === 'REJECTED' ? 'Rejected' : p.status})</span>`
      : ''
    return `<tr>
      <td class="sno">${i + 1}</td>
      <td>${esc(rcpt)}</td>
      <td>${esc(dateStr)}</td>
      <td>${esc(inv)}</td>
      <td style="text-align:right${isRefund ? ';color:#dc2626' : ''}">${isRefund ? '-' : ''}${inr(amt)}</td>
      <td>${esc(String(mode).charAt(0).toUpperCase() + String(mode).slice(1))}${isRefund ? ` <span style="color:#dc2626;font-weight:700">(Refund)</span>` : ''}${statusTag}</td>
    </tr>`
  }).join('')

  // Only an APPROVED refund actually reduces the money collected; a pending/rejected
  // refund request has not moved any cash yet, so it must not shrink the printed total.
  const totalPaid = list.reduce((s, p) => {
    const amt = Number(p.amount || 0)
    if (p.isRefund) return p.status === 'APPROVED' ? s - amt : s
    return s + amt
  }, 0)
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

export function printInvoice(bill, orgInfo, clinic, options = {}) {
  const formatOpt = options.format || 'invoice'
  const win = window.open('', '_blank', 'width=900,height=780')
  if (!win) { toast.error('Allow pop-ups to print'); return }
  
  const itemRows = (bill.items || []).map((it, i) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:8.5pt">${i + 1}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;color:#0b5cab;font-weight:bold">${esc(it.code || it.name.substring(0,4).toUpperCase())}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:8.5pt"><strong>${esc(it.name)}</strong>${it.sub ? `<br/><span style="font-size:8pt;color:#888">${esc(it.sub)}</span>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:8.5pt">${esc(bill.date)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-size:8.5pt;font-weight:bold">${inr(it.qty * it.amt)}</td>
    </tr>`).join('')
  
  const calcSubtotal = bill.subtotal || (bill.items || []).reduce((a, i) => a + i.qty * i.amt, 0)

  let paymentList = [...(bill.payments || [])].sort((a, b) => new Date(b.paymentDate || b.date || new Date()) - new Date(a.paymentDate || a.date || new Date()))
  if (paymentList.length === 0 && Number(bill.amountPaid || 0) > 0) {
    paymentList = [{
      receiptNo: bill.invoiceNo,
      date: bill.date,
      invoiceNo: bill.invoiceNo,
      amount: bill.amountPaid,
      mode: bill.mode || 'cash'
    }]
  }

  const mrn = bill.uhid || 'NA'
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${bill.invoiceNo}</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;background:#f3f4f6;padding:20px}
.page{max-width:200mm;margin:0 auto;background:#fff;padding:22px;box-shadow:0 1px 8px rgba(0,0,0,.1)}
.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.brand-box { display:flex; align-items:center; gap: 12px; }
.brand{font-size:16pt;font-weight:bold;color:#1a3e6f}
.reg{font-size:7.5pt;color:#333;line-height:1.6;margin-top:4px}.reg b{display:inline-block;min-width:70px}
.labnum{font-size:13pt;font-weight:bold;letter-spacing:3px;text-align:right;margin-top:2px}
.title{text-align:center;font-weight:bold;font-size:12pt;margin:8px 0 1px;background:#f0f4f8;padding:8px;border:1px solid #d0e0f0;border-radius:4px;color:#1a3e6f;}
.subtitle{text-align:center;font-size:8pt;color:#666;margin-bottom:8px}
.grid{border:1px solid #d0e0f0;background:#f8fafc;display:grid;grid-template-columns:1fr 1fr;margin-bottom:12px;border-radius:4px;overflow:hidden;}
.cell{display:flex;padding:6px 12px;border-bottom:1px solid #d0e0f0;font-size:8.5pt}.cell:nth-child(odd){border-right:1px solid #d0e0f0}.cell .l{color:#666;min-width:130px}.cell .v{flex:1;font-weight:bold;color:#1a3e6f}
table{width:100%;border-collapse:collapse;margin-bottom:6px;border:1px solid #d0e0f0}
thead th{background:#eef2f7;border-bottom:1px solid #d0e0f0;padding:8px;text-align:left;font-size:8.5pt;color:#1a3e6f;text-transform:uppercase}thead th:last-child{text-align:right}
tbody td{padding:6px 8px;border-bottom:1px solid #eee;font-size:8.5pt}
.totwrap{display:flex;justify-content:space-between;margin-bottom:10px;margin-top:10px}.totals{width:280px;border:1px solid #d0e0f0;border-radius:4px;overflow:hidden;}
.trow{display:flex;justify-content:space-between;padding:6px 12px;font-size:9pt;color:#555}.trow.b{font-weight:bold;border-top:1px solid #d0e0f0;background:#f8fafc;color:#1a3e6f}.trow.net{font-weight:bold;font-size:10.5pt;color:#1a3e6f;padding:8px 12px;background:#eef2f7}
.note{border:1px solid #eee;background:#fdfdfd;padding:10px;font-size:7.5pt;color:#666;line-height:1.6;margin-top:6px;border-radius:4px;}
.foot{text-align:center;font-size:7.5pt;color:#888;margin-top:12px}
${PAYMENT_TABLE_CSS}
@media print{body{padding:0;background:#fff}.page{box-shadow:none}}</style></head><body><div class="page">
<div class="top">
  <div class="brand-box">
    ${orgInfo.logoUrl ? `<img src="${orgInfo.logoUrl}" alt="" style="height:46px;object-fit:contain"/>` : ''}
    <div>
      <div class="brand">${esc(orgInfo.name || clinic.clinicName)}</div>
      <div class="reg">
        <div><b>Address</b> ${esc(clinic.address || '')}</div>
        <div><b>Phone</b> ${esc(clinic.phone || '')}</div>
        ${clinic.email ? `<div><b>Email</b> ${esc(clinic.email)}</div>` : ''}
      </div>
    </div>
  </div>
  <div>
    <svg xmlns="http://www.w3.org/2000/svg" width="220" height="44" viewBox="0 0 336.00 44" preserveAspectRatio="none" fill="#000" style="display:block;margin-left:auto;max-width:250px;height:44px"><rect x="0.00" y="0" width="1.50" height="44"/><rect x="6.00" y="0" width="1.50" height="44"/><rect x="9.00" y="0" width="4.50" height="44"/><rect x="15.00" y="0" width="4.50" height="44"/><rect x="21.00" y="0" width="1.50" height="44"/><rect x="24.00" y="0" width="4.50" height="44"/><rect x="30.00" y="0" width="1.50" height="44"/><rect x="33.00" y="0" width="1.50" height="44"/><rect x="39.00" y="0" width="1.50" height="44"/><rect x="42.00" y="0" width="4.50" height="44"/><rect x="48.00" y="0" width="4.50" height="44"/><rect x="54.00" y="0" width="4.50" height="44"/><rect x="60.00" y="0" width="1.50" height="44"/><rect x="66.00" y="0" width="1.50" height="44"/><rect x="69.00" y="0" width="1.50" height="44"/><rect x="72.00" y="0" width="4.50" height="44"/><rect x="78.00" y="0" width="4.50" height="44"/><rect x="84.00" y="0" width="1.50" height="44"/><rect x="90.00" y="0" width="1.50" height="44"/><rect x="93.00" y="0" width="1.50" height="44"/><rect x="96.00" y="0" width="1.50" height="44"/><rect x="102.00" y="0" width="1.50" height="44"/><rect x="105.00" y="0" width="1.50" height="44"/><rect x="108.00" y="0" width="4.50" height="44"/><rect x="114.00" y="0" width="4.50" height="44"/><rect x="120.00" y="0" width="1.50" height="44"/><rect x="123.00" y="0" width="1.50" height="44"/><rect x="126.00" y="0" width="4.50" height="44"/><rect x="135.00" y="0" width="1.50" height="44"/><rect x="138.00" y="0" width="4.50" height="44"/><rect x="144.00" y="0" width="4.50" height="44"/><rect x="150.00" y="0" width="1.50" height="44"/><rect x="153.00" y="0" width="4.50" height="44"/><rect x="162.00" y="0" width="1.50" height="44"/><rect x="165.00" y="0" width="1.50" height="44"/><rect x="168.00" y="0" width="4.50" height="44"/><rect x="174.00" y="0" width="4.50" height="44"/><rect x="180.00" y="0" width="1.50" height="44"/><rect x="183.00" y="0" width="1.50" height="44"/><rect x="189.00" y="0" width="1.50" height="44"/><rect x="192.00" y="0" width="4.50" height="44"/><rect x="198.00" y="0" width="1.50" height="44"/><rect x="201.00" y="0" width="4.50" height="44"/><rect x="207.00" y="0" width="1.50" height="44"/><rect x="213.00" y="0" width="1.50" height="44"/><rect x="216.00" y="0" width="1.50" height="44"/><rect x="222.00" y="0" width="1.50" height="44"/><rect x="225.00" y="0" width="1.50" height="44"/><rect x="228.00" y="0" width="4.50" height="44"/><rect x="234.00" y="0" width="4.50" height="44"/><rect x="240.00" y="0" width="4.50" height="44"/><rect x="246.00" y="0" width="1.50" height="44"/><rect x="249.00" y="0" width="1.50" height="44"/><rect x="255.00" y="0" width="4.50" height="44"/><rect x="261.00" y="0" width="1.50" height="44"/><rect x="264.00" y="0" width="1.50" height="44"/><rect x="267.00" y="0" width="4.50" height="44"/><rect x="273.00" y="0" width="1.50" height="44"/><rect x="276.00" y="0" width="1.50" height="44"/><rect x="282.00" y="0" width="4.50" height="44"/><rect x="288.00" y="0" width="1.50" height="44"/><rect x="291.00" y="0" width="1.50" height="44"/><rect x="297.00" y="0" width="1.50" height="44"/><rect x="300.00" y="0" width="4.50" height="44"/><rect x="306.00" y="0" width="4.50" height="44"/><rect x="312.00" y="0" width="1.50" height="44"/><rect x="318.00" y="0" width="1.50" height="44"/><rect x="321.00" y="0" width="4.50" height="44"/><rect x="327.00" y="0" width="4.50" height="44"/><rect x="333.00" y="0" width="1.50" height="44"/></svg>
    <div class="labnum">${esc(mrn)}</div>
  </div>
</div>
<div class="title">Bill Of Supply / Cash Receipt</div>
<div class="subtitle">(PLEASE BRING THIS RECEIPT FOR REPORT COLLECTION)</div>
<div class="grid">
<div class="cell"><span class="l">Invoice Number</span><span class="v">${esc(bill.invoiceNo)}</span></div><div class="cell"><span class="l">Patient ID / UHID</span><span class="v">${esc(mrn)}</span></div>
<div class="cell"><span class="l">Lab ID</span><span class="v">${esc(mrn)}</span></div><div class="cell"><span class="l">Patient Name</span><span class="v">${esc(bill.patientName)}</span></div>
<div class="cell"><span class="l">Date &amp; Time</span><span class="v">${esc(bill.date)}</span></div><div class="cell"><span class="l">Contact Number</span><span class="v">${esc(bill.phone || 'NA')}</span></div>
<div class="cell"><span class="l">Reference Doctor</span><span class="v">${esc(bill.doctorName || 'self')}</span></div><div class="cell"><span class="l">GST No</span><span class="v">${esc(clinic.gstNo || 'NA')}</span></div>
<div class="cell"><span class="l">Mode of Payment</span><span class="v">${esc(bill.mode || 'Cash')}</span></div><div class="cell"><span class="l"></span><span class="v"></span></div>
</div>
<table><thead><tr><th style="width:34px">S.NO.</th><th style="width:110px">TEST CODE</th><th>TEST NAME</th><th style="width:130px">ESTIMATE OF REPORT BY</th><th style="width:80px;text-align:right">PRICE</th></tr></thead>
<tbody>${itemRows}</tbody></table>
<div class="totwrap">
  ${formatOpt === 'invoice' ? `
  <div>
    <div style="font-size:8.5pt;padding-top:4px;margin-bottom:8px">Amount Paid In Words : <b>${esc(amountInWords(Number(bill.amountPaid || 0)))} Only</b></div>
    <div style="font-size:9.5pt">Payment Mode : <b>${esc(bill.mode || 'Cash')}</b></div>
    <div style="font-size:9.5pt;margin-top:4px">Status : <b>${bill.balanceDue <= 0 ? 'Paid' : 'Unpaid'}</b></div>
  </div>
  ` : `
  <div style="font-size:8.5pt;padding-top:4px">Amount Paid In Words : <b>${esc(amountInWords(Number(bill.amountPaid || 0)))} Only</b></div>
  `}
<div class="totals">
<div class="trow"><span>Order Value</span><span>${inr(calcSubtotal)}</span></div>
<div class="trow b"><span>Total Order Value</span><span>${inr(calcSubtotal)}</span></div>
<div class="trow net"><span>Net Payable Amount</span><span>${inr(bill.total)}</span></div>
<div class="trow"><span>Paid Amount</span><span>${inr(bill.amountPaid)}</span></div>
${formatOpt === 'detailed' ? `<div class="trow" style="color:#b91c1c"><span>Balance Amount</span><span>${inr(bill.balanceDue)}</span></div>` : ''}
</div></div>
${formatOpt === 'detailed' ? renderPaymentTable(paymentList, { force: true }) : ''}
<div class="note">This is a computer generated receipt and does not require signature/stamp.<br/>
<b>*${esc(orgInfo.name || clinic.clinicName)} is exempt from GST being a health care services provider.</b><br/>
For detailed Terms &amp; Conditions, please visit: <b><a href="https://www.gudmed.in/terms-conditions" target="_blank" style="color:inherit;text-decoration:none">www.gudmed.in/terms-conditions</a></b>
</div>
<div class="foot">Printed: ${format(new Date(), 'dd-MM-yyyy HH:mm:ss')}</div>
</div></body></html>`
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 500)
}

export function printReceipt(p, orgInfo, clinic) {
  const win = window.open('', '_blank', 'width=900,height=780')
  if (!win) { toast.error('Allow pop-ups to print'); return }

  const patientName = p.invoice?.patientName || (p.invoice?.patient ? `${p.invoice.patient.firstName} ${p.invoice.patient.lastName}` : (p.patient ? `${p.patient.firstName} ${p.patient.lastName}` : 'Patient'))
  const mrn     = p.invoice?.uhid || p.invoice?.patient?.mrn || p.patient?.mrn || ''
  const rxDate  = p.paymentDate ? format(new Date(p.paymentDate), 'dd MMM yyyy, hh:mm aa') : format(new Date(), 'dd MMM yyyy, hh:mm aa')
  const invNo   = p.invoice?.invoiceNo || p.invoice?.invoiceNumber || '—'

  // Calculate historical state at the time of this specific payment
  const receiptDate = new Date(p.paymentDate || p.date || new Date());
  const allPayments = p.invoice?.payments || [];
  const sortedPayments = [...allPayments].sort((a, b) => new Date(a.paymentDate || a.date) - new Date(b.paymentDate || b.date));
  
  // Include payments made ON OR BEFORE this receipt
  const historicalPayments = sortedPayments.filter(hist => new Date(hist.paymentDate || hist.date) <= receiptDate);
  
  // Only an APPROVED refund actually reduces the paid amount. A refund that is
  // still PENDING_APPROVAL (or REJECTED) is just a request — the money hasn't left,
  // so it must NOT lower "Total Paid" (that was the bug where a pending ₹100 refund
  // showed Paid ₹400 while the invoice still held ₹500).
  let historicalAmountPaid = 0;
  historicalPayments.forEach(hist => {
    if (hist.isRefund) {
      if (hist.status === 'APPROVED') historicalAmountPaid -= hist.amount;
    } else {
      historicalAmountPaid += hist.amount;
    }
  });

  const totalInvoiceValue = p.invoice?.total || p.invoice?.totalAmount || 0;
  const historicalBalanceDue = totalInvoiceValue - historicalAmountPaid;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${p.receiptNumber}</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;background:#f3f4f6;padding:20px}
.page{max-width:200mm;margin:0 auto;background:#fff;padding:22px;box-shadow:0 1px 8px rgba(0,0,0,.1)}
.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.brand-box { display:flex; align-items:center; gap: 12px; }
.brand{font-size:16pt;font-weight:bold;color:#1a3e6f}
.reg{font-size:7.5pt;color:#333;line-height:1.6;margin-top:4px}.reg b{display:inline-block;min-width:70px}
.labnum{font-size:13pt;font-weight:bold;letter-spacing:3px;text-align:right;margin-top:2px}
.title{text-align:center;font-weight:bold;font-size:12pt;margin:8px 0 1px;background:#f0f4f8;padding:8px;border:1px solid #d0e0f0;border-radius:4px;color:#1a3e6f;text-transform:uppercase}
.grid{border:1px solid #d0e0f0;background:#f8fafc;display:grid;grid-template-columns:1fr 1fr;margin-bottom:12px;border-radius:4px;overflow:hidden;}
.cell{display:flex;padding:6px 12px;border-bottom:1px solid #d0e0f0;font-size:8.5pt}.cell:nth-child(odd){border-right:1px solid #d0e0f0}.cell .l{color:#666;min-width:130px}.cell .v{flex:1;font-weight:bold;color:#1a3e6f}
.totwrap{display:flex;justify-content:space-between;margin-bottom:10px}.totals{width:320px;border:1px solid #d0e0f0;border-radius:4px;overflow:hidden;}
.trow{display:flex;justify-content:space-between;padding:8px 12px;font-size:9pt;color:#555}.trow.b{font-weight:bold;border-top:1px solid #d0e0f0;background:#f8fafc;color:#1a3e6f}.trow.net{font-weight:bold;font-size:11pt;color:#065f46;padding:12px;background:#ecfdf5}
.note{border:1px solid #eee;background:#fdfdfd;padding:10px;font-size:7.5pt;color:#666;line-height:1.6;margin-top:6px;border-radius:4px;}
.foot{text-align:center;font-size:7.5pt;color:#888;margin-top:12px}
@media print{body{padding:0;background:#fff}.page{box-shadow:none}}</style></head><body><div class="page">
<div class="top">
  <div class="brand-box">
    ${orgInfo.logoUrl ? `<img src="${orgInfo.logoUrl}" alt="" style="height:46px;object-fit:contain"/>` : ''}
    <div>
      <div class="brand">${esc(orgInfo.name || clinic.clinicName)}</div>
      <div class="reg">
        <div><b>Address</b> ${esc(clinic.address || '')}</div>
        <div><b>Phone</b> ${esc(clinic.phone || '')}</div>
        ${clinic.email ? `<div><b>Email</b> ${esc(clinic.email)}</div>` : ''}
      </div>
    </div>
  </div>
  <div>
    <svg xmlns="http://www.w3.org/2000/svg" width="220" height="44" viewBox="0 0 336.00 44" preserveAspectRatio="none" fill="#000" style="display:block;margin-left:auto;max-width:250px;height:44px"><rect x="0.00" y="0" width="1.50" height="44"/><rect x="6.00" y="0" width="1.50" height="44"/><rect x="9.00" y="0" width="4.50" height="44"/><rect x="15.00" y="0" width="4.50" height="44"/><rect x="21.00" y="0" width="1.50" height="44"/><rect x="24.00" y="0" width="4.50" height="44"/><rect x="30.00" y="0" width="1.50" height="44"/><rect x="33.00" y="0" width="1.50" height="44"/><rect x="39.00" y="0" width="1.50" height="44"/><rect x="42.00" y="0" width="4.50" height="44"/><rect x="48.00" y="0" width="4.50" height="44"/><rect x="54.00" y="0" width="4.50" height="44"/><rect x="60.00" y="0" width="1.50" height="44"/><rect x="66.00" y="0" width="1.50" height="44"/><rect x="69.00" y="0" width="1.50" height="44"/><rect x="72.00" y="0" width="4.50" height="44"/><rect x="78.00" y="0" width="4.50" height="44"/><rect x="84.00" y="0" width="1.50" height="44"/><rect x="90.00" y="0" width="1.50" height="44"/><rect x="93.00" y="0" width="1.50" height="44"/><rect x="96.00" y="0" width="1.50" height="44"/><rect x="102.00" y="0" width="1.50" height="44"/><rect x="105.00" y="0" width="1.50" height="44"/><rect x="108.00" y="0" width="4.50" height="44"/><rect x="114.00" y="0" width="4.50" height="44"/><rect x="120.00" y="0" width="1.50" height="44"/><rect x="123.00" y="0" width="1.50" height="44"/><rect x="126.00" y="0" width="4.50" height="44"/><rect x="135.00" y="0" width="1.50" height="44"/><rect x="138.00" y="0" width="4.50" height="44"/><rect x="144.00" y="0" width="4.50" height="44"/><rect x="150.00" y="0" width="1.50" height="44"/><rect x="153.00" y="0" width="4.50" height="44"/><rect x="162.00" y="0" width="1.50" height="44"/><rect x="165.00" y="0" width="1.50" height="44"/><rect x="168.00" y="0" width="4.50" height="44"/><rect x="174.00" y="0" width="4.50" height="44"/><rect x="180.00" y="0" width="1.50" height="44"/><rect x="183.00" y="0" width="1.50" height="44"/><rect x="189.00" y="0" width="1.50" height="44"/><rect x="192.00" y="0" width="4.50" height="44"/><rect x="198.00" y="0" width="1.50" height="44"/><rect x="201.00" y="0" width="4.50" height="44"/><rect x="207.00" y="0" width="1.50" height="44"/><rect x="213.00" y="0" width="1.50" height="44"/><rect x="216.00" y="0" width="1.50" height="44"/><rect x="222.00" y="0" width="1.50" height="44"/><rect x="225.00" y="0" width="1.50" height="44"/><rect x="228.00" y="0" width="4.50" height="44"/><rect x="234.00" y="0" width="4.50" height="44"/><rect x="240.00" y="0" width="4.50" height="44"/><rect x="246.00" y="0" width="1.50" height="44"/><rect x="249.00" y="0" width="1.50" height="44"/><rect x="255.00" y="0" width="4.50" height="44"/><rect x="261.00" y="0" width="1.50" height="44"/><rect x="264.00" y="0" width="1.50" height="44"/><rect x="267.00" y="0" width="4.50" height="44"/><rect x="273.00" y="0" width="1.50" height="44"/><rect x="276.00" y="0" width="1.50" height="44"/><rect x="282.00" y="0" width="4.50" height="44"/><rect x="288.00" y="0" width="1.50" height="44"/><rect x="291.00" y="0" width="1.50" height="44"/><rect x="297.00" y="0" width="1.50" height="44"/><rect x="300.00" y="0" width="4.50" height="44"/><rect x="306.00" y="0" width="4.50" height="44"/><rect x="312.00" y="0" width="1.50" height="44"/><rect x="318.00" y="0" width="1.50" height="44"/><rect x="321.00" y="0" width="4.50" height="44"/><rect x="327.00" y="0" width="4.50" height="44"/><rect x="333.00" y="0" width="1.50" height="44"/></svg>
    <div class="labnum">${esc(mrn || p.receiptNumber)}</div>
  </div>
</div>
<div class="title">PAYMENT RECEIPT</div>
<div class="grid">
<div class="cell"><span class="l">Receipt No</span><span class="v">${esc(p.receiptNumber)}</span></div><div class="cell"><span class="l">Invoice No</span><span class="v">${esc(invNo)}</span></div>
<div class="cell"><span class="l">Patient ID / UHID</span><span class="v">${esc(mrn)}</span></div><div class="cell"><span class="l">Patient Name</span><span class="v">${esc(patientName)}</span></div>
<div class="cell"><span class="l">Date &amp; Time</span><span class="v">${esc(rxDate)}</span></div><div class="cell"><span class="l">Mode of Payment</span><span class="v">${esc(p.paymentMethod || 'Cash')}</span></div>
</div>

<div class="totwrap"><div style="font-size:8.5pt;padding-top:4px">Amount In Words : <b>${esc(amountInWords(Number(p.amount || 0)))} Only</b></div>
<div class="totals">
<div class="trow net" style="${p.isRefund ? 'color:#b91c1c;background:#fef2f2' : ''}"><span>${p.isRefund ? 'Amount Refunded' : 'Amount Paid'}</span><span>${inr(p.amount)}</span></div>
</div></div>
${p.invoice ? `
<div style="margin-top:20px;border:1px solid #d0e0f0;border-radius:4px;overflow:hidden;background:#fff">
  <div style="background:#f0f4f8;padding:8px 12px;font-weight:bold;color:#1a3e6f;border-bottom:1px solid #d0e0f0;font-size:9.5pt">Invoice Summary & Payment History</div>
  <div style="padding:16px;display:flex;gap:30px">
    <div style="flex:1">
      <div style="font-size:7.5pt;color:#888;margin-bottom:8px;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px">Bill Status (As of ${format(receiptDate, 'dd MMM')})</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:9pt"><span style="color:#555">Order Value:</span><b>${inr(totalInvoiceValue)}</b></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:9pt"><span style="color:#555">Total Paid:</span><b style="color:#065f46">${inr(historicalAmountPaid)}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:9.5pt;color:#b91c1c;margin-top:8px;padding-top:8px;border-top:1px dashed #d0e0f0"><span>Balance Due:</span><b>${inr(historicalBalanceDue)}</b></div>
    </div>
    <div style="flex:2;border-left:1px solid #eee;padding-left:30px">
      <div style="font-size:7.5pt;color:#888;margin-bottom:8px;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px">Payments up to this receipt</div>
      ${historicalPayments.length > 0 ? `
      <table style="width:100%;border-collapse:collapse;font-size:8pt">
        <tr style="border-bottom:1px solid #eee;color:#555">
          <th style="text-align:left;padding-bottom:6px;font-weight:bold">Date</th>
          <th style="text-align:left;padding-bottom:6px;font-weight:bold">Receipt No</th>
          <th style="text-align:left;padding-bottom:6px;font-weight:bold">Mode</th>
          <th style="text-align:right;padding-bottom:6px;font-weight:bold">Amount</th>
        </tr>
        ${historicalPayments.slice(0, 5).map(hist => `
          <tr style="border-bottom:1px dashed #eee;${hist.receiptNumber === p.receiptNumber ? 'background:#f0f7ff' : ''}">
            <td style="padding:6px 0;color:#555">${format(new Date(hist.paymentDate || hist.date || new Date()), 'dd MMM yyyy')}</td>
            <td style="padding:6px 0;font-family:monospace;color:#333">${hist.receiptNumber === p.receiptNumber ? '<b>' + (hist.receiptNumber || hist.receiptNo) + '</b> (This)' : (hist.receiptNumber || hist.receiptNo || '—')}</td>
            <td style="padding:6px 0;color:#555">${hist.paymentMethod || hist.method || hist.payMode || 'Cash'}${hist.isRefund && hist.status && hist.status !== 'APPROVED' ? ` <span style="color:#b45309;font-size:7pt">(${hist.status === 'PENDING_APPROVAL' ? 'Pending' : hist.status})</span>` : ''}</td>
            <td style="padding:6px 0;text-align:right;font-weight:bold;${hist.isRefund ? 'color:#b91c1c' : 'color:#065f46'}">${hist.isRefund ? '-' : ''}${inr(hist.amount)}</td>
          </tr>
        `).join('')}
        ${historicalPayments.length > 5 ? `<tr><td colspan="4" style="padding-top:6px;font-size:7.5pt;color:#888;text-align:center">...and ${historicalPayments.length - 5} more</td></tr>` : ''}
      </table>
      ` : '<div style="font-size:8pt;color:#888;padding-top:4px">No previous payment history available.</div>'}
    </div>
  </div>
</div>
` : ''}
<div class="note">This is a computer generated receipt and does not require signature/stamp.<br/>
<b>*${esc(orgInfo.name || clinic.clinicName)} is exempt from GST being a health care services provider.</b><br/>
For detailed Terms &amp; Conditions, please visit: <b><a href="https://www.gudmed.in/terms-conditions" target="_blank" style="color:inherit;text-decoration:none">www.gudmed.in/terms-conditions</a></b>
</div>
<div class="foot">Printed: ${format(new Date(), 'dd-MM-yyyy HH:mm:ss')}</div>
</div></body></html>`
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 500)
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

function printDiagnosticReceipt(r, orgInfo = {}, clinic = {}, dept = LAB_DEPT, options = {}) {
  const formatOpt = options.format || 'invoice'
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

  let paymentList = r.payments || [];
  if (paymentList.length === 0 && paid > 0) {
    paymentList = [{
      receiptNo: r.invoiceNo || r.labId,
      date: r.dateTime,
      invoiceNo: r.invoiceNo || r.labId,
      amount: paid,
      mode: r.mode || 'cash'
    }];
  }

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
  ${formatOpt === 'invoice' ? `
  <div class="words">
    <div style="margin-bottom:8px">Amount Paid In Words : <b>${amountInWords(paid || net)} Rupee(s) Only</b></div>
    <div style="font-size:9.5pt">Payment Mode : <b>${esc(paymentList[paymentList.length - 1]?.method || paymentList[0]?.method || 'Cash')}</b></div>
    <div style="font-size:9.5pt;margin-top:4px">Status : <b>${bal <= 0 ? 'Paid' : 'Unpaid'}</b></div>
  </div>
  ` : `
  <div class="words">Amount Paid In Words : <b>${amountInWords(paid || net)} Rupee(s) Only</b></div>
  `}
  <div class="totals">
    <div class="trow"><span>Order Value</span><span>${inr(orderValue)}</span></div>
    ${home ? `<div class="trow"><span>Home Collection Charges</span><span>${inr(home)}</span></div>` : ''}
    ${disc ? `<div class="trow"><span>Discount</span><span>-${inr(disc)}</span></div>` : ''}
    <div class="trow sub"><span>Total Order Value</span><span>${inr(orderValue + home)}</span></div>
    <div class="trow net"><span>Net Payable Amount</span><span>${inr(net)}</span></div>
    <div class="trow"><span>Paid Amount</span><span>${inr(paid)}</span></div>
    ${formatOpt === 'detailed' ? `<div class="trow" style="color:${bal > 0 ? '#b91c1c' : '#065f46'}"><span>Balance Amount</span><span>${inr(bal)}</span></div>` : ''}
  </div>
</div>
${formatOpt === 'detailed' ? renderPaymentTable(paymentList, { force: true }) : ''}
<div class="note">
  This is a computer generated receipt and does not require signature/stamp.<br/>
  <b>*${esc(gh)} is exempt from GST being a health care services provider.</b>
  <div style="margin-top:5px"><b>Note:</b></div>
  Reports can be downloaded from our website${val('website') ? ' (' + esc(val('website')) + ')' : ''}. Online reports available only after complete payment.<br/>
  For detailed Terms &amp; Conditions, please visit: <b><a href="https://www.gudmed.in/terms-conditions" target="_blank" style="color:inherit;text-decoration:none">www.gudmed.in/terms-conditions</a></b>
  ${val('receiptFooter') ? '<br/><b>' + esc(val('receiptFooter')) + '</b>' : ''}
</div>
<div class="foot">${esc(gh)} — ${esc(dept.footerDept)} &nbsp;|&nbsp; Printed: ${esc(r.dateTime || '')}</div>
</div></body></html>`
  win.document.open(); win.document.write(html); win.document.close(); win.focus()
  setTimeout(() => win.print(), 400)
}

export function printLabReceipt(r, orgInfo = {}, clinic = {}, options = {}) {
  return printDiagnosticReceipt(r, orgInfo, clinic, LAB_DEPT, options)
}

export function printRadiologyReceipt(r, orgInfo = {}, clinic = {}, options = {}) {
  return printDiagnosticReceipt(r, orgInfo, clinic, RADIOLOGY_DEPT, options)
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
export function printPharmacyReceipt(sale, orgInfo = {}, clinic = {}, options = {}) {
  const formatOpt = options.format || 'invoice'
  const win = window.open('', '_blank', 'width=880,height=780')
  if (!win) { toast.error('Allow pop-ups to print'); return }

  const items = (typeof sale.items === 'string' ? JSON.parse(sale.items || '[]') : sale.items) || []
  // payments is stored as a JSON string on PharmacySale — normalize to an array
  // so the shared renderPaymentTable() can build the multi-payment ledger.
  let payments = (typeof sale.payments === 'string' ? JSON.parse(sale.payments || '[]') : sale.payments) || []
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

  if (payments.length === 0 && paid > 0) {
    payments = [{
      receiptNo: invoiceNo,
      date: saleDate,
      invoiceNo: invoiceNo,
      amount: paid,
      mode: sale.paymentMethod || 'cash'
    }]
  }

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
  ${formatOpt === 'invoice' ? `
  <div class="words">
    <div style="margin-bottom:8px">Amount Paid In Words : <b>${amountInWords(paid || netPayable)} Rupee(s) Only</b></div>
    <div style="font-size:9.5pt">Payment Mode : <b>${esc(sale?.paymentMethod || 'Cash')}</b></div>
    <div style="font-size:9.5pt;margin-top:4px">Status : <b>${balance <= 0 ? 'Paid' : 'Unpaid'}</b></div>
  </div>
  ` : `
  <div class="words">Amount Paid In Words : <b>${amountInWords(paid || netPayable)} Rupee(s) Only</b></div>
  `}
  <div class="totals">
    <div class="trow"><span>MRP Total</span><span>${inr(mrpTotal)}</span></div>
    <div class="trow"><span>CGST</span><span>${inr(cgstTotal)}</span></div>
    <div class="trow"><span>SGST</span><span>${inr(sgstTotal)}</span></div>
    ${discount ? `<div class="trow"><span>Discount</span><span>-${inr(discount)}</span></div>` : ''}
    <div class="trow net"><span>Net Payable Amount</span><span>${inr(netPayable)}</span></div>
    <div class="trow"><span>Paid Amount</span><span>${inr(paid)}</span></div>
    ${formatOpt === 'detailed' ? `<div class="trow" style="color:${balance > 0 ? '#b91c1c' : '#065f46'}"><span>Balance Amount</span><span>${inr(balance)}</span></div>` : ''}
  </div>
</div>
${formatOpt === 'detailed' ? renderPaymentTable(payments, { force: true }) : ''}
<div class="note">
  This is a computer generated GST invoice and does not require signature/stamp. Prices shown are MRP (GST-inclusive).<br/>
  <div style="margin-top:5px"><b>Note:</b> Please bring this receipt for next collection / refill. ${(clinic.phone || orgInfo.phone) ? 'Call &amp; WhatsApp on ' + esc(clinic.phone || orgInfo.phone) + '.' : ''}</div>
  For detailed Terms &amp; Conditions, please visit: <b><a href="https://www.gudmed.in/terms-conditions" target="_blank" style="color:inherit;text-decoration:none">www.gudmed.in/terms-conditions</a></b>
  ${val('receiptFooter') ? '<br/><b>' + esc(val('receiptFooter')) + '</b>' : ''}
</div>
<div class="foot">${esc(gh)} — Pharmacy Department &nbsp;|&nbsp; Printed: ${dateStr}, ${timeStr}</div>
</div></body></html>`
  win.document.open(); win.document.write(html); win.document.close(); win.focus()
  setTimeout(() => win.print(), 400)
}
