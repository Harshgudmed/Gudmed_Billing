import { format } from 'date-fns';
import { toast } from 'sonner';
import { getFullName, calculateAge } from './patientUtils';

export const printOpdPrescription = (patient, orgInfo) => {
  const name = getFullName(patient);
  const age = patient.dateOfBirth ? `${calculateAge(patient.dateOfBirth)} Yrs` : '0 Yrs';
  const gender = patient.gender ? patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1) : '—';
  const printedAt = format(new Date(), 'dd/MM/yyyy HH:mm');
  const dateStr = format(new Date(), 'dd / MM / yyyy');
  const orgAddr = [orgInfo.address, orgInfo.city].filter(Boolean).join(', ');
  
  const win = window.open('', '_blank', 'width=800,height=1050');
  if (!win) { 
    toast.error('Please allow pop-ups to print'); 
    return; 
  }
  
  win.document.write(`<!DOCTYPE html><html>
<head><title>Prescription — ${patient.mrn}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;background:#fff;padding:0}
.page{max-width:210mm;margin:0 auto;padding:10mm 12mm 8mm;min-height:297mm;position:relative}
.meta-top{display:flex;justify-content:space-between;font-size:8pt;color:#555;margin-bottom:6px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px}
.hosp-name{font-size:22pt;font-weight:bold;color:#1e3a8a;line-height:1}
.hosp-sub{font-size:9pt;color:#555;margin-top:2px}
.rx-logo{text-align:right}
.rx-big{font-size:36pt;font-weight:bold;font-style:italic;color:#1e3a8a;line-height:1;font-family:Georgia,serif}
.rx-label{font-size:8pt;font-weight:bold;color:#1e3a8a;letter-spacing:1px}
.blue-line{border-bottom:3px solid #1e3a8a;margin:6px 0 8px}
.dr-line{border-bottom:1px solid #333;display:inline-block;width:140px;margin-left:2px}
.opd-no{text-align:right}
.opd-no .opd-label{font-size:8pt;font-weight:bold;color:#1e3a8a}
.opd-no .opd-val{font-size:11pt;font-weight:bold;color:#1e3a8a}
.date-row{text-align:right;font-size:9pt;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #ccc}
.date-val{font-weight:bold;font-size:10pt;color:#c00}
.patient-box{border:1px solid #333;margin-bottom:6px}
.pt-header{display:grid;grid-template-columns:2fr 1.5fr 1.5fr 1fr;border-bottom:1px solid #333}
.pt-cell{padding:4px 6px;border-right:1px solid #333;font-size:8.5pt}
.pt-cell:last-child{border-right:none}
.pt-label{font-size:7.5pt;font-weight:bold;background:#1e3a8a;color:#fff;padding:1px 4px;margin-bottom:2px;display:block}
.pt-val{font-weight:600;font-size:10pt}
.vitals-row{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid #333}
.vt-cell{padding:3px 4px;border-right:1px solid #333;text-align:center;font-size:7.5pt}
.vt-cell:last-child{border-right:none}
.vt-lbl{font-weight:bold;color:#c00}
.vt-val{border-bottom:1px dotted #aaa;min-height:14px;margin-top:1px}
.section-title{font-size:8.5pt;font-weight:bold;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.5px;margin:6px 0 2px;border-bottom:1px solid #1e3a8a;padding-bottom:1px}
.blank-line{border-bottom:1px solid #ccc;height:18px;margin-bottom:2px}
.rx-symbol{font-size:28pt;font-weight:bold;font-style:italic;color:#1e3a8a;font-family:Georgia,serif;line-height:1;margin-bottom:2px}
.rx-table{width:100%;border-collapse:collapse;margin-bottom:4px}
.rx-table th{font-size:8pt;font-weight:bold;color:#555;text-align:left;padding:2px 4px;border-bottom:1px solid #333}
.rx-table td{padding:2px 4px;border-bottom:1px dotted #ddd;height:22px;font-size:9pt}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:6px}
.follow-box{border:1.5px solid #f59e0b;border-radius:4px;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;background:#fffbeb;margin-bottom:8px}
.follow-label{font-size:8.5pt;font-weight:bold;color:#d97706}
.follow-line{border-bottom:1px solid #aaa;display:inline-block;width:200px;margin-left:4px}
.surgical{font-size:8.5pt;font-weight:bold;color:#d97706}
.sig-section{margin-top:12px;text-align:right}
.sig-line{border-bottom:1px solid #000;width:200px;display:inline-block;margin-bottom:3px}
.sig-label{font-size:8.5pt;color:#333}
.sig-dr{font-size:8pt;color:#555;border-top:1px dotted #aaa;width:200px;padding-top:2px;margin-top:2px}
.page-footer{position:absolute;bottom:8mm;left:12mm;right:12mm;border-top:1px solid #ccc;padding-top:4px;display:flex;justify-content:space-between;font-size:7.5pt;color:#777}
.print-btn{display:block;margin:16px auto 0;background:#1e3a8a;color:#fff;border:none;padding:9px 28px;font-size:13px;font-weight:600;border-radius:6px;cursor:pointer}
@media print{.print-btn{display:none}body{padding:0}.page{padding:8mm}}
</style></head>
<body>
<div class="page">
  <div class="meta-top">
    <span>${printedAt}</span>
    <span style="font-weight:bold;color:#1e3a8a">Prescription — ${patient.mrn}</span>
  </div>

  <div class="header">
    <div>
      <div class="hosp-name">${orgInfo.name || '123 Hospital'}</div>
      <div class="hosp-sub">OPD Prescription</div>
      <div class="hosp-sub" style="font-size:8pt;margin-top:2px">${orgAddr || ''}</div>
      <div class="hosp-sub" style="font-size:8pt">Tel: ${orgInfo.phone || '—'} | Email: ${orgInfo.email || '—'}</div>
    </div>
    <div class="rx-logo">
      <div class="rx-big">R<span style="font-size:18pt">x</span></div>
      <div class="rx-label">OPD PRESCRIPTION</div>
    </div>
  </div>
  <div class="blue-line"></div>

  <div style="display:grid;grid-template-columns:1fr auto;gap:16px;margin-bottom:4px">
    <div>
      <div style="font-size:9pt;margin-bottom:3px">Dr. <span class="dr-line" style="width:160px"></span> &nbsp;&nbsp; Department: <span class="dr-line" style="width:100px"></span></div>
      <div style="font-size:9pt">Qualification: <span class="dr-line" style="width:130px"></span> &nbsp;&nbsp; Reg. No: <span class="dr-line" style="width:100px"></span></div>
    </div>
    <div class="opd-no">
      <div class="opd-label">OPD NO.</div>
      <div class="opd-val">${patient.mrn}</div>
    </div>
  </div>

  <div class="date-row">Date: &nbsp;<span class="date-val">${dateStr}</span></div>

  <div class="patient-box">
    <div class="pt-header">
      <div class="pt-cell"><span class="pt-label">PATIENT NAME</span><span class="pt-val">${name}</span></div>
      <div class="pt-cell"><span class="pt-label">AGE / GENDER</span><span class="pt-val">${age} / ${gender}</span></div>
      <div class="pt-cell"><span class="pt-label">PHONE</span><span class="pt-val">${patient.phonePrimary || '—'}</span></div>
      <div class="pt-cell"><span class="pt-label">BLOOD GROUP</span><span class="pt-val" style="color:#c00">${patient.bloodGroup || '—'}</span></div>
    </div>
    <div class="vitals-row">
      <div class="vt-cell"><div class="vt-lbl">BP (MMHG)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">PULSE (BPM)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl" style="color:#c00">TEMP (°F)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">RR (/MIN)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">SPO₂ (%)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">WT (KG)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">HT (CM)</div><div class="vt-val"></div></div>
    </div>
  </div>

  <div class="section-title">Diagnosis / Chief Complaint</div>
  <div class="blank-line"></div>
  <div class="blank-line"></div>

  <div style="margin:6px 0 2px">
    <div class="rx-symbol">R<span style="font-size:16pt">x</span></div>
    <table class="rx-table">
      <thead><tr><th style="width:24px">#</th><th>Medicine Name &amp; Strength</th><th>Dose / Frequency / Route</th><th>Duration</th></tr></thead>
      <tbody>
        ${[1,2,3,4,5,6,7].map(n => `<tr><td>${n}.</td><td></td><td></td><td></td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="two-col">
    <div>
      <div class="section-title">Advice / Instructions</div>
      <div class="blank-line"></div>
      <div class="blank-line"></div>
    </div>
    <div>
      <div class="section-title">Investigations / Tests Ordered</div>
      <div class="blank-line"></div>
      <div class="blank-line"></div>
    </div>
  </div>

  <div class="follow-box">
    <div><span class="follow-label">Follow-up Date:</span> <span class="follow-line"></span></div>
    <div class="surgical">Surgical Opinion Needed: &nbsp; YES &nbsp;/&nbsp; NO</div>
  </div>

  <div class="sig-section">
    <div class="sig-line"></div><br/>
    <div class="sig-label">Doctor Signature &amp; Stamp</div>
    <div class="sig-dr">Dr. ___________________________</div>
  </div>

  <div class="page-footer">
    <span>Patient: <strong>${name}</strong> | UHID: <strong style="color:#1e3a8a">${patient.mrn}</strong> | ${age} / ${gender}</span>
    <span>Printed: ${printedAt} &nbsp;|&nbsp; ${orgInfo.name || '123 Hospital'} — OPD Prescription</span>
  </div>
  <div style="text-align:center;font-size:7pt;color:#aaa;margin-top:8px">This prescription is valid for 30 days from the date of issue. Keep this slip for reference.</div>

  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</div>
</body></html>`);
  win.document.close();
};
