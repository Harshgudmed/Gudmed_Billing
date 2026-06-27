import { format } from 'date-fns'
import { drName, cToF } from '@/lib/utils'

export function printViaIframe(html) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none'
  document.body.appendChild(iframe)
  iframe.contentDocument.open()
  iframe.contentDocument.write(html)
  iframe.contentDocument.close()
  setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => document.body.removeChild(iframe), 1000) }, 500)
}

export function printPrescription(c, patientName, patientMrn, patientAge, patientGender, doctorName, orgInfo = { name: 'Hospital' }) {
  const visitDate = format(new Date(c.visitDate), 'dd MMMM yyyy HH:mm')
  const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
  const followUp = c.followUpDate ? format(new Date(c.followUpDate), 'dd MMM yyyy') : null
  const rxRows = (c.prescriptions || []).flatMap(rx => {
    try {
      return JSON.parse(rx.items).map(item =>
        `<tr><td>${item.drugName || ''}${item.genericName ? ` <span style="color:#888">(${item.genericName})</span>` : ''}</td><td>${item.dosage || ''}</td><td>${item.frequency || ''}</td><td>${item.duration || ''}</td><td>${item.quantity ?? ''}</td><td>${item.instructions || '—'}</td></tr>`)
    } catch { return [] }
  }).join('')
  const rxBlock = rxRows ? `<div class="section"><div class="section-title">Rx — Medicines</div><table><thead><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Qty</th><th>Instructions</th></tr></thead><tbody>${rxRows}</tbody></table></div>` : ''
  const labs = (c.labOrders || []).flatMap(o => { try { return JSON.parse(o.tests || '[]') } catch { return [] } }).map(t => t.testName || t.testCode).filter(Boolean)
  const rads = (c.radiologyOrders || []).map(o => o.exam?.examName || o.examName).filter(Boolean)
  const tests = [...labs, ...rads]
  const testBlock = tests.length ? `<div class="section"><div class="section-title">Investigations Advised</div><div class="section-body">${tests.map(t => `&#9633; ${t}`).join('&nbsp;&nbsp;&nbsp;')}</div></div>` : ''
  const icd = (() => { try { const a = JSON.parse(c.icd10Codes || '[]'); return Array.isArray(a) ? a.join(', ') : c.icd10Codes } catch { return c.icd10Codes } })()

  const html = `<!DOCTYPE html><html><head><title>OPD Prescription — ${patientMrn}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#000;background:#fff}.page{max-width:210mm;margin:0 auto;padding:12mm 14mm}.hh{display:flex;justify-content:space-between;border-bottom:3px solid #2E4168;padding-bottom:8px;margin-bottom:8px}.hn{font-size:18pt;font-weight:bold;color:#2E4168}.hs{font-size:9pt;color:#555;margin-top:2px}.dr{font-size:8.5pt;color:#555;text-align:right;line-height:1.6}.pt{border:1px solid #333;margin-bottom:10px}.pth{background:#2E4168;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase}.g4{display:grid;grid-template-columns:repeat(4,1fr)}.cell{padding:4px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}.cell:last-child{border-right:none}.lbl{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase}.val{font-size:10pt;margin-top:1px}.vitals{display:flex;flex-wrap:wrap;gap:14px;font-size:9.5pt;border:1px solid #ddd;padding:8px 10px;border-radius:6px;margin-bottom:10px}.vitals b{color:#2E4168}.section{margin-bottom:10px}.section-title{font-weight:bold;font-size:10pt;color:#2E4168;border-bottom:1.5px solid #2E4168;padding-bottom:2px;margin-bottom:5px;text-transform:uppercase}.section-body{font-size:10.5pt;line-height:1.7}.dx{border:2px solid #2E4168;padding:10px;background:#ecfeff;margin-bottom:10px}.dxt{font-weight:bold;font-size:10.5pt;color:#2E4168;text-transform:uppercase}.dxb{font-size:11.5pt;font-weight:600;margin-top:3px}.rxsym{font-size:22pt;font-weight:bold;color:#2E4168}.fu{border-left:4px solid #10b981;background:#f0fdf4;padding:7px 10px;margin-bottom:10px}table{width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:8px}th{background:#2E4168;color:#fff;padding:5px 8px;text-align:left;font-size:9pt}td{padding:5px 8px;border-bottom:1px solid #e8e8e8}tr:nth-child(even) td{background:#f9f9f9}.sig{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:22px;padding-top:10px}.sl{border-top:1px solid #000;padding-top:4px}.slb{font-size:9pt;color:#444;line-height:1.6}.ft{margin-top:12px;border-top:1px solid #ccc;padding-top:4px;font-size:8pt;color:#888;text-align:center}@media print{.page{padding:8mm}}</style></head><body>
<div class="page">
<div class="hh"><div><div class="hn">${orgInfo.name}</div><div class="hs">OPD — Outpatient Prescription</div></div><div class="dr">Date: <strong>${visitDate}</strong><br/>Attending: <strong>${drName(doctorName)}</strong><br/>Printed: ${printDate}</div></div>
<div class="pt"><div class="pth">Patient</div><div class="g4">
<div class="cell"><div class="lbl">Name</div><div class="val"><strong>${patientName}</strong></div></div>
<div class="cell"><div class="lbl">UHID</div><div class="val">${patientMrn}</div></div>
<div class="cell"><div class="lbl">Age / Sex</div><div class="val">${patientAge} yrs / ${patientGender}</div></div>
<div class="cell"><div class="lbl">Visit</div><div class="val">Outpatient</div></div>
</div></div>
${(c.temperature || c.pulseRate || c.bloodPressureSystolic || c.oxygenSaturation || c.weight) ? `<div class="vitals">
${c.temperature ? `<span>Temp <b>${cToF(c.temperature)}°F</b></span>` : ''}
${c.bloodPressureSystolic ? `<span>BP <b>${c.bloodPressureSystolic}/${c.bloodPressureDiastolic || '—'}</b> mmHg</span>` : ''}
${c.pulseRate ? `<span>Pulse <b>${c.pulseRate}</b> bpm</span>` : ''}
${c.oxygenSaturation ? `<span>SpO₂ <b>${c.oxygenSaturation}%</b></span>` : ''}
${c.weight ? `<span>Weight <b>${c.weight}</b> kg</span>` : ''}
</div>` : ''}
${c.chiefComplaint ? `<div class="section"><div class="section-title">Complaint</div><div class="section-body">${c.chiefComplaint}</div></div>` : ''}
<div class="dx"><div class="dxt">Diagnosis</div><div class="dxb">${c.diagnosis || '—'}</div></div>
${rxRows ? `<div class="rxsym">℞</div>` : ''}${rxBlock}${testBlock}
${c.notes ? `<div class="section"><div class="section-title">Advice</div><div class="section-body">${c.notes}</div></div>` : ''}
${followUp ? `<div class="fu"><strong>Follow-up:</strong> ${followUp}</div>` : ''}
<div class="sig"><div></div><div class="sl"><div class="slb"><strong>${drName(doctorName)}</strong><br/>Signature & Stamp</div></div></div>
<div class="ft">${orgInfo.name} — OPD &nbsp;|&nbsp; Confidential Medical Record &nbsp;|&nbsp; Printed: ${printDate}</div>
</div></body></html>`
  printViaIframe(html)
}
