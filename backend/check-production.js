import axios from 'axios'

const PROD_API = 'https://gudmed-api.onrender.com/api'

async function check() {
  try {
    console.log('Checking production database state...\n')

    // Try to get health without auth
    const health = await axios.get(`${PROD_API}/`, {
      headers: { Authorization: 'Bearer test' }
    })

    console.log('✅ Backend is running')

    // Get auth endpoint to see what it expects
    console.log('\n📋 Production Status:')
    console.log('  Backend URL: ' + PROD_API)
    console.log('  Response: ' + health.data.message)

    console.log('\n💡 To create death certificates:')
    console.log('  1. Login to: https://gudmed.vercel.app')
    console.log('  2. Use credentials from backend/.env (admin user)')
    console.log('  3. Go to Patients, verify you have patients')
    console.log('  4. Go to Death Certificates → New')
    console.log('  5. Select patient from dropdown → Fill form → Save')

    console.log('\n⚠️  If you see FK error:')
    console.log('  → Reason: Patient might have been deleted or ID mismatch')
    console.log('  → Fix: Ensure patient exists in Patients module first')

  } catch (err) {
    console.error('Error:', err.message)
    if (err.response?.status === 401) {
      console.log('\n✅ API is running (401 = need auth, which is correct)')
    }
  }
}

check()
