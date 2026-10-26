// Seed Purchase & Supply Chain VENDORS for the first organization.
// Codes come from nextMasterCode (VEN-0001…) exactly like the vendor screen,
// and GSTINs carry a valid check character so they pass parseGstin on edit.
// Safe to re-run: a vendor whose GSTIN already exists in the org is skipped.
//
// Run:  node seed-vendors.js
import { db } from './src/config/db.js'
import { nextMasterCode } from './src/lib/counters.js'
import { gstinCheckChar } from './src/lib/gst.js'

// pan + stateCode build the GSTIN: <state><pan>1Z<check>
const VENDORS = [
  {
    name: 'Sun Pharma Distributors', contactPerson: 'Rajesh Mehta', phone: '9810011001', email: 'orders@sunpharmadist.in',
    pan: 'AABCS1234K', stateCode: '06', houseNumber: 'Plot 21', street: 'Udyog Vihar Phase 4', locality: 'Udyog Vihar', city: 'Gurugram', district: 'Gurugram', pincode: '122015',
    bankAccountName: 'Sun Pharma Distributors', bankName: 'HDFC Bank', bankAccountNumber: '50200012345671', bankIfsc: 'HDFC0000572',
    paymentTermsDays: 30, vendorType: 'goods', msmeNumber: null, defaultTdsSection: null,
  },
  {
    name: 'Cipla Medical Supplies', contactPerson: 'Anita Sharma', phone: '9810011002', email: 'sales@ciplamed.in',
    pan: 'AACCC2345L', stateCode: '07', houseNumber: '14', street: 'Okhla Industrial Estate Phase 2', locality: 'Okhla', city: 'New Delhi', district: 'South East Delhi', pincode: '110020',
    bankAccountName: 'Cipla Medical Supplies', bankName: 'ICICI Bank', bankAccountNumber: '001205012345', bankIfsc: 'ICIC0000012',
    paymentTermsDays: 45, vendorType: 'goods', msmeNumber: null, defaultTdsSection: null,
  },
  {
    name: 'MediEquip Surgicals', contactPerson: 'Vikram Singh', phone: '9810011003', email: 'vikram@mediequip.in',
    pan: 'AAFFM3456M', stateCode: '06', houseNumber: 'SCO 45', street: 'Sector 29 Market', locality: 'Sector 29', city: 'Gurugram', district: 'Gurugram', pincode: '122001',
    bankAccountName: 'MediEquip Surgicals', bankName: 'State Bank of India', bankAccountNumber: '32145678901', bankIfsc: 'SBIN0001234',
    paymentTermsDays: 30, vendorType: 'goods', msmeNumber: 'UDYAM-HR-05-0012345', defaultTdsSection: null,
  },
  {
    name: 'Apex Diagnostics Reagents', contactPerson: 'Neha Kapoor', phone: '9810011004', email: 'neha@apexreagents.in',
    pan: 'AAKCA4567N', stateCode: '27', houseNumber: 'Unit 302', street: 'Andheri Kurla Road', locality: 'Andheri East', city: 'Mumbai', district: 'Mumbai Suburban', pincode: '400059',
    bankAccountName: 'Apex Diagnostics Reagents Pvt Ltd', bankName: 'Axis Bank', bankAccountNumber: '917020012345678', bankIfsc: 'UTIB0000004',
    paymentTermsDays: 60, vendorType: 'goods', msmeNumber: null, defaultTdsSection: null,
  },
  {
    name: 'CleanCare Housekeeping Services', contactPerson: 'Sunil Verma', phone: '9810011005', email: 'ops@cleancare.in',
    pan: 'AAJFC5678P', stateCode: '06', houseNumber: '7', street: 'Sohna Road', locality: 'Sector 48', city: 'Gurugram', district: 'Gurugram', pincode: '122018',
    bankAccountName: 'CleanCare Housekeeping Services', bankName: 'Kotak Mahindra Bank', bankAccountNumber: '4611234567', bankIfsc: 'KKBK0004261',
    paymentTermsDays: 15, vendorType: 'services', msmeNumber: 'UDYAM-HR-05-0067890', defaultTdsSection: '194C',
  },
  {
    name: 'BioMed Equipment Maintenance', contactPerson: 'Arjun Nair', phone: '9810011006', email: 'service@biomedmaint.in',
    pan: 'AAHCB6789Q', stateCode: '29', houseNumber: '88', street: 'Hosur Road', locality: 'Electronic City', city: 'Bengaluru', district: 'Bengaluru Urban', pincode: '560100',
    bankAccountName: 'BioMed Equipment Maintenance Pvt Ltd', bankName: 'HDFC Bank', bankAccountNumber: '50200098765432', bankIfsc: 'HDFC0001753',
    paymentTermsDays: 30, vendorType: 'both', msmeNumber: null, defaultTdsSection: '194C',
  },
  {
    name: 'Oxygen Gas Suppliers', contactPerson: 'Harpreet Gill', phone: '9810011007', email: 'supply@oxygas.in',
    pan: 'AAGFO7890R', stateCode: '06', houseNumber: 'Plot 5', street: 'IMT Manesar Sector 8', locality: 'IMT Manesar', city: 'Gurugram', district: 'Gurugram', pincode: '122051',
    bankAccountName: 'Oxygen Gas Suppliers', bankName: 'Punjab National Bank', bankAccountNumber: '0123456789012345', bankIfsc: 'PUNB0012300',
    paymentTermsDays: 7, vendorType: 'goods', msmeNumber: 'UDYAM-HR-05-0034567', defaultTdsSection: null,
  },
  {
    name: 'Dr. Ritu Consultancy', contactPerson: 'Dr. Ritu Bansal', phone: '9810011008', email: 'ritu.bansal@consult.in',
    pan: 'ABCPB8901S', stateCode: '07', houseNumber: 'B-12', street: 'Greater Kailash Part 1', locality: 'GK-1', city: 'New Delhi', district: 'South Delhi', pincode: '110048',
    bankAccountName: 'Ritu Bansal', bankName: 'State Bank of India', bankAccountNumber: '30987654321', bankIfsc: 'SBIN0005678',
    paymentTermsDays: 30, vendorType: 'services', msmeNumber: null, defaultTdsSection: '194J',
  },
]

async function main() {
  console.log('Seeding Purchase & Supply vendors...\n')
  const org = await db.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error('No organization found.')
  console.log('Organization:', org.name, `(${org.id})`)

  let created = 0
  for (const v of VENDORS) {
    const first14 = `${v.stateCode}${v.pan}1Z`
    const gstNumber = first14 + gstinCheckChar(first14)

    const exists = await db.vendor.findFirst({ where: { organizationId: org.id, gstNumber }, select: { code: true } })
    if (exists) {
      console.log(`  ⏭️  ${exists.code ?? '—'}  ${v.name} already exists`)
      continue
    }

    const vendor = await db.$transaction(async (tx) => {
      const code = await nextMasterCode(tx, org.id, 'VENDOR', 'VEN')
      return tx.vendor.create({
        data: {
          organizationId: org.id,
          ...v,
          code,
          gstNumber,
          address: [v.houseNumber, v.street, v.locality, v.city, v.pincode].filter(Boolean).join(', '),
        },
      })
    })
    created++
    console.log(`  ✅ ${vendor.code}  ${vendor.name}  [GSTIN ${gstNumber}]  ${v.vendorType}`)
  }

  const total = await db.vendor.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 Created ${created} vendors. Total in org now: ${total}`)
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
