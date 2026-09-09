// Fill the four case documents for the seeded OT cases, so a demo shows a whole
// case record rather than four empty tabs.
//
// Written to match how each case actually went: a completed case has an
// operative note and closed counts, a case still in theatre has a Time Out but
// no Sign Out yet, and a cancelled case has a pre-op assessment that says why it
// was called off. A demo where every case is fully documented is one nobody
// believes.
//
// Run:  node seed-ot-clinical.js
import { db } from './src/config/db.js'

// Written per procedure. Generic filler ("Diagnosis: yes") reads as filler.
const PREOP = {
  'Appendicectomy': { diagnosis: 'Acute appendicitis', indication: 'Right iliac fossa pain 18 h, raised WBC, USG confirms', asaGrade: 'IE', comorbidities: 'Nil' },
  'Laparoscopic Cholecystectomy': { diagnosis: 'Symptomatic cholelithiasis', indication: 'Recurrent biliary colic, failed medical management', asaGrade: 'II', comorbidities: 'Type 2 diabetes' },
  'Caesarean Section (LSCS)': { diagnosis: 'Previous LSCS, term pregnancy', indication: 'Elective repeat caesarean at 39 weeks', asaGrade: 'II', comorbidities: 'Gestational anaemia' },
  'Total Knee Replacement': { diagnosis: 'Primary osteoarthritis, right knee', indication: 'Grade IV OA, night pain, failed conservative therapy', asaGrade: 'III', comorbidities: 'Hypertension, obesity' },
  'Cataract Surgery (Phaco)': { diagnosis: 'Senile cataract, left eye', indication: 'Visual acuity 6/60, interfering with daily activity', asaGrade: 'II', comorbidities: 'Hypertension' },
  'Inguinal Hernia Repair': { diagnosis: 'Right inguinal hernia', indication: 'Reducible hernia, increasing in size and discomfort', asaGrade: 'II', comorbidities: 'Nil' },
  'Tonsillectomy': { diagnosis: 'Chronic tonsillitis', indication: 'Seven documented episodes in twelve months', asaGrade: 'I', comorbidities: 'Nil' },
  'Fracture Fixation (ORIF)': { diagnosis: 'Closed fracture, left radius', indication: 'Displaced fracture, unacceptable alignment after reduction', asaGrade: 'IE', comorbidities: 'Nil' },
}

const ANAESTHESIA = {
  GENERAL: { airwayDevice: 'ETT', tubeSize: '7.5', ventilationMode: 'CONTROLLED', ventilatorNote: 'TV 450, RR 12, PEEP 5, FiO2 40%', drugsGiven: 'Propofol 120 mg, Fentanyl 100 mcg, Atracurium 30 mg, Sevoflurane 1.5%' },
  SPINAL: { airwayDevice: 'FACE_MASK', ventilationMode: 'SPONTANEOUS', ventilatorNote: 'O2 by mask 4 L/min', drugsGiven: 'Bupivacaine heavy 0.5% 2.5 ml intrathecal, Midazolam 1 mg' },
  LOCAL: { airwayDevice: 'FACE_MASK', ventilationMode: 'SPONTANEOUS', ventilatorNote: 'Room air, O2 standby', drugsGiven: 'Topical proparacaine, Lignocaine 2% peribulbar block' },
  SEDATION: { airwayDevice: 'FACE_MASK', ventilationMode: 'SPONTANEOUS', ventilatorNote: 'O2 by mask 4 L/min', drugsGiven: 'Midazolam 2 mg, Fentanyl 50 mcg titrated' },
}

