import { format } from 'date-fns'
import { toast } from 'sonner'

export const printLabReport = (order, results, orgInfo, drName) => {
  const win = window.open('', '_blank', 'width=900,height=780')
  if (!win) { toast.error('Please allow pop-ups to print'); return }
  
  const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
  // We need to handle case where orderDate might be undefined (from older schemas)
  const orderDateObj = order.orderDate ? new Date(order.orderDate) : (order.createdAt ? new Date(order.createdAt) : new Date())
  const orderDate = format(orderDateObj, 'dd MMM yyyy HH:mm')
  const collectedDate = order.sampleCollectedAt ? format(new Date(order.sampleCollectedAt), 'dd MMM yyyy HH:mm') : '—'
  const orderResults = results.filter(r => r.orderId === order.id)
  const hasResults = orderResults.length > 0
  const hasAbnormal = orderResults.some(r => r.isAbnormal || r.isCritical)

  const resultRows = hasResults
    ? orderResults.map(r => {
        const refRange = r.referenceRangeText || (r.referenceRangeMin !== null && r.referenceRangeMax !== null ? `${r.referenceRangeMin} – ${r.referenceRangeMax}` : '—')
        const rowClass = r.isCritical ? 'result-critical' : r.isAbnormal ? 'result-abnormal' : ''
        const flagStyle = r.flag === 'H' ? 'color:#b45309;font-weight:bold' : r.flag === 'L' ? 'color:#1d4ed8;font-weight:bold' : r.isCritical ? 'color:#dc2626;font-weight:bold' : ''
        const valStyle = r.isAbnormal || r.isCritical ? 'font-weight:bold;color:' + (r.isCritical ? '#dc2626' : '#b45309') : 'font-weight:bold'
        return `<tr class="${rowClass}">
          <td>${r.testName || '—'}</td>
          <td style="${valStyle}">${r.resultValue ?? '—'}</td>
          <td>${r.resultUnit || '—'}</td>
          <td>${refRange}</td>
          <td style="${flagStyle}">${r.isCritical ? '⚠ CRITICAL' : r.flag || 'N'}</td>
          <td>${r.status === 'verified' ? '✓ Verified' : r.status === 'final' ? '✓ Final' : 'Reported'}</td>
        </tr>`
      }).join('')
    : (order.tests || []).map(t => `<tr>
          <td>${t.testName}</td>
          <td colspan="4" style="color:#888;font-style:italic">Result pending</td>
          <td>—</td>
        </tr>`).join('')

  const verifiedResults = orderResults.filter(r => r.verifiedBy)
  const verifiedBy = verifiedResults.length > 0 ? verifiedResults[0].verifiedBy : null
  const verifiedAt = verifiedResults.length > 0 && verifiedResults[0].verifiedAt ? format(new Date(verifiedResults[0].verifiedAt), 'dd MMM yyyy HH:mm') : null
  const enteredBy = orderResults.length > 0 ? orderResults[0].enteredBy : null

  const html = `<!DOCTYPE html><html><head><title>Laboratory Report — ${order.orderNumber}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;background:#fff}
.page{max-width:210mm;margin:0 auto;padding:12mm 14mm 10mm 14mm}
.hosp-header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:10px}
.hosp-name{font-size:19pt;font-weight:bold;color:#1e3a5f;line-height:1}
.hosp-sub{font-size:9pt;color:#555;margin-top:2px}
.hosp-contact{font-size:8.5pt;color:#555;text-align:right;line-height:1.6}
.report-banner{background:#1e3a5f;color:#fff;text-align:center;padding:5px 0;font-size:13pt;font-weight:bold;letter-spacing:3px;margin-bottom:10px}
.info-box{border:1px solid #333;margin-bottom:10px}
.info-box-hdr{background:#1e3a5f;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;letter-spacing:1px;text-transform:uppercase}
.info-box-hdr2{background:#4a7099;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr)}
.info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-label{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase;letter-spacing:0.3px}
.info-value{font-size:10pt;margin-top:1px}
.clinical-bar{padding:7px 12px;background:#f0f4f8;border-left:4px solid #1e3a5f;margin-bottom:10px;font-size:10pt}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:9.5pt}
thead th{background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left;font-size:9pt;font-weight:600}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8;vertical-align:middle}
tr:nth-child(even) td{background:#f9f9f9}
.result-abnormal td{background:#fffbeb!important}
.result-critical td{background:#fef2f2!important}
.abnormal-legend{font-size:8.5pt;color:#666;padding:5px 8px;background:#f8f9fa;border:1px solid #e0e0e0;margin-bottom:10px;border-radius:3px}
.critical-note{background:#fef2f2;border:1px solid #dc2626;padding:8px 12px;margin-bottom:10px;font-size:9.5pt;color:#991b1b;border-radius:3px}
.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:16px;padding-top:10px;border-top:2px solid #000}
.sig-line{border-bottom:1px solid #000;height:40px;margin-bottom:5px}
.sig-label{font-size:9pt;color:#444;line-height:1.6}
.footer{margin-top:12px;border-top:1px solid #ccc;padding-top:5px;font-size:8pt;color:#888;text-align:center}
@media print{body{padding:0}.page{padding:8mm}}
</style></head><body>
<div class="page">
  <div class="hosp-header">
    <div>
      ${orgInfo.logoUrl ? `<img src="${orgInfo.logoUrl}" alt="" style="height:46px;max-width:170px;object-fit:contain;margin-bottom:4px"/>` : ''}
      <div class="hosp-name">${orgInfo.name}</div>
      <div class="hosp-sub">Laboratory &amp; Pathology Department</div>
      <div class="hosp-sub">Accredited Clinical Laboratory Services</div>
    </div>
    <div class="hosp-contact">
      Order #: <strong>${order.orderNumber}</strong><br/>
      ${order.accessionNumber ? `Accession #: <strong>${order.accessionNumber}</strong><br/>` : ''}
      Printed: ${printDate}
    </div>
  </div>

  <div class="report-banner">LABORATORY REPORT</div>

  <div class="info-box">
    <div class="info-box-hdr">Patient Information</div>
    <div class="info-grid">
     <div class="info-cell"><div class="info-label">UHID</div><div class="info-value">${order.patientMrn}</div></div>
    
      <div class="info-cell"><div class="info-label">Patient Name</div><div class="info-value"><strong>${order.patientName}</strong></div></div>
       <div class="info-cell"><div class="info-label">Age / Sex</div><div class="info-value">${order.patientAge} yrs / ${order.patientGender ? order.patientGender.charAt(0).toUpperCase() + order.patientGender.slice(1) : ''}</div></div>
      <div class="info-cell"><div class="info-label">Requesting Physician</div><div class="info-value">${order.requestingDoctor ? drName(order.requestingDoctor) : '—'}</div></div>
    </div>
    <div class="info-box-hdr2">Order Details</div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">Order Date</div><div class="info-value">${orderDate}</div></div>
      <div class="info-cell"><div class="info-label">Collection Date</div><div class="info-value">${collectedDate}</div></div>
      <div class="info-cell"><div class="info-label">Priority</div><div class="info-value" style="text-transform:uppercase;color:${order.priority==='stat'?'#dc2626':order.priority==='urgent'?'#d97706':'#333'};font-weight:bold">${order.priority || 'routine'}</div></div>
      <div class="info-cell"><div class="info-label">Report Status</div><div class="info-value" style="color:#065f46;font-weight:bold">COMPLETED</div></div>
    </div>
  </div>

  ${order.clinicalIndication ? `<div class="clinical-bar"><strong>Clinical Indication:</strong> ${order.clinicalIndication}</div>` : ''}
  ${order.provisionalDiagnosis ? `<div class="clinical-bar"><strong>Provisional Diagnosis:</strong> ${order.provisionalDiagnosis}</div>` : ''}

  ${hasAbnormal ? `<div class="critical-note">⚠ This report contains abnormal/critical values. Please review highlighted results and contact the laboratory for clarification if needed.</div>` : ''}

  <table>
    <thead>
      <tr>
        <th style="width:28%">TEST NAME</th>
        <th style="width:13%">RESULT</th>
        <th style="width:10%">UNIT</th>
        <th style="width:22%">REFERENCE RANGE</th>
        <th style="width:12%">FLAG</th>
        <th style="width:15%">STATUS</th>
      </tr>
    </thead>
    <tbody>${resultRows}</tbody>
  </table>

  ${hasAbnormal ? `<div class="abnormal-legend"><strong>Flag Legend:</strong> &nbsp; H = High &nbsp; L = Low &nbsp; N = Normal &nbsp; A = Abnormal &nbsp; ⚠ CRITICAL = Requires immediate attention</div>` : ''}

  ${order.notes ? `<div class="clinical-bar" style="margin-bottom:10px"><strong>Notes:</strong> ${order.notes}</div>` : ''}

  <div class="sig-section">
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">
        <strong>Reported By:</strong> ${enteredBy || 'Lab Technologist'}<br/>
        Report Date: ${printDate}
      </div>
    </div>
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">
        <strong>Verified By:</strong> ${verifiedBy || '—'}<br/>
        ${verifiedAt ? `Verification Date: ${verifiedAt}` : 'Not yet verified'}
      </div>
    </div>
  </div>

  <div class="footer">
    ${orgInfo.name} — Laboratory &amp; Pathology Department &nbsp;|&nbsp;
    This report is confidential and intended solely for the requesting physician &nbsp;|&nbsp;
    Printed: ${printDate}
  </div>
</div>
</body></html>`
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 600)
}
