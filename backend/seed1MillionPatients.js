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

const regions = ['Maharashtra', 'Delhi', 'Karnataka', 'Gujarat', 'Tamil Nadu', 'Telangana', 'West Bengal'];
const zones = ['Mumbai', 'New Delhi', 'Bangalore', 'Ahmedabad', 'Chennai', 'Hyderabad', 'Kolkata'];
const genders = ['male', 'female', 'other'];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function main() {
  const org = await prisma.organization.findFirst();
  const orgId = org ? org.id : 'org-demo';

  const doctors = await prisma.user.findMany({ where: { role: 'doctor' } });
  if (doctors.length === 0) {
    console.error('No doctors found! Please generate doctors first.');
    return;
  }

  const TOTAL_RECORDS = 1000000;
  const BATCH_SIZE = 2000;
  const TOTAL_BATCHES = Math.ceil(TOTAL_RECORDS / BATCH_SIZE);

  // Check if already seeded to prevent duplicate runs
  const existingCount = await prisma.patient.count({ where: { organizationId: orgId } });
  if (existingCount >= TOTAL_RECORDS) {
    console.log(`✓ Already seeded with ${existingCount} patients. Skipping seeding.`);
    return;
  }

  console.log(`Starting generation of ${TOTAL_RECORDS} patients and appointments in ${TOTAL_BATCHES} batches...`);
  console.log('This will take approximately 10 to 20 minutes depending on your system.');
  console.log(`Current count: ${existingCount} patients\n`);

  let globalPatientCounter = existingCount;
  let batchesCompleted = 0;
  let batchesFailed = 0;

  for (let batch = 1; batch <= TOTAL_BATCHES; batch++) {
    const patients = [];
    const appointments = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      if (globalPatientCounter >= TOTAL_RECORDS) break;
      globalPatientCounter++;

      const patientId = crypto.randomUUID();
      const first = randomElement(firstNames);
      const last = randomElement(lastNames);
      const phone = '9' + Math.floor(Math.random() * 900000000 + 100000000);
      const mrn = `MRN-26-${globalPatientCounter.toString().padStart(7, '0')}`;

      patients.push({
        id: patientId,
        organizationId: orgId,
        mrn: mrn,
        firstName: first,
        lastName: last,
        dateOfBirth: randomDate(new Date(1950, 0, 1), new Date(2020, 0, 1)),
        gender: randomElement(genders),
        phonePrimary: phone,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${globalPatientCounter}@gudmed.in`,
        region: randomElement(regions),
        zone: randomElement(zones),
        woreda: 'City Center',
        isActive: true
      });

      const doctor = randomElement(doctors);
      const aptDate = randomDate(new Date(2026, 0, 1), new Date(2026, 12, 31));

      appointments.push({
        id: crypto.randomUUID(),
        organizationId: orgId,
        patientId: patientId,
        doctorId: doctor.id,
        departmentId: doctor.departmentId,
        appointmentDate: aptDate,
        appointmentTime: '10:00',
        appointmentType: 'new_patient',
        status: 'scheduled',
        priority: 'normal'
      });
    }

    try {
      await prisma.$transaction([
        prisma.patient.createMany({ data: patients, skipDuplicates: true }),
        prisma.appointment.createMany({ data: appointments, skipDuplicates: true })
      ]);
      batchesCompleted++;
      console.log(`✓ Batch ${batch}/${TOTAL_BATCHES} completed (${globalPatientCounter}/${TOTAL_RECORDS} total)`);
    } catch (err) {
      batchesFailed++;
      console.error(`✗ Error in batch ${batch}:`, err.message);
      console.log(`  Continuing with next batch... (${batchesCompleted} succeeded, ${batchesFailed} failed)`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Seeding completed!`);
  console.log(`  Total records: ${globalPatientCounter}`);
  console.log(`  Batches succeeded: ${batchesCompleted}/${TOTAL_BATCHES}`);
  if (batchesFailed > 0) console.log(`  Batches failed: ${batchesFailed}/${TOTAL_BATCHES}`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
