import axios from 'axios'
import fs from 'fs'

const RENDER_API = 'https://gudmed-api.onrender.com/api'
const AUTH_HEADER = { 'x-import-secret': process.env.IMPORT_SECRET || 'your-import-secret' }

async function exportData() {
  try {
    console.log('🔄 Exporting data from Render API...\n')

    // Create export by triggering a backup
    console.log('📦 Requesting data export...')

    // Unfortunately, without a dedicated export endpoint, we need to:
    // 1. Get data from key tables via the API
    // 2. Or create a dump file on Render and download it

    console.log('⚠️  Since your ISP blocks port 5432, use this alternative:\n')

    console.log('✅ SOLUTION: Use Render's built-in backup feature:')
    console.log('   1. Go to: https://dashboard.render.com')
    console.log('   2. Click on: gudmed-db (PostgreSQL)')
    console.log('   3. Look for: "Backups" section')
    console.log('   4. Create a manual backup')
    console.log('   5. Download the backup file')
    console.log('   6. Restore locally with:\n')
    console.log('      psql postgresql://postgres:password@localhost:5432/hospital_db < backup.sql\n')

    console.log('OR ask your Render support to provide a backup download.\n')

  } catch (err) {
    console.error('Error:', err.message)
  }
}

exportData()
