import 'dotenv/config'

const SID   = process.env.TWILIO_ACCOUNT_SID || ''
const TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const auth  = Buffer.from(`${SID}:${TOKEN}`).toString('base64')

const res = await fetch('https://api.twilio.com/2010-04-01/Accounts.json', {
  headers: { Authorization: `Basic ${auth}` },
})
let out = 'HTTP ' + res.status + '\n'
const data = await res.json()
if (data.accounts) {
  for (const a of data.accounts) {
    out += `ACCOUNT ${a.sid} | ${a.friendly_name} | ${a.status}\n`
  }
} else {
  out += 'BODY ' + JSON.stringify(data) + '\n'
}
out += 'ENV_SID ' + SID + '\n'

const fs = await import('fs')
fs.writeFileSync('C:/Users/Dell/Desktop/migrations/backend/who-result.txt', out)
