// Shared pure helpers + constants for the Inpatient module.
// Used by InpatientModule and its extracted tab components so neither has to
// re-declare them or drill them through props.

export function admissionLabel(a) {
  if (!a?.id) return '—'
  return `ADM-${a.id.slice(-8).toUpperCase()}`
}

export function getAdmissionWardId(a) {
  return a?.bed?.wardId || a?.bed?.ward?.id || null
}

export function getWardName(wards, a) {
  const wid = getAdmissionWardId(a)
  return wards.find((w) => w.id === wid)?.name || a?.bed?.ward?.name || '—'
}

export const WARD_TYPES = ['General','Private','Semi-Private','ICU','NICU','PICU','CCU','HDU','Burn Unit','OT / Operation Theatre','Recovery / Post-Op','Dialysis','Pediatric','Maternity','Emergency','Isolation']
export const BED_TYPES = ['Standard','ICU','Ventilator','Burn Care','OT Table','Isolation','Bariatric']
export const ADMISSION_TYPES = ['Emergency','Elective','Transfer']
export const DISCHARGE_CONDITIONS = ['Improved','Recovered','Unchanged','Worsened','Deceased','Transferred']
export const NOTE_TYPES = ['Nursing admission assessment', 'Shift handover note', 'Other notes']

export const emptyWard = { name:'', code:'', type:'General', capacity:10, building:'', floor:'', departmentId:'', chargeNurse:'', phone:'' }
export const emptyAdmission = { patientId:'', wardId:'', bedId:'', departmentId:'', doctorId:'', admissionType:'Emergency', admissionDiagnosis:'', chiefComplaint:'', expectedLengthOfStay:3, depositAmount:0, admissionNotes:'', isCritical:false, criticalLevel:'none' }
export const emptyDischarge = { dischargeDiagnosis:'', treatmentSummary:'', medicationsOnDischarge:'', followUpInstructions:'', dischargeCondition:'Improved', followUpDate:'', dischargeNotes:'' }
export const emptyNote = { type:'Nursing', text:'', bp:'', temp:'', pulse:'', spo2:'', weight:'' }
export const emptyAddBed = { wardId:'', bedNumber:'', type:'Standard' }