const OPNOTE = {
  'Appendicectomy': { findings: 'Inflamed, non-perforated appendix with local peritoneal reaction', performed: 'Open appendicectomy', bloodLoss: 30, specimen: 'Appendix to histopathology' },
  'Laparoscopic Cholecystectomy': { findings: 'Thick-walled gallbladder, multiple calculi, omental adhesions', performed: 'Laparoscopic cholecystectomy', bloodLoss: 50, specimen: 'Gallbladder with calculi to histopathology' },
  'Caesarean Section (LSCS)': { findings: 'Lower segment well formed, clear liquor, live male infant', performed: 'Lower segment caesarean section', bloodLoss: 600, specimen: 'Placenta sent' },
  'Total Knee Replacement': { findings: 'Severe medial compartment wear, osteophytes, collaterals intact', performed: 'Primary total knee arthroplasty, cemented', bloodLoss: 350, specimen: null },
  'Cataract Surgery (Phaco)': { findings: 'Nuclear sclerotic cataract grade III, capsule intact', performed: 'Phacoemulsification with foldable IOL implantation', bloodLoss: 0, specimen: null },
  'Inguinal Hernia Repair': { findings: 'Indirect sac, no strangulation, weak posterior wall', performed: 'Open mesh hernioplasty (Lichtenstein)', bloodLoss: 40, specimen: 'Hernia sac to histopathology' },
  'Tonsillectomy': { findings: 'Bilaterally enlarged, chronically inflamed tonsils', performed: 'Bilateral tonsillectomy (cold steel)', bloodLoss: 40, specimen: 'Both tonsils to histopathology' },
  'Fracture Fixation (ORIF)': { findings: 'Transverse fracture mid-shaft radius, no comminution', performed: 'Open reduction and internal fixation with 3.5 mm DCP', bloodLoss: 80, specimen: null },
}

const before = (date, minutes) => new Date(new Date(date).getTime() - minutes * 60_000)
const after = (date, minutes) => new Date(new Date(date).getTime() + minutes * 60_000)

