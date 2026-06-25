import { db } from './src/config/db.js'

const indianFirstNamesMale = [
  'Rajesh', 'Amit', 'Vikram', 'Suresh', 'Arun', 'Prakash', 'Sanjay', 'Arjun', 'Manoj', 'Nikhil',
  'Rohan', 'Varun', 'Karan', 'Ajay', 'Deepak', 'Anand', 'Harish', 'Pradeep', 'Ravi', 'Sandeep',
  'Praveen', 'Mohan', 'Sunil', 'Ramesh', 'Dinesh', 'Mahesh', 'Ashok', 'Vishal', 'Akshay', 'Rohit',
  'Gaurav', 'Harsh', 'Inder', 'Jitendra', 'Kamal', 'Lokesh', 'Milind', 'Naren', 'Omkar', 'Puneet',
  'Rajkumar', 'Sameer', 'Taran', 'Udayaditya', 'Vaibhav', 'Yadav', 'Zaheer', 'Aditya', 'Aman', 'Anuj'
]

const indianFirstNamesFemale = [
  'Priya', 'Anjali', 'Neha', 'Pooja', 'Divya', 'Nisha', 'Isha', 'Aarti', 'Swati', 'Kavya',
  'Shreya', 'Riya', 'Meera', 'Gita', 'Ananya', 'Deepa', 'Rina', 'Sunita', 'Heena', 'Kiran',
  'Latika', 'Madhavi', 'Nikita', 'Olivia', 'Pooja', 'Qua', 'Rachana', 'Sakshi', 'Tanvi', 'Usha',
  'Vandana', 'Waheeda', 'Ximena', 'Yuki', 'Zara', 'Anushka', 'Bhavna', 'Chaya', 'Diksha', 'Esha',
  'Fiona', 'Gauri', 'Harini', 'Ira', 'Jaya', 'Kaavya', 'Lakshmi', 'Malini', 'Namrata', 'Oisha'
]

const indianLastNames = [
  'Sharma', 'Singh', 'Kumar', 'Patel', 'Gupta', 'Reddy', 'Verma', 'Rao', 'Nair', 'Iyer',
  'Menon', 'Pandey', 'Tiwari', 'Mishra', 'Bhat', 'Desai', 'Joshi', 'Kulkarni', 'Chopra', 'Bhatnagar',
  'Malhotra', 'Kapoor', 'Khanna', 'Mehra', 'Sethi', 'Bansal', 'Aggarwal', 'Saxena', 'Sinha', 'Pathak',
  'Banerjee', 'Chatterjee', 'Dasgupta', 'Roy', 'Ghosh', 'Mukherjee', 'Dutta', 'Bose', 'Chakraborty', 'Sengupta',
  'Rao', 'Nayak', 'Raman', 'Srivastav', 'Dey', 'Das', 'Garg', 'Arora', 'Dhawan', 'Jain'
]

const indianAddresses = {
  'Delhi': [
    { area: 'Connaught Place', zip: '110001' },
    { area: 'Chandni Chowk', zip: '110006' },
    { area: 'Rajinder Nagar', zip: '110060' },
    { area: 'New Delhi', zip: '110002' },
    { area: 'Dwarka', zip: '110075' },
    { area: 'Noida City Center', zip: '201301' },
    { area: 'Greater Noida', zip: '201306' },
    { area: 'Gurgaon', zip: '122001' },
  ],
  'Mumbai': [
    { area: 'Bandra', zip: '400050' },
    { area: 'Andheri', zip: '400053' },
    { area: 'Marine Drive', zip: '400020' },
    { area: 'Fort', zip: '400001' },
    { area: 'Dadar', zip: '400014' },
    { area: 'Powai', zip: '400076' },
    { area: 'Thane', zip: '400601' },
  ],
  'Bangalore': [
    { area: 'Indiranagar', zip: '560038' },
    { area: 'Koramangala', zip: '560034' },
    { area: 'Whitefield', zip: '560066' },
    { area: 'MG Road', zip: '560001' },
    { area: 'HSR Layout', zip: '560102' },
  ],
  'Hyderabad': [
    { area: 'Hitech City', zip: '500084' },
    { area: 'Banjara Hills', zip: '500034' },
    { area: 'Jubilee Hills', zip: '500033' },
    { area: 'Madhapur', zip: '500081' },
  ],
  'Chennai': [
    { area: 'Anna Nagar', zip: '600040' },
    { area: 'T. Nagar', zip: '600017' },
    { area: 'Velachery', zip: '600042' },
    { area: 'Adyar', zip: '600020' },
  ],
  'Kolkata': [
    { area: 'Alipore', zip: '700027' },
    { area: 'South Kolkata', zip: '700034' },
    { area: 'Salt Lake', zip: '700091' },
    { area: 'New Town', zip: '700156' },
  ],
  'Pune': [
    { area: 'Koregaon Park', zip: '411001' },
    { area: 'Viman Nagar', zip: '411014' },
    { area: 'Baner', zip: '411045' },
  ]
}

