import test from 'node:test'
import assert from 'node:assert/strict'
import { ANNOUNCE_TEMPLATES, templatesFor, isDefaultText, needsOwnWording } from '../announceTemplates.js'

// Changing the language swaps the words with it. The rule that matters is the
// GUARD: a hospital that wrote its own announcement must not lose it by opening
// the dropdown.

// The swap the panel performs, in one function, so it can be tested without React.
function switchLanguage(form, lang) {
  const next = { ...form, announceLanguage: lang }
  const tpl = templatesFor(lang)
  if (isDefaultText('ready', form.announceReadyText)) next.announceReadyText = tpl.ready
  if (isDefaultText('call', form.announceCallText)) next.announceCallText = tpl.call
  return next
}

test('picking Marathi swaps Hindi defaults for Marathi ones', () => {
  const before = {
    announceLanguage: 'hi-IN',
    announceReadyText: ANNOUNCE_TEMPLATES['hi-IN'].ready,
    announceCallText: ANNOUNCE_TEMPLATES['hi-IN'].call,
  }
  const after = switchLanguage(before, 'mr-IN')
  assert.equal(after.announceReadyText, ANNOUNCE_TEMPLATES['mr-IN'].ready)
  assert.equal(after.announceCallText, ANNOUNCE_TEMPLATES['mr-IN'].call)
  // Not left in Hindi — that is the bug this exists to stop: a Marathi voice
  // handed Hindi to read.
  assert.notEqual(after.announceReadyText, ANNOUNCE_TEMPLATES['hi-IN'].ready)
})

test("a hospital's OWN wording survives a language change — this is the important one", () => {
  const mine = 'रुग्ण {name}, कृपया लगेच खोली {room} मध्ये या. — GudMed'
  const before = {
    announceLanguage: 'hi-IN',
    announceReadyText: ANNOUNCE_TEMPLATES['hi-IN'].ready,   // untouched
    announceCallText: mine,                                  // theirs
  }
  const after = switchLanguage(before, 'mr-IN')
  assert.equal(after.announceCallText, mine, 'ten minutes of their wording must not vanish')
  assert.equal(after.announceReadyText, ANNOUNCE_TEMPLATES['mr-IN'].ready, 'the untouched one still swaps')
})

test('an empty box counts as untouched and gets filled', () => {
  const after = switchLanguage({ announceReadyText: '', announceCallText: '   ' }, 'hi-IN')
  assert.equal(after.announceReadyText, ANNOUNCE_TEMPLATES['hi-IN'].ready)
  assert.equal(after.announceCallText, ANNOUNCE_TEMPLATES['hi-IN'].call)
})

test('a language with no wording falls back to English and says so', () => {
  assert.equal(needsOwnWording('ta-IN'), true)
  assert.equal(needsOwnWording('hi-IN'), false)
  assert.equal(needsOwnWording('mr-IN'), false)
  // English, not blank — a silent board is worse than an English one.
  assert.equal(templatesFor('ta-IN').call, ANNOUNCE_TEMPLATES['en-IN'].call)
})

test('every template carries both placeholders the board fills', () => {
  for (const [lang, tpl] of Object.entries(ANNOUNCE_TEMPLATES)) {
    for (const kind of ['ready', 'call']) {
      assert.ok(tpl[kind].includes('{name}'), `${lang}.${kind} must carry {name}`)
      assert.ok(tpl[kind].includes('{room}'), `${lang}.${kind} must carry {room}`)
    }
  }
})

test('the two sentences are never identical — they are different instructions', () => {
  // "You are next, stay nearby" and "come in now" must not be the same words, or
  // the patient walks to the door while the doctor is still with someone.
  for (const [lang, tpl] of Object.entries(ANNOUNCE_TEMPLATES)) {
    assert.notEqual(tpl.ready, tpl.call, `${lang} says the same thing twice`)
  }
})

test('the English variants share one text rather than three that can drift', () => {
  assert.equal(ANNOUNCE_TEMPLATES['en-US'].call, ANNOUNCE_TEMPLATES['en-IN'].call)
  assert.equal(ANNOUNCE_TEMPLATES['en-GB'].ready, ANNOUNCE_TEMPLATES['en-IN'].ready)
})