async function main() {
  const org = (await db.organization.findMany({
    select: { id: true, name: true, _count: { select: { patients: true } } },
  })).sort((a, b) => b._count.patients - a._count.patients)[0]
  console.log('Organization:', org.name, '\n')

  const bookings = await db.otBooking.findMany({
    where: { organizationId: org.id },
    include: { surgery: true, surgeon: { select: { fullName: true } } },
    orderBy: { scheduledStart: 'asc' },
  })
  if (bookings.length === 0) throw new Error('No OT bookings — run seed-ot.js first.')

  const nurse = await db.user.findFirst({
    where: { organizationId: org.id, role: 'nurse' },
    select: { fullName: true },
  })
  const nurseName = nurse?.fullName ?? 'OT Nursing Staff'

  const tally = { preop: 0, checklist: 0, anaesthesia: 0, opnote: 0 }

  for (const booking of bookings) {
    const cancelled = booking.status === 'CANCELLED'
    const started = ['IN_THEATRE', 'COMPLETED'].includes(booking.status)
    const finished = booking.status === 'COMPLETED'
    const endedAt = booking.actualEnd ?? booking.scheduledEnd

    const p = PREOP[booking.procedureName]
      ?? { diagnosis: booking.procedureName, indication: 'Clinically indicated', asaGrade: 'II', comorbidities: 'Nil' }
    const o = OPNOTE[booking.procedureName]
      ?? { findings: 'As expected for the procedure', performed: booking.procedureName, bloodLoss: 50, specimen: null }

    // Every case has a pre-op assessment — including the cancelled one, whose
    // assessment is the reason it was called off.
    await db.otPreOpAssessment.upsert({
      where: { bookingId: booking.id },
      create: {
        organizationId: org.id,
        bookingId: booking.id,
        diagnosis: p.diagnosis,
        indication: p.indication,
        plannedProcedure: booking.procedureName,
        allergies: 'None known',
        currentMedication: p.comorbidities === 'Nil' ? 'Nil' : 'As per prescription',
        comorbidities: p.comorbidities,
        previousSurgery: 'Nil significant',
        asaGrade: p.asaGrade,
        mallampati: 2,
        airwayNote: 'Mouth opening adequate, neck movements full',
        heightCm: 165,
        weightKg: 68,
        systolicBp: 126,
        diastolicBp: 80,
        heartRate: 78,
        spo2: 98,
        bloodGroup: 'B+',
        haemoglobin: 12.6,
        investigationNote: 'CBC, RFT and coagulation within limits. ECG normal sinus rhythm. Chest X-ray clear.',
        fastingFrom: before(booking.scheduledStart, 8 * 60),
        fastingNote: 'Nil by mouth from midnight; clear fluids until 2 h before',
        consentTaken: true,
        consentBy: 'Patient',
        fitness: cancelled ? 'UNFIT' : 'FIT',
        fitnessNote: cancelled
          ? 'Upper respiratory tract infection on the day — case deferred'
          : 'Fit for the planned procedure',
        assessedByName: booking.surgeon?.fullName ?? 'Anaesthetist',
        assessedAt: before(booking.scheduledStart, 24 * 60),
        ...(started && {
          reassessFitness: 'FIT',
          reassessNote: 'Fasting confirmed 8 h, vitals rechecked, consent re-confirmed',
          reassessedByName: booking.surgeon?.fullName ?? 'Anaesthetist',
          reassessedAt: before(booking.scheduledStart, 45),
        }),
      },
      update: {},
    })
    tally.preop++

    if (started) {
      const bigBleed = o.bloodLoss >= 500

      await db.otSafetyChecklist.upsert({
        where: { bookingId: booking.id },
        create: {
          organizationId: org.id,
          bookingId: booking.id,

          signInAt: before(booking.scheduledStart, 15),
          signInByName: nurseName,
          identityConfirmed: true,
          siteMarked: true,
          consentConfirmed: true,
          anaesthesiaCheck: true,
          pulseOximeterOn: true,
          knownAllergy: false,
          difficultAirwayRisk: false,
          bloodLossRisk: bigBleed,

          timeOutAt: after(booking.scheduledStart, 5),
          timeOutByName: nurseName,
          teamIntroduced: true,
          patientSiteAgreed: true,
          antibioticGiven: true,
          imagingDisplayed: true,
          criticalStepsSaid: true,

          // A case still in theatre has NOT signed out — that is the whole point
          // of the third phase, and a demo that signs it anyway teaches the wrong
          // thing.
          ...(finished && {
            signOutAt: endedAt,
            signOutByName: nurseName,
            procedureRecorded: true,
            specimenLabelled: !!o.specimen,
            equipmentIssue: 'Nil',
            recoveryConcern: 'Nil',
            swabInitial: 12,
            swabFinal: 12,
            instrumentInitial: 45,
            instrumentFinal: 45,
            needleInitial: 6,
            needleFinal: 6,
            countsCorrect: true,
            countedByName: nurseName,
            countNote: 'Counted twice, by the scrub and the circulating nurse',
          }),
        },
        update: {},
      })
      tally.checklist++

      const type = booking.surgery?.defaultAnaesthesia ?? 'GENERAL'
      const a = ANAESTHESIA[type] ?? ANAESTHESIA.GENERAL

      await db.otAnaesthesiaRecord.upsert({
        where: { bookingId: booking.id },
        create: {
          organizationId: org.id,
          bookingId: booking.id,
          anaesthesiaType: type,
          asaGrade: p.asaGrade,
          ...a,
          fluidsMl: 1000,
          fluidNote: 'Ringer lactate',
          bloodGiven: bigBleed,
          bloodUnits: bigBleed ? 1 : null,
          bloodNote: bigBleed ? 'PRBC 1 unit, B+, cross-matched' : null,
          monitoringNote: 'ECG, NIBP, SpO2, EtCO2 and temperature — stable throughout',
          complication: 'Nil',
          inductionAt: after(booking.scheduledStart, 5),
          ...(finished && { reversalAt: before(endedAt, 5) }),
          recordedByName: booking.surgeon?.fullName ?? 'Anaesthetist',
        },
        update: {},
      })
      tally.anaesthesia++
    }

    if (finished) {
      await db.otOperativeNote.upsert({
        where: { bookingId: booking.id },
        create: {
          organizationId: org.id,
          bookingId: booking.id,
          incisionAt: after(booking.scheduledStart, 10),
          closureAt: before(endedAt, 5),
          findings: o.findings,
          procedurePerformed: o.performed,
          procedureNote: 'Standard approach. Haemostasis secured. Closure in layers. Sterile dressing applied.',
          complication: 'Nil',
          specimenSent: !!o.specimen,
          specimenDetail: o.specimen,
          bloodLossMl: o.bloodLoss,
          drainDetail: o.bloodLoss >= 300 ? 'One suction drain in situ' : 'Nil',
          postOpInstruction: 'Nil by mouth 4 h, then soft diet. Analgesia as charted. Mobilise as tolerated. Review in 7 days.',
          dictatedByName: booking.surgeon?.fullName ?? 'Surgeon',
          dictatedAt: endedAt,
        },
        update: {},
      })
      tally.opnote++
    }

    const done = ['pre-op', started && 'checklist', started && 'anaesthesia', finished && 'op note'].filter(Boolean)
    console.log(`  ${booking.caseNumber}  ${booking.status.padEnd(11)} ${booking.procedureName.slice(0, 28).padEnd(29)} ${done.join(', ')}`)
  }

  console.log(`\n🎉 pre-op ${tally.preop} · checklist ${tally.checklist} · anaesthesia ${tally.anaesthesia} · op note ${tally.opnote}`)
}

main()
  .catch((e) => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