const departments = [
  'General Medicine', 'Cardiology', 'Orthopedics', 'Pediatrics', 'Gynecology',
  'Neurology', 'Dermatology', 'ENT', 'Ophthalmology', 'Psychiatry',
  'Urology', 'Surgery', 'Gastroenterology', 'Nephrology', 'Pulmonology'
]

const doctorNames = [
  'Dr. Rajesh Sharma', 'Dr. Amit Singh', 'Dr. Vikram Patel', 'Dr. Suresh Gupta', 'Dr. Arun Reddy',
  'Dr. Priya Menon', 'Dr. Neha Verma', 'Dr. Pooja Iyer', 'Dr. Divya Nair', 'Dr. Anjali Singh',
  'Dr. Shreya Patel', 'Dr. Riya Gupta', 'Dr. Meera Sharma', 'Dr. Ananya Reddy', 'Dr. Kavya Rao',
  'Dr. Harish Kumar', 'Dr. Pradeep Singh', 'Dr. Ravi Patel', 'Dr. Sandeep Gupta', 'Dr. Praveen Nair'
]

const genders = ['Male', 'Female']

function generateRandomDate(startYear, endYear) {
  const start = new Date(startYear, 0, 1)
  const end = new Date(endYear, 11, 31)
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateIndianAddress() {
  const city = getRandomItem(Object.keys(indianAddresses))
  const location = getRandomItem(indianAddresses[city])
  return `${location.area}, ${city}, ${location.zip}`
}

function generatePhoneNumber() {
  return '91' + Math.floor(Math.random() * 9000000000 + 1000000000)
}

function generateEmail(firstName, lastName) {
  const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com']
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${getRandomItem(domains)}`
}

function generateMRN(index) {
  return `MRN${String(100000 + index).padStart(6, '0')}`
}

async function seed500Patients() {
  try {
    console.log('👥 PATIENT & APPOINTMENT SEEDING STARTED')
    console.log(`📊 Creating: 500 patients + 500 appointments\n`)

    const orgId = 'org-demo'
    let patientCount = 0
    let appointmentCount = 0
    let errors = []

    // Get or create a default doctor/user for appointments
    const doctorUser = await db.user.findFirst({
      where: { organizationId: orgId, isActive: true }
    })

    if (!doctorUser) {
      console.error('❌ No active user found. Please create a user first.')
      process.exit(1)
    }

    for (let i = 1; i <= 500; i++) {
      try {
        const gender = getRandomItem(genders)
        const firstName = gender === 'Male'
          ? getRandomItem(indianFirstNamesMale)
          : getRandomItem(indianFirstNamesFemale)
        const lastName = getRandomItem(indianLastNames)
        const mrn = generateMRN(i)
        const dob = generateRandomDate(1950, 2010)
        const age = new Date().getFullYear() - dob.getFullYear()

        // Generate Indian address components
        const cityList = Object.keys(indianAddresses)
        const region = getRandomItem(cityList)
        const locationData = getRandomItem(indianAddresses[region])
        const houseNum = Math.floor(Math.random() * 500) + 1

        // Create patient
        const patient = await db.patient.create({
          data: {
            organizationId: orgId,
            mrn,
            firstName,
            lastName,
            gender,
            dateOfBirth: dob,
            phonePrimary: generatePhoneNumber(),
            email: generateEmail(firstName, lastName),
            region: region, // State/City in India
            zone: locationData.area, // Area/Locality
            woreda: `Block ${Math.floor(Math.random() * 10) + 1}`, // Sub-area
            kebele: `Ward ${Math.floor(Math.random() * 20) + 1}`, // Neighborhood
            houseNumber: `${houseNum}`, // Street number
            postalCode: locationData.zip,
            isActive: true,
            maritalStatus: age > 25 ? (Math.random() > 0.3 ? 'Married' : 'Single') : 'Single',
            emergencyContactName: `${firstName} ${lastName} (Emergency)`,
            emergencyContactPhone: generatePhoneNumber(),
            bloodGroup: getRandomItem(['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']),
          },
        })

        patientCount++

        // Create appointment for the patient
        const appointmentDept = getRandomItem(departments)
        const appointmentDate = new Date()
        appointmentDate.setDate(appointmentDate.getDate() + Math.floor(Math.random() * 30) + 1)

        const appointmentTimes = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30']
        const time = getRandomItem(appointmentTimes)

        const appointmentStatus = Math.random() > 0.2 ? 'scheduled' : (Math.random() > 0.5 ? 'completed' : 'cancelled')
        const appointmentType = getRandomItem(['new_patient', 'follow_up', 'emergency'])
        const chiefComplaints = ['General Checkup', 'Fever', 'Pain', 'Chronic Disease Management', 'Vaccination', 'Lab Results Review', 'Follow-up Consultation']

        await db.appointment.create({
          data: {
            organizationId: orgId,
            patientId: patient.id,
            doctorId: doctorUser.id,
            appointmentDate,
            appointmentTime: time,
            appointmentType: appointmentType,
            departmentId: '', // Optional: can leave empty
            priority: Math.random() > 0.8 ? 'urgent' : 'normal',
            status: appointmentStatus,
            chiefComplaint: getRandomItem(chiefComplaints),
            notes: `Patient ${firstName} ${lastName} (Age: ${age}) - ${appointmentDept}`,
            consultationFee: getRandomItem([500, 800, 1000, 1500, 2000]),
            },
        })

        appointmentCount++

        // Add some death records for older patients (realistic)
        if (age > 70 && Math.random() > 0.85) {
          const deathDate = new Date()
          deathDate.setDate(deathDate.getDate() - Math.floor(Math.random() * 365))

          await db.deathCertificate.create({
            data: {
              organizationId: orgId,
              patientId: patient.id,
              certificateNumber: `DEATH${String(i).padStart(6, '0')}`,
              dateOfDeath: deathDate,
              timeOfDeath: `${Math.floor(Math.random() * 24)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
              causeOfDeath: getRandomItem(['Natural Causes', 'Heart Failure', 'Respiratory Failure', 'Complications']),
              placeOfDeath: 'Hospital',
              sex: patient.gender,
              issuedAt: deathDate,
              isActive: true,
            },
          })
        }

        if ((i % 50 === 0)) {
          console.log(`⏳ Progress: ${i}/500 patients created...`)
        }
      } catch (err) {
        errors.push({ patient: i, error: err.message.substring(0, 100) })
        if (errors.length <= 5) {
          console.log(`⚠️  Error creating patient ${i}: ${err.message.substring(0, 80)}`)
        }
      }
    }

    console.log('\n' + '='.repeat(70))
    console.log('👥 PATIENT & APPOINTMENT SEEDING COMPLETE')
    console.log('='.repeat(70))
    console.log(`✅ Patients Created: ${patientCount}`)
    console.log(`✅ Appointments Created: ${appointmentCount}`)
    console.log(`❌ Failed: ${errors.length}`)
    console.log(`\n🎉 Patient database populated with realistic Indian data!`)

    if (errors.length > 5) {
      console.log(`\n(Showing first 5 errors of ${errors.length} total errors)`)
    }

    process.exit(patientCount > 0 ? 0 : 1)
  } catch (err) {
    console.error('❌ Critical error:', err.message)
    process.exit(1)
  }
}

seed500Patients()
