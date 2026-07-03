import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const firstNames = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Shaurya', 'Atharva', 'Aanya', 'Diya', 'Aditi', 'Ananya', 'Navya', 'Kavya', 'Ishita', 'Riya',
  'Myra', 'Zara', 'Maya', 'Rajesh', 'Suresh', 'Amit', 'Sneha', 'Neha', 'Priya', 'Rohit',
  'Rahul', 'Manish', 'Sanjay', 'Vikas', 'Nidhi', 'Pooja', 'Swati', 'Rakesh', 'Vikram', 'Anjali',
  'Deepika', 'Arun', 'Divya', 'Isha', 'Ravi', 'Karan', 'Meera', 'Ashok', 'Ritika', 'Haroon',
  'Sonali', 'Varun', 'Priti', 'Sumit', 'Nisha', 'Rajiv', 'Seema', 'Megha', 'Sandeep', 'Shruti',
  'Vishal', 'Rachna', 'Gaurav', 'Preeti', 'Aryan', 'Prakash', 'Nitin', 'Sanjiv', 'Manmohan', 'Geeta',
  'Harish', 'Simran', 'Anil', 'Nanda', 'Ajay', 'Savita', 'Sameer', 'Abhishek', 'Rohan', 'Akhil'
];

const lastNames = [
  'Sharma', 'Patel', 'Gupta', 'Verma', 'Singh', 'Reddy', 'Rao', 'Desai', 'Iyer', 'Nair',
  'Menon', 'Joshi', 'Bhat', 'Kapoor', 'Malhotra', 'Tiwari', 'Saxena', 'Das', 'Khan', 'Mishra',
  'Choudhury', 'Bose', 'Chatterjee', 'Mukherjee', 'Banerjee', 'Iyer', 'Pillai', 'Krishnan', 'Hedge'
];

const middleNames = ['Kumar', 'Lal', 'Devi', 'Prasad', 'Chand', 'Nath', 'Raj', 'Bai', 'Mohan', ''];
const regions = ['Maharashtra', 'Delhi', 'Karnataka', 'Gujarat', 'Tamil Nadu', 'Telangana', 'West Bengal'];
const zones = ['Mumbai', 'New Delhi', 'Bangalore', 'Ahmedabad', 'Chennai', 'Hyderabad', 'Kolkata'];
const genders = ['male', 'female', 'other'];
const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const maritalStatuses = ['single', 'married', 'widowed', 'divorced'];
const occupations = ['Farmer', 'Teacher', 'Shopkeeper', 'Engineer', 'Driver', 'Homemaker', 'Labourer', 'Clerk', 'Nurse', 'Retired'];
const educationLevels = ['None', 'Primary', 'Secondary', 'Graduate', 'Post-Graduate'];
const relationships = ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister'];
const insurers = ['Star Health', 'HDFC Ergo', 'ICICI Lombard', 'Niva Bupa', 'Care Health', 'New India Assurance'];
const allergyPool = ['Penicillin', 'Sulfa drugs', 'Aspirin', 'Peanuts', 'Dust', 'Pollen', 'Latex'];
const conditionPool = ['Hypertension', 'Type 2 Diabetes', 'Asthma', 'Hypothyroidism', 'Arthritis', 'CKD'];
const medicinePool = ['Metformin 500mg', 'Amlodipine 5mg', 'Atorvastatin 10mg', 'Levothyroxine 50mcg', 'Telmisartan 40mg'];
const referrers = ['Dr. Self', 'Camp', 'Walk-in', 'Dr. Mehta Clinic', 'ASHA Worker', 'Online'];

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomDate(start, end) { return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())); }
// pick `n` random distinct items, return as a JSON string (matches how the app stores these)
function jsonSample(arr, n) {
  const out = new Set();
  while (out.size < n && out.size < arr.length) out.add(rnd(arr));
  return JSON.stringify([...out]);
}

