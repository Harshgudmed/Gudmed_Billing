// Print templates for the Inpatient module — extracted from InpatientModule so the
// component stays focused on UI/state. Pure-ish: each function takes the admission
// plus a small context ({ orgInfo, wardName, admissionNo }) computed by the caller,
// so this file has no dependency on component state (wards / local helpers).
import { format, differenceInDays } from 'date-fns'
import { drName } from '@/lib/utils'
import { toast } from 'sonner'
import { getFullName } from '@/lib/patient';

// Print small documents via a hidden iframe (avoids popup blockers).
function printViaIframe(html) {
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

// Admission slip — adm = admission record; ctx = { orgInfo, wardName, admissionNo }.
export function printAdmissionSlip(adm, { orgInfo, wardName, admissionNo }) {
  const admDate = adm.admissionDate ? format(new Date(adm.admissionDate), 'dd MMM yyyy, hh:mm a') : '—'
  printViaIframe(`<!DOCTYPE html><html><head><title>Admission Slip</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px;color:#222}h2{text-align:center;margin-bottom:4px;font-size:18px}.sub{text-align:center;color:#666;font-size:11px;margin-bottom:16px}table{width:100%;border-collapse:collapse;margin-bottom:12px}td{padding:5px 8px;border:1px solid #ddd}td:first-child{background:#f5f5f5;font-weight:600;width:38%}.diag{background:#fffbe6;border:1px solid #ffe58f;padding:8px 10px;border-radius:4px;margin:8px 0}.footer{text-align:center;font-size:10px;color:#aaa;margin-top:20px}@media print{body{padding:10px}}</style>
</head><body>
<h2>Admission Slip</h2>
<div class="sub">${orgInfo.name} &nbsp;·&nbsp; Generated ${format(new Date(),'dd MMM yyyy, hh:mm a')}</div>
<table>
<tr><td>Patient Name</td><td>${getFullName(adm.patient)}</td></tr>
<tr><td>UHID</td><td>${adm.patient?.mrn||'—'}</td></tr>
<tr><td>Admission #</td><td>${admissionNo}</td></tr>
<tr><td>Admission Date</td><td>${admDate}</td></tr>
<tr><td>Ward</td><td>${wardName}</td></tr>
<tr><td>Bed Number</td><td>${adm.bed?.bedNumber||'—'}</td></tr>
<tr><td>Admission Type</td><td>${adm.admissionType||'—'}</td></tr>
<tr><td>Expected Stay</td><td>${adm.expectedLengthOfStay||'—'} day(s)</td></tr>
<tr><td>Deposit Paid</td><td>₹${(adm.depositAmount||0).toLocaleString()}</td></tr>
${adm.isCritical?`<tr><td>Status</td><td style="color:${adm.criticalLevel === 'blue' ? 'blue' : 'orange'};font-weight:bold">CRITICAL (${adm.criticalLevel ? adm.criticalLevel.toUpperCase() : 'CODE'})</td></tr>`:''}
</table>
<div class="diag"><strong>Admission Diagnosis:</strong><br/>${adm.admissionDiagnosis||'—'}</div>
${adm.chiefComplaint?`<div class="diag"><strong>Chief Complaint:</strong><br/>${adm.chiefComplaint}</div>`:''}
${adm.admissionNotes?`<div class="diag"><strong>Notes:</strong><br/>${adm.admissionNotes}</div>`:''}
<div class="footer">This is a computer-generated admission slip.</div>
</body></html>`)
}

// Discharge summary — opens a printable window; ctx = { orgInfo, wardName, admissionNo }.
export function printDischargeSummary(adm, { orgInfo, wardName, admissionNo }) {
  const admDate = adm.admissionDate ? format(new Date(adm.admissionDate), 'dd MMM yyyy') : 'N/A'
  const disDate = adm.dischargeDate ? format(new Date(adm.dischargeDate), 'dd MMM yyyy') : 'N/A'
  const days = adm.admissionDate && adm.dischargeDate ? differenceInDays(new Date(adm.dischargeDate), new Date(adm.admissionDate)) : adm.admissionDate ? differenceInDays(new Date(), new Date(adm.admissionDate)) : 0
  const patAge = adm.patient?.dateOfBirth ? Math.floor(differenceInDays(new Date(), new Date(adm.patient.dateOfBirth)) / 365) + ' yrs' : '—'
  const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
  const orgAddr = [orgInfo.address, orgInfo.city].filter(Boolean).join(', ')

  const win = window.open('', '_blank', 'width=900,height=780')
  if (!win) { toast.error('Please allow pop-ups to print'); return }

  win.document.write(`<!DOCTYPE html><html>
<head><title>Discharge Summary — ${getFullName(adm.patient)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#222;background:#f0f0f0;padding:20px}
.page{max-width:860px;margin:0 auto;background:#fff;padding:30px;box-shadow:0 2px 12px rgba(0,0,0,0.15)}
.header{border-bottom:3px solid #1e3a8a;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start}
.hosp-name{font-size:22px;font-weight:bold;color:#1e3a8a}
.hosp-sub{font-size:11px;color:#666;margin-top:3px}
.meta{font-size:11px;color:#666;text-align:right;line-height:1.7}
.title-bar{text-align:center;margin:0 0 20px}
.title-bar h1{font-size:18px;font-weight:700;letter-spacing:3px;color:#1e3a8a;border:2px solid #1e3a8a;display:inline-block;padding:6px 30px}
.section-title{font-size:11px;font-weight:700;color:#1e3a8a;text-transform:uppercase;letter-spacing:1px;border-bottom:1.5px solid #1e3a8a;padding-bottom:3px;margin:16px 0 8px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px}
.field{margin-bottom:6px}
.field-label{font-size:10px;color:#888;text-transform:uppercase;font-weight:600;letter-spacing:0.5px}
.field-value{font-size:13px;color:#111;font-weight:500;margin-top:1px}
.field-value.placeholder{color:#bbb;font-style:italic}
.text-block{border:1px solid #e5e7eb;border-radius:4px;padding:10px 12px;min-height:50px;font-size:12px;line-height:1.6;white-space:pre-wrap;color:#333;background:#fafafa}
.text-block.empty{color:#ccc;font-style:italic}
.lines{margin-top:4px}
.line{border-bottom:1px solid #e5e7eb;height:22px;margin-bottom:4px}
.sig-row{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px;padding-top:16px;border-top:2px solid #333}
.sig-line{border-bottom:1px solid #555;height:40px;margin-bottom:6px}
.sig-label{font-size:10px;color:#666;text-align:center}
.print-btn{display:block;margin:20px auto 0;background:#1e3a8a;color:#fff;border:none;padding:10px 30px;font-size:14px;font-weight:600;border-radius:6px;cursor:pointer}
.footer{text-align:center;font-size:10px;color:#aaa;margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb}
@media print{body{background:#fff;padding:0}.page{box-shadow:none;padding:15px}.print-btn{display:none}}
</style></head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="hosp-name">${orgInfo.name || '123 Hospital'}</div>
      <div class="hosp-sub">Inpatient Department${orgAddr ? ' | ' + orgAddr : ''}${orgInfo.phone ? ' | ' + orgInfo.phone : ''}</div>
    </div>
    <div class="meta">
      Printed: ${printDate}<br/>
      Admission #: <strong>${admissionNo}</strong>
    </div>
  </div>

  <div class="title-bar"><h1>DISCHARGE SUMMARY</h1></div>

  <div class="section-title">Patient Information</div>
  <div class="grid2">
    <div class="field"><div class="field-label">Patient Name</div><div class="field-value">${getFullName(adm.patient)}</div></div>
    <div class="field"><div class="field-label">UHID</div><div class="field-value">${adm.patient?.mrn || '—'}</div></div>
    <div class="field"><div class="field-label">Age / Gender</div><div class="field-value">${patAge} / ${adm.patient?.gender || '—'}</div></div>
    <div class="field"><div class="field-label">Phone</div><div class="field-value">${adm.patient?.phonePrimary || '—'}</div></div>
  </div>

  <div class="section-title">Admission Details</div>
  <div class="grid2">
    <div class="field"><div class="field-label">Admission Date</div><div class="field-value">${admDate}</div></div>
    <div class="field"><div class="field-label">Discharge Date</div><div class="field-value">${disDate}</div></div>
    <div class="field"><div class="field-label">Ward / Bed</div><div class="field-value">${wardName} — Bed ${adm.bed?.bedNumber || '—'}</div></div>
    <div class="field"><div class="field-label">Admission Type</div><div class="field-value">${adm.admissionType || '—'}</div></div>
    <div class="field"><div class="field-label">Length of Stay</div><div class="field-value">${days} days</div></div>
    <div class="field"><div class="field-label">Attending Doctor</div><div class="field-value">${drName(adm.attendingDoctorName) || adm.attendingDoctor || '—'}</div></div>
  </div>

  <div class="section-title">Diagnosis</div>
  <div class="field" style="margin-bottom:8px"><div class="field-label">Admission Diagnosis</div><div class="field-value">${adm.admissionDiagnosis || '—'}</div></div>
  <div class="field"><div class="field-label">Discharge Diagnosis</div><div class="field-value ${!adm.dischargeDiagnosis ? 'placeholder' : ''}">${adm.dischargeDiagnosis || 'Not recorded'}</div></div>

  <div class="section-title">Clinical Summary / Treatment Provided</div>
  ${adm.treatmentSummary
    ? `<div class="text-block">${adm.treatmentSummary}</div>`
    : `<div class="text-block empty">Not recorded</div><div class="lines"><div class="line"></div><div class="line"></div></div>`}

  <div class="section-title">Medications on Discharge</div>
  ${adm.medicationsOnDischarge
    ? `<div class="text-block">${adm.medicationsOnDischarge}</div>`
    : `<div class="text-block empty">Not recorded</div><div class="lines"><div class="line"></div><div class="line"></div></div>`}

  <div class="section-title">Discharge Instructions / Follow-Up</div>
  ${adm.followUpInstructions
    ? `<div class="text-block">${adm.followUpInstructions}</div>`
    : `<div class="text-block empty">Not recorded</div><div class="lines"><div class="line"></div></div>`}
  <div class="field" style="margin-top:8px">
    <div class="field-label">Follow-up Date</div>
    <div class="field-value ${!adm.followUpDate ? 'placeholder' : ''}">${adm.followUpDate ? format(new Date(adm.followUpDate), 'dd MMM yyyy') : 'Not scheduled'}</div>
  </div>

  ${adm.dischargeNotes ? `<div class="section-title">Additional Notes</div><div class="text-block">${adm.dischargeNotes}</div>` : ''}

  <div class="sig-row">
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">Attending Physician Signature</div>
    </div>
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">Authorized Hospital Signatory &amp; Stamp</div>
    </div>
  </div>

  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  <div class="footer">This is a computer-generated document. &nbsp;|&nbsp; ${orgInfo.name} &nbsp;|&nbsp; Generated: ${printDate}</div>
</div>
</body></html>`)
  win.document.close()
}
