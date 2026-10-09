// Which modules work for a hospital: bought (modulesAllowed, the platform
// owner's) AND on (modulesEnabled, the administrator's). The server's toggles
// must also match the web app's, or a screen and its API disagree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MODULE_TOGGLE, moduleWorks, turnedOnBeyondPlan, parseModuleMap } from '../modules.js'
import { ROLE_MODULES } from '../roleModules.js'

const webFile = fileURLToPath(new URL('../../../../src/lib/roleConfig.js', import.meta.url))
const hospital = (modulesAllowed, modulesEnabled) => ({ modulesAllowed, modulesEnabled })

test('the server and the web app give every module the same toggle', { skip: !existsSync(webFile) && 'web app not alongside' }, () => {
  const text = readFileSync(webFile, 'utf8')
  const block = text.slice(text.indexOf('export const MODULES'), text.indexOf('export const ROLES'))
  const web = {}
  for (const m of block.matchAll(/^ {2}(\w+): +\{[^}]*toggle: (null|'\w+')/gm)) {
    web[m[1]] = m[2] === 'null' ? null : m[2].slice(1, -1)
  }
  assert.ok(Object.keys(web).length > 15, 'read the web app\'s modules')
  assert.deepEqual(MODULE_TOGGLE, web)
})

test('every module a role works in has a toggle here', () => {
  for (const modules of Object.values(ROLE_MODULES)) {
    for (const module of modules) assert.ok(Object.hasOwn(MODULE_TOGGLE, module), module)
  }
})

test('a hospital with no plan yet (modulesAllowed NULL) keeps everything it had', () => {
  assert.equal(moduleWorks('pharmacy', hospital(null, '{}')), true)
  assert.equal(moduleWorks('laboratory', hospital(null, '{"inpatient":false}')), true)
  assert.equal(moduleWorks('inpatient', hospital(null, '{"inpatient":false}')), false)
})

test('Purchase stays off until switched on, with or without a plan', () => {
  assert.equal(moduleWorks('purchase', hospital(null, '{}')), false)
  assert.equal(moduleWorks('purchase', hospital(null, '{"purchase":true}')), true)
  assert.equal(moduleWorks('purchase', hospital('{"purchase":true}', '{}')), false)
  assert.equal(moduleWorks('purchase', hospital('{"purchase":true}', '{"purchase":true}')), true)
  assert.equal(moduleWorks('storeIndent', hospital('{"purchase":true}', '{"purchase":true}')), true)
  assert.equal(moduleWorks('storeIndent', hospital('{"queue":true}', '{"purchase":true}')), false)
})

test('a bought module works until the administrator switches it off, and again when switched on', () => {
  const plan = '{"queue":true}'
  assert.equal(moduleWorks('queue', hospital(plan, '{}')), true)
  assert.equal(moduleWorks('queue', hospital(plan, '{"queue":false}')), false)
  assert.equal(moduleWorks('queue', hospital(plan, '{"queue":true}')), true)
})

test('a module that is not bought stays shut, whatever the administrator set', () => {
  const plan = '{"queue":true}'
  assert.equal(moduleWorks('pharmacy', hospital(plan, '{}')), false)
  assert.equal(moduleWorks('pharmacy', hospital(plan, '{"pharmacy":true}')), false)
})

test('modules that cannot be switched off work whatever the plan says', () => {
  for (const module of ['dashboard', 'appointments', 'billing', 'settings']) {
    assert.equal(moduleWorks(module, hospital('{}', '{}')), true, module)
  }
})

test('unknown modules and unreadable switches are refused, never allowed', () => {
  assert.equal(moduleWorks('nope', hospital(null, '{}')), false)
  assert.equal(moduleWorks('__proto__', hospital(null, '{}')), false)
  assert.equal(moduleWorks('queue', hospital('not json', '{}')), false)
  assert.equal(moduleWorks('queue', hospital('[1,2]', '{}')), false)
  assert.equal(moduleWorks('queue', undefined), true, 'no row: nothing limits it')
  assert.deepEqual(parseModuleMap('not json'), {})
  assert.deepEqual(parseModuleMap('null'), {})
})

test('the administrator cannot switch ON what the hospital has not bought', () => {
  const plan = '{"queue":true}'
  assert.deepEqual(turnedOnBeyondPlan({ pharmacy: true }, {}, plan), ['pharmacy'])
  assert.deepEqual(turnedOnBeyondPlan({ queue: true, pharmacy: true, opd: true }, {}, plan), ['pharmacy', 'opd'])
  assert.deepEqual(turnedOnBeyondPlan({ queue: true }, {}, plan), [])
  assert.deepEqual(turnedOnBeyondPlan({ pharmacy: false }, { pharmacy: true }, plan), [], 'switching off is always allowed')
  assert.deepEqual(turnedOnBeyondPlan({ pharmacy: true }, {}, null), [], 'no plan yet: no limit')
  assert.deepEqual(turnedOnBeyondPlan({ pharmacy: true }, { pharmacy: true }, plan), [], 'left as it was: not a new switch-on')
  assert.deepEqual(turnedOnBeyondPlan('not json', {}, plan), [])
})
