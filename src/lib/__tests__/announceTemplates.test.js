import test from 'node:test'
import assert from 'node:assert/strict'
import {
  templatesFor, isDefaultText, retemplate,
  ANNOUNCE_LANGUAGES, ANNOUNCE_MODES,
} from '../announceTemplates.js'
import { ORG_SETTING_FIELDS } from '../orgSettingsSchema.js'
import { fillTemplate } from '../announce.js'

// The rule the whole panel rests on: BOTH dropdowns rewrite the two sentences,
// in the same way, and neither one ever overwrites wording a hospital typed.

test('the language dropdown rewrites both sentences', () => {
  const hi = templatesFor('hi-IN', 'name')
  const before = { announceLanguage: 'hi-IN', announceSay: 'name', announceReadyText: hi.ready, announceCallText: hi.call }
  const after = retemplate(before, { lang: 'mr-IN' })
  assert.equal(after.announceReadyText, templatesFor('mr-IN', 'name').ready)
  assert.equal(after.announceCallText, templatesFor('mr-IN', 'name').call)
  assert.notEqual(after.announceReadyText, hi.ready, 'a Marathi setting must not keep Hindi words')
})

test('the ANNOUNCE-BY dropdown rewrites them too — this is what was missing', () => {
  // Language rewrote the boxes and Announce-by did not, which is
  // indistinguishable from that setting doing nothing at all.
  const mr = templatesFor('mr-IN', 'name')
  const before = { announceLanguage: 'mr-IN', announceSay: 'name', announceReadyText: mr.ready, announceCallText: mr.call }

  const token = retemplate(before, { mode: 'token' })
  assert.notEqual(token.announceCallText, mr.call, 'the sentence must change with the mode')
  assert.match(token.announceCallText, /टोकन क्रमांक \{token\}/, 'token mode addresses the token')
  assert.ok(!token.announceCallText.includes('{name}'), 'and drops the name')

  const both = retemplate(before, { mode: 'both' })
  assert.match(both.announceCallText, /\{name\}, टोकन क्रमांक \{token\}/)
})

test('every language × every mode produces both sentences', () => {
  for (const lang of ANNOUNCE_LANGUAGES) {
    for (const mode of ANNOUNCE_MODES) {
      const t = templatesFor(lang, mode)
      for (const kind of ['ready', 'call']) {
        assert.ok(t[kind] && t[kind].length > 10, `${lang}/${mode}.${kind} is empty`)
        assert.ok(t[kind].includes('{room}'), `${lang}/${mode}.${kind} lost {room}`)
        assert.ok(!t[kind].includes('{subject}'), `${lang}/${mode}.${kind} leaked the internal placeholder`)
      }
    }
  }
})

test('each mode addresses the patient the way its name says', () => {
  for (const lang of ANNOUNCE_LANGUAGES) {
    const name = templatesFor(lang, 'name').call
    const token = templatesFor(lang, 'token').call
    const both = templatesFor(lang, 'both').call

    assert.ok(name.includes('{name}') && !name.includes('{token}'), `${lang} name mode`)
    assert.ok(token.includes('{token}') && !token.includes('{name}'), `${lang} token mode`)
    assert.ok(both.includes('{name}') && both.includes('{token}'), `${lang} both mode`)
  }
})

test("a hospital's OWN wording survives BOTH dropdowns — the important one", () => {
  const mine = 'रुग्ण {name}, कृपया लगेच खोली {room} मध्ये या. — GudMed'
  const base = {
    announceLanguage: 'hi-IN', announceSay: 'name',
    announceReadyText: templatesFor('hi-IN', 'name').ready,   // untouched
    announceCallText: mine,                                    // theirs
  }
  for (const change of [{ lang: 'ta-IN' }, { mode: 'token' }, { lang: 'mr-IN', mode: 'both' }]) {
    const after = retemplate(base, change)
    assert.equal(after.announceCallText, mine, `their wording was lost by ${JSON.stringify(change)}`)
    assert.notEqual(after.announceReadyText, '', 'the untouched one still swaps')
  }
})

test('an empty box counts as untouched and gets filled', () => {
  const after = retemplate({ announceLanguage: 'en-IN', announceSay: 'name', announceReadyText: '', announceCallText: '   ' }, { lang: 'mr-IN' })
  assert.equal(after.announceReadyText, templatesFor('mr-IN', 'name').ready)
  assert.equal(after.announceCallText, templatesFor('mr-IN', 'name').call)
})

test('EVERY language in the dropdown has wording — no silent English', () => {
  const offered = ORG_SETTING_FIELDS.find((f) => f.key === 'announceLanguage').options
  assert.deepEqual(offered, ['en-IN', 'hi-IN', 'mr-IN', 'ta-IN'])
  for (const lang of offered) {
    assert.ok(ANNOUNCE_LANGUAGES.includes(lang), `${lang} is offered but has no wording`)
  }
})

