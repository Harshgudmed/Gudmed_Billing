#!/usr/bin/env node

/**
 * Migrate local database to production
 *
 * Usage:
 *   node migrate-local-to-prod.js
 *
 * This script:
 * 1. Connects to your local PostgreSQL
 * 2. Exports all data (organizations, users, patients, consultations, death certificates, etc.)
 * 3. Cleans data (removes auto-fields, handles FKs)
 * 4. Pushes to production via API
 */

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const localDb = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:password@localhost:5432/hospital_db' } }
})

const PROD_API = 'https://gudmed-api.onrender.com/api'
// Read the secret from the environment — never hardcode it (it was a repo-visible
// master key). Run as:  IMPORT_SECRET="<value>" node migrate-local-to-prod.js
const IMPORT_SECRET = process.env.IMPORT_SECRET
if (!IMPORT_SECRET) { console.error('Set IMPORT_SECRET env var before running.'); process.exit(1) }

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Exporting Local Data')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  try {
    // Export all data
    console.log('\n📦 Fetching data from local database...')

    const [
      organizations, users, wards, patients, pharmacyDrugs,
      appointments, preTriages, queueItems,
      consultations, prescriptions,
      labOrders, labResults,
      radiologyOrders, radiologyReports,
      admissions,
      invoices, payments, pharmacySales,
      deathCertificates
    ] = await Promise.all([
      localDb.organization.findMany(),
      localDb.user.findMany(),
      localDb.ward.findMany(),
      localDb.patient.findMany(),
      localDb.pharmacyDrug.findMany(),
      localDb.appointment.findMany(),
      localDb.preTriage.findMany().catch(() => []),
      localDb.queueManagement.findMany().catch(() => []),
      localDb.consultation.findMany(),
      localDb.prescription.findMany(),
      localDb.labOrder.findMany(),
      localDb.labResult.findMany(),
      localDb.radiologyOrder.findMany(),
      localDb.radiologyReport.findMany().catch(() => []),
      localDb.admission.findMany(),
      localDb.invoice.findMany(),
      localDb.payment.findMany(),
      localDb.pharmacySale.findMany(),
      localDb.deathCertificate.findMany().catch(() => []),
    ])

    const counts = {
      organizations: organizations.length,
      users: users.length,
      wards: wards.length,
      patients: patients.length,
      pharmacyDrugs: pharmacyDrugs.length,
      appointments: appointments.length,
      preTriages: preTriages.length,
      queueItems: queueItems.length,
      consultations: consultations.length,
      prescriptions: prescriptions.length,
      labOrders: labOrders.length,
      labResults: labResults.length,
      radiologyOrders: radiologyOrders.length,
      radiologyReports: radiologyReports.length,
      admissions: admissions.length,
      invoices: invoices.length,
      payments: payments.length,
      pharmacySales: pharmacySales.length,
      deathCertificates: deathCertificates.length,
    }

    console.log('\n✅ Export Summary:')
    Object.entries(counts).forEach(([key, count]) => {
      if (count > 0) console.log(`  📊 ${key}: ${count}`)
    })

    const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0)
    console.log(`\n  Total records: ${totalRecords}`)

    // Push to production
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Pushing to Production')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    // Validate death certificates: ensure all referenced users/patients exist
    const validUserIds = new Set(users.map(u => u.id))
    const validPatientIds = new Set(patients.map(p => p.id))
    console.log(`\n  📋 Validating ${deathCertificates.length} death certificates...`)
    const validDeathCerts = deathCertificates.map(dc => {
      const cleaned = { ...dc }
      // Remove certifiedById if the user doesn't exist in our import
      if (cleaned.certifiedById && !validUserIds.has(cleaned.certifiedById)) {
        console.log(`    ⚠️  Removing invalid certifiedById for DC ${dc.id}`)
        cleaned.certifiedById = null
      }
      // Only keep if patient exists
      if (!validPatientIds.has(cleaned.patientId)) {
        console.log(`    ⚠️  Skipping DC ${dc.id} - patient not found`)
        return null
      }
      return cleaned
    }).filter(Boolean)
    console.log(`  ✓ ${validDeathCerts.length} death certificates ready for import`)

    const payload = {
      organizations,
      users,
      wards,
      patients,
      pharmacyDrugs,
      appointments,
      preTriages,
      queueItems,
      consultations,
      prescriptions,
      labOrders,
      labResults,
      radiologyOrders,
      radiologyReports,
      admissions,
      invoices,
      payments,
      pharmacySales,
      deathCertificates: validDeathCerts,
    }

    console.log('\n📤 Sending to production...')
    const response = await axios.post(`${PROD_API}/import`, payload, {
      headers: { 'x-import-secret': IMPORT_SECRET },
      timeout: 60000,
    })

    console.log('\n✅ Import Response:')
    console.log(`  Success: ${response.data.success}`)
    console.log(`  Message: ${response.data.message}`)

    if (response.data.imported) {
      console.log('\n📊 Import Summary:')
      Object.entries(response.data.imported).forEach(([key, count]) => {
        if (count > 0) console.log(`  ✓ ${key}: ${count} imported`)
      })
    }

    if (response.data.errors?.length > 0) {
      console.log('\n⚠️  Errors:')
      response.data.errors.forEach(err => console.log(`  - ${err}`))
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ Migration Complete!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('\n📝 Verify at: https://gudmed.vercel.app')
    console.log('   Login and check if your data appears in production\n')

  } catch (err) {
    console.error('\n❌ Migration failed:')
    console.error(err.message)
    if (err.response?.data) {
      console.error('\nServer response:')
      console.error(err.response.data)
    }
    process.exit(1)
  } finally {
    await localDb.$disconnect()
  }
}

main()
