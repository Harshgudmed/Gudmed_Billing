// The server's role → modules table must match the web app's sidebar
// (src/lib/roleConfig.js), or a screen and the data behind it disagree. Reads
// the web app's file as text: it uses import.meta.env, which Node does not have.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ROLE_MODULES, roleWorksIn } from '../roleModules.js'

const webFile = fileURLToPath(new URL('../../../../src/lib/roleConfig.js', import.meta.url))

test('the server and the web app give every role the same modules', { skip: !existsSync(webFile) && 'web app not alongside' }, () => {
  const text = readFileSync(webFile, 'utf8')
  const block = text.slice(text.indexOf('export const ROLES'), text.indexOf('export const KNOWN_ROLES'))
  const web = {}
  for (const m of block.matchAll(/^ {2}(\w+): \{[\s\S]*?modules: \[([\s\S]*?)\]/gm)) {
    web[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1])
  }
  const { admin, ...rest } = web
  assert.ok(admin?.length > 10, 'read the administrator\'s modules')
  assert.deepEqual(Object.keys(rest).sort(), Object.keys(ROLE_MODULES).sort())
  for (const [role, modules] of Object.entries(rest)) assert.deepEqual([...modules].sort(), [...ROLE_MODULES[role]].sort(), role)
})

test('administrators and the demo work everywhere; others only in their own', () => {
  assert.equal(roleWorksIn('admin', 'inpatient'), true)
  assert.equal(roleWorksIn('super_admin', 'billing'), true)
  assert.equal(roleWorksIn(undefined, 'pharmacy'), true)
  assert.equal(roleWorksIn('billing', 'billing'), true)
  assert.equal(roleWorksIn('billing', 'patients'), false)
  assert.equal(roleWorksIn('doctor', 'opd'), true)
  assert.equal(roleWorksIn('doctor', 'pharmacy'), false)
  assert.equal(roleWorksIn('patient', 'dashboard'), false)
  assert.equal(roleWorksIn('someone_new', 'dashboard'), false)
})