test('wording from earlier versions is recognised, so nobody is stranded on it', () => {
  // These shipped before the rewrite. A hospital that never touched the text
  // must not be treated as having written its own.
  for (const old of [
    'टोकन नंबर {token}, कृपया रूम {room} में आएं।',
    '{patient}, कृपया खोली क्रमांक {room} मध्ये या.',
    'Token number {token}, please come to Room {room}.',
  ]) {
    assert.equal(isDefaultText('call', old), true, `not recognised: ${old}`)
  }
})

test('recognising old defaults does not become "anything with {token} is ours"', () => {
  const mine = 'कृपया टोकन {token} वाले मरीज़ रूम {room} में आएं — GudMed'
  assert.equal(isDefaultText('call', mine), false)
})

test('no supplied wording ever trips the panel\'s "this ignores the dropdown" warning', () => {
  // The amber warning fires when the text asks for {token} outright while the
  // mode says a name should be used. It was appearing on the app's OWN wording,
  // which told an admin their correct setting was broken.
  const warns = (mode, ready, call) => {
    const both = String(ready) + String(call)
    return mode !== 'token' && /\{token\}/.test(both) && !/\{name\}/.test(both)
  }
  for (const lang of ANNOUNCE_LANGUAGES) {
    for (const mode of ANNOUNCE_MODES) {
      const t = templatesFor(lang, mode)
      assert.equal(warns(mode, t.ready, t.call), false, `${lang}/${mode} warned about itself`)
    }
  }
})

test('the two sentences are never identical — they are different instructions', () => {
  // "You are next, stay nearby" and "come in now" must not be the same words, or
  // the patient walks to the door while the doctor is still with someone.
  for (const lang of ANNOUNCE_LANGUAGES) {
    for (const mode of ANNOUNCE_MODES) {
      const t = templatesFor(lang, mode)
      assert.notEqual(t.ready, t.call, `${lang}/${mode} says the same thing twice`)
    }
  }
})

test('each language is written in its own script, not transliterated', () => {
  assert.match(templatesFor('hi-IN', 'name').call, /[ऀ-ॿ]/, 'Hindi must be Devanagari')
  assert.match(templatesFor('mr-IN', 'name').call, /[ऀ-ॿ]/, 'Marathi must be Devanagari')
  assert.match(templatesFor('ta-IN', 'name').call, /[஀-௿]/, 'Tamil must be in Tamil script')
  assert.doesNotMatch(templatesFor('en-IN', 'name').call, /[ऀ-௿]/)
})

test('Hindi and Marathi are different words, not the same text in one script', () => {
  assert.notEqual(templatesFor('hi-IN', 'name').call, templatesFor('mr-IN', 'name').call)
  // "रूम नंबर" is shared with Hindi on purpose — hospitals asked for it, as it
  // reads more professionally than "खोली". The languages still differ in their
  // own verbs and phrasing, which is what proves this is not a copy-paste.
  assert.match(templatesFor('mr-IN', 'name').call, /मध्ये या/, 'Marathi uses मध्ये या, not Hindi में आएं')
  assert.doesNotMatch(templatesFor('hi-IN', 'name').call, /मध्ये या/)
  assert.match(templatesFor('mr-IN', 'name').ready, /तुमचा नंबर पुढे आहे/, 'Marathi keeps its own wording')
})

test('the token label is in the language, never English inside a Hindi sentence', () => {
  assert.match(templatesFor('hi-IN', 'token').call, /टोकन नंबर/)
  assert.match(templatesFor('mr-IN', 'token').call, /टोकन क्रमांक/)
  assert.match(templatesFor('ta-IN', 'token').call, /டோக்கன் எண்/)
  for (const lang of ['hi-IN', 'mr-IN', 'ta-IN']) {
    assert.doesNotMatch(templatesFor(lang, 'token').call, /Token number/i, `${lang} spoke English`)
  }
})

test('an unknown language falls back to English rather than to nothing', () => {
  assert.equal(templatesFor('zz-ZZ', 'name').call, templatesFor('en-IN', 'name').call)
})

test('filled in, every language × mode reads as a whole sentence', () => {
  for (const lang of ANNOUNCE_LANGUAGES) {
    for (const mode of ANNOUNCE_MODES) {
      const said = fillTemplate(templatesFor(lang, mode).call, { name: 'Ramesh Kumar', token: '127', room: '3' })
      assert.doesNotMatch(said, /[{}]/, `${lang}/${mode} left a placeholder unfilled`)
      assert.ok(said.includes('3'), `${lang}/${mode} lost the room`)
      if (mode !== 'name') assert.ok(said.includes('127'), `${lang}/${mode} lost the token`)
      if (mode !== 'token') assert.ok(said.includes('Ramesh'), `${lang}/${mode} lost the name`)
    }
  }
})
