import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withoutSecrets, keepSecrets } from '../settingsSecrets.js'

const stored = {
  refundMode: 'approval',
  integrations: {
    sms: { enabled: true, provider: 'msg91', apiKey: 'SMS-KEY-123' },
    eapts: { enabled: false, apiKey: '' },
    email: { host: 'smtp.x', user: 'u', passwordEnc: 'sealed:abc' },
  },
}

test('a secret is never sent; the screen is told it is saved', () => {
  const out = withoutSecrets(stored)
  assert.equal(JSON.stringify(out).includes('SMS-KEY-123'), false)
  assert.equal(JSON.stringify(out).includes('sealed:abc'), false)
  assert.equal(out.integrations.sms.apiKeySaved, true)
  assert.equal(out.integrations.email.passwordEncSaved, true)
  assert.equal(out.integrations.eapts.apiKeySaved, undefined) // an empty key is not "saved"
  assert.equal(out.integrations.sms.provider, 'msg91')
  assert.equal(out.refundMode, 'approval')
  assert.equal(stored.integrations.sms.apiKey, 'SMS-KEY-123') // the stored copy is untouched
})

test('saving the settings back without the secrets keeps them', () => {
  const fromScreen = { ...withoutSecrets(stored), refundMode: 'instant' }
  const saved = keepSecrets(fromScreen, stored)
  assert.equal(saved.integrations.sms.apiKey, 'SMS-KEY-123')
  assert.equal(saved.integrations.email.passwordEnc, 'sealed:abc')
  assert.equal(saved.integrations.sms.apiKeySaved, undefined)
  assert.equal(saved.refundMode, 'instant')
})

test('a blank box keeps the key; a typed one replaces it', () => {
  const blank = keepSecrets({ integrations: { sms: { enabled: true, apiKey: '' } } }, stored)
  assert.equal(blank.integrations.sms.apiKey, 'SMS-KEY-123')
  const typed = keepSecrets({ integrations: { sms: { enabled: true, apiKey: 'NEW-KEY' } } }, stored)
  assert.equal(typed.integrations.sms.apiKey, 'NEW-KEY')
})

test('a save that leaves out the integrations keeps them all', () => {
  const saved = keepSecrets({ refundMode: 'instant' }, stored)
  assert.deepEqual(saved.integrations, stored.integrations)
})

test('nothing stored and nothing typed stays empty', () => {
  const saved = keepSecrets({ integrations: { sms: { apiKey: '' } } }, {})
  assert.equal(saved.integrations.sms.apiKey, '')
  assert.equal(withoutSecrets({}).integrations, undefined)
})
