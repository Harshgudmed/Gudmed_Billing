import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const firstNames = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 
  'Shaurya', 'Atharva', 'Aanya', 'Diya', 'Aditi', 'Ananya', 'Navya', 'Kavya', 'Ishita', 'Riya', 
  'Myra', 'Zara', 'Maya', 'Rajesh', 'Suresh', 'Amit', 'Sneha', 'Neha', 'Priya', 'Rohit', 
  'Rahul', 'Manish', 'Sanjay', 'Vikas', 'Nidhi', 'Pooja', 'Swati', 'Rakesh', 'Vikram', 'Anjali',
  'Deepika', 'Arun', 'Divya', 'Isha', 'Ravi', 'Karan', 'Meera', 'Ashok', 'Ritika', 'Haroon',
  'Sonali', 'Varun', 'Priti', 'Sumit', 'Nisha', 'Rajiv', 'Seema', 'Megha', 'Sandeep', 'Shruti',
  'Vishal', 'Rachna', 'Gaurav', 'Preeti', 'Aryan', 'Prakash', 'Nitin', 'Sanjiv', 'Manmohan', 'Geeta',
  'Harish', 'Simran', 'Anil', 'Nanda', 'Ajay', 'Savita', 'Sameer', 'Abhishek', 'Rohan', 'Akhil',
  'Kiran', 'Tarun', 'Naveen', 'Pradeep', 'Siddharth', 'Prashant', 'Deepak', 'Alok', 'Manoj', 'Praveen',
  'Sita', 'Gita', 'Rekha', 'Sushma', 'Mamta', 'Kavitha', 'Jyoti', 'Sunita', 'Anita', 'Kusum'
];

const lastNames = [
  'Sharma', 'Patel', 'Gupta', 'Verma', 'Singh', 'Reddy', 'Rao', 'Desai', 'Iyer', 'Nair', 
  'Menon', 'Joshi', 'Bhat', 'Kapoor', 'Malhotra', 'Tiwari', 'Saxena', 'Das', 'Khan', 'Mishra',
  'Choudhury', 'Bose', 'Chatterjee', 'Mukherjee', 'Banerjee', 'Iyer', 'Pillai', 'Krishnan', 'Hedge', 'Kulkarni',
  'Deshpande', 'Garg', 'Agarwal', 'Bansal', 'Goyal', 'Mehta', 'Shah', 'Chauhan', 'Rajput', 'Yadav'
];

function getRandomName() {
  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];
  return { first, last };
}

async function main() {
  console.log('Starting generation of 1,000 doctors...');
  
  // Find organization
  const org = await prisma.organization.findFirst();
  const orgId = org ? org.id : 'org-demo';
  console.log(`Using Organization ID: ${orgId}`);

  // Find departments
  const departments = await prisma.department.findMany();
  if (departments.length === 0) {
    console.error('No departments found. Please create departments first.');
    return;
  }
  
  console.log(`Found ${departments.length} departments.`);

  const passwordHash = await bcrypt.hash('Gudmed@123', 10);
  let globalCounter = 0;
  
  // To keep track of generated emails to ensure uniqueness
  const usedEmails = new Set();
  
  const doctorsToInsert = [];

  for (const dept of departments) {
    // Generate 100 doctors per department
    for (let i = 0; i < 100; i++) {
      const { first, last } = getRandomName();
      const fullName = `Dr. ${first} ${last}`;
      
      let emailBase = `${first.toLowerCase()}.${last.toLowerCase()}`;
      let email = `${emailBase}@gudmed.in`;
      
      // Ensure email is unique
      let attempt = 1;
      while (usedEmails.has(email)) {
        email = `${emailBase}${Math.floor(Math.random() * 1000)}@gudmed.in`;
        attempt++;
      }
      usedEmails.add(email);

      doctorsToInsert.push({
        organizationId: orgId,
        fullName: fullName,
        email: email,
        passwordHash: passwordHash,
        role: 'doctor',
        departmentId: dept.id,
        specialization: dept.name,
        isActive: true
      });
      globalCounter++;
    }
    console.log(`Generated 100 doctors for department: ${dept.name}`);
  }

  console.log(`\nInserting ${doctorsToInsert.length} doctors into the database...`);
  
  // Batch insert
  try {
    const result = await prisma.user.createMany({
      data: doctorsToInsert,
      skipDuplicates: true // In case some emails already exist
    });
    console.log(`\nSuccess! Successfully inserted ${result.count} new doctors.`);
  } catch (error) {
    console.error('\nError inserting doctors:', error);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