async function main() {
  const org = await prisma.organization.findFirst();
  const orgId = org ? org.id : 'org-demo';

  const doctors = await prisma.user.findMany({ where: { role: 'doctor' } });
  if (doctors.length === 0) {
    console.error('No doctors found! Please generate doctors first.');
    return;
  }

  // Target is configurable so you can add a small measured batch without a 20-min full run:
  //   SEED_TARGET=1050000 node seed1MillionPatients.js   → tops up to 10.5 lakh
  const TOTAL_RECORDS = Number(process.env.SEED_TARGET) || 1000000;
  const BATCH_SIZE = 2000;

  const existingCount = await prisma.patient.count({ where: { organizationId: orgId } });
  if (existingCount >= TOTAL_RECORDS) {
    console.log(`Already at ${existingCount} patients (target ${TOTAL_RECORDS}). Nothing to add.`);
    return;
  }

  const TOTAL_BATCHES = Math.ceil((TOTAL_RECORDS - existingCount) / BATCH_SIZE);
  console.log(`Generating FULLY-FILLED patients ${existingCount + 1} → ${TOTAL_RECORDS} in ${TOTAL_BATCHES} batches...`);

  let counter = existingCount;
  let done = 0, failed = 0;

  for (let batch = 1; batch <= TOTAL_BATCHES; batch++) {
    const patients = [];
    const appointments = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      if (counter >= TOTAL_RECORDS) break;
      counter++;

      const patientId = crypto.randomUUID();
      const first = rnd(firstNames);
      const last = rnd(lastNames);
      const gender = rnd(genders);
      const phone = '9' + rndInt(100000000, 999999999);
      const hasInsurance = Math.random() < 0.45;

      patients.push({
        id: patientId,
        organizationId: orgId,
        mrn: `MRN-26-${counter.toString().padStart(7, '0')}`,
        externalId: `EXT-${rndInt(100000, 999999)}`,
        // Personal
        firstName: first,
        middleName: rnd(middleNames) || null,
        lastName: last,
        dateOfBirth: randomDate(new Date(1950, 0, 1), new Date(2020, 0, 1)),
        gender,
        bloodGroup: rnd(bloodGroups),
        // Contact
        phonePrimary: phone,
        phoneSecondary: '8' + rndInt(100000000, 999999999),
        email: `${first.toLowerCase()}.${last.toLowerCase()}${counter}@gudmed.in`,
        // Address
        region: rnd(regions),
        zone: rnd(zones),
        woreda: 'Ward ' + rndInt(1, 40),
        kebele: 'Block ' + String.fromCharCode(65 + rndInt(0, 25)),
        houseNumber: 'H-' + rndInt(1, 999),
        postalCode: String(rndInt(110001, 799999)),
        addressDescription: `House H-${rndInt(1, 999)}, Near Main Road, ${rnd(zones)}`,
        // Emergency contact
        emergencyContactName: `${rnd(firstNames)} ${last}`,
        emergencyContactPhone: '7' + rndInt(100000000, 999999999),
        emergencyContactRelationship: rnd(relationships),
        // Medical (JSON arrays, as the app stores them)
        allergies: Math.random() < 0.4 ? jsonSample(allergyPool, rndInt(1, 2)) : null,
        chronicConditions: Math.random() < 0.5 ? jsonSample(conditionPool, rndInt(1, 2)) : null,
        currentMedications: Math.random() < 0.5 ? jsonSample(medicinePool, rndInt(1, 3)) : null,
        // Insurance
        hasInsurance,
        insuranceProvider: hasInsurance ? rnd(insurers) : null,
        insuranceId: hasInsurance ? 'POL' + rndInt(100000, 999999) : null,
        insuranceExpiryDate: hasInsurance ? randomDate(new Date(2026, 6, 1), new Date(2028, 0, 1)) : null,
        insuranceCoverageDetails: hasInsurance ? JSON.stringify({ limit: rnd([100000, 200000, 500000]), copay: '10%' }) : null,
        // Additional
        maritalStatus: rnd(maritalStatuses),
        referredBy: rnd(referrers),
        mlcNumber: Math.random() < 0.05 ? 'MLC-' + rndInt(1000, 9999) : null,
        occupation: rnd(occupations),
        educationLevel: rnd(educationLevels),
        notes: 'Registered at front desk. Verified ID. ' + (hasInsurance ? 'Insurance on file.' : 'Cash patient.'),
        isActive: true,
      });

      const doctor = rnd(doctors);
      appointments.push({
        id: crypto.randomUUID(),
        organizationId: orgId,
        patientId,
        doctorId: doctor.id,
        departmentId: doctor.departmentId,
        appointmentDate: randomDate(new Date(2026, 0, 1), new Date(2026, 11, 31)),
        appointmentTime: `${rndInt(9, 17)}:00`,
        appointmentType: 'new_patient',
        status: 'scheduled',
        priority: 'normal',
      });
    }

    try {
      await prisma.$transaction([
        prisma.patient.createMany({ data: patients, skipDuplicates: true }),
        prisma.appointment.createMany({ data: appointments, skipDuplicates: true }),
      ]);
      done++;
      if (batch % 5 === 0 || batch === TOTAL_BATCHES) {
        console.log(`Batch ${batch}/${TOTAL_BATCHES} done (${counter}/${TOTAL_RECORDS})`);
      }
    } catch (err) {
      failed++;
      console.error(`Batch ${batch} failed:`, err.message);
    }
  }

  console.log(`\nDone. Added up to ${counter} patients (${done} batches ok, ${failed} failed).`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
