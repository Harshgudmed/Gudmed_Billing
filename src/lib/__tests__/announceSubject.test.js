import test from 'node:test'
import assert from 'node:assert/strict'
import { announceSubject, announceValues, templatesFor, ANNOUNCE_LANGUAGES, ANNOUNCE_MODES } from '../announceTemplates.js'
import { fillTemplate } from '../announce.js'
import { numberWords } from '../numberWords.js'

// announceSubject resolves ONE thing: who `{name}` is when the board speaks.
// The token and the words that introduce it live in the sentence, put there by
// the "Announce by" dropdown — which is why a Hindi board can never say
// "Token number 127" in the middle of a Hindi sentence.

const NAME = 'रमेश कुमार'
const TOKEN = '127'

test('a patient with a name is announced by that name, in every mode', () => {
  for (const lang of ANNOUNCE_LANGUAGES) {
    for (const mode of ANNOUNCE_MODES) {
      assert.equal(announceSubject({ mode, name: NAME, token: TOKEN, lang }), NAME, `${lang}/${mode}`)
    }
  }
})

test('a walk-in with no name is still called — by their labelled token, in words', () => {
  // Words, not digits: the voice reads a digit string in ITS OWN language, and
  // there is no Marathi voice — the Hindi one would say "एक सौ सत्ताईस" inside a
  // Marathi announcement.
  assert.equal(announceSubject({ mode: 'name', name: '', token: TOKEN, lang: 'hi-IN' }), 'टोकन नंबर एक सौ सत्ताईस')
  assert.equal(announceSubject({ mode: 'name', name: '—', token: TOKEN, lang: 'mr-IN' }), 'टोकन क्रमांक एकशे सत्तावीस')
  assert.equal(announceSubject({ mode: 'name', name: null, token: TOKEN, lang: 'ta-IN' }), 'டோக்கன் எண் நூற்றி இருபத்தி ஏழு')
  assert.equal(announceSubject({ mode: 'name', name: '', token: TOKEN, lang: 'en-IN' }), 'Token number one hundred twenty seven')
})

test('a bare "127" is never announced — a lone number sounds like part of the sentence', () => {
  for (const lang of ANNOUNCE_LANGUAGES) {
    const said = announceSubject({ mode: 'name', token: TOKEN, lang })
    assert.notEqual(said, TOKEN, `${lang} announced the number with no label`)
    assert.ok(said.includes(numberWords(TOKEN, lang)), `${lang} lost the number: ${said}`)
    assert.doesNotMatch(said, /\d/, `${lang} left the token as digits: ${said}`)
  }
})

test('the token is never announced twice — the sentence already carries it', () => {
  // "टोकन नंबर 127, टोकन नंबर 127, कृपया रूम 3 में आएं।" — what a nameless
  // walk-in used to hear once token/both modes started putting the token in the
  // sentence itself.
  for (const mode of ['token', 'both']) {
    assert.equal(announceSubject({ mode, name: '', token: TOKEN, lang: 'hi-IN' }), '')
    const said = fillTemplate(templatesFor('hi-IN', mode).call,
      announceValues({ mode, lang: 'hi-IN', name: '', token: TOKEN, room: '3' }))
    assert.equal(said.match(/टोकन नंबर/g)?.length ?? 0, 1, `${mode} said the label twice: ${said}`)
    assert.equal(said, 'टोकन नंबर एक सौ सत्ताईस, कृपया रूम तीन में आएं।')
  }
})

test('a nameless walk-in never hears a sentence starting with a comma', () => {
  for (const lang of ANNOUNCE_LANGUAGES) {
    for (const mode of ANNOUNCE_MODES) {
      const said = fillTemplate(templatesFor(lang, mode).call,
        announceValues({ mode, lang, name: '', token: TOKEN, room: '3' }))
      assert.doesNotMatch(said, /^[\s,]/, `${lang}/${mode} began with punctuation: ${said}`)
      assert.ok(said.includes(numberWords(TOKEN, lang)), `${lang}/${mode} lost the only thing identifying them: ${said}`)
    }
  }
})

test('the board speaks NO digits at all — every number is words, in the language', () => {
  // A single digit surviving means the voice decides how to read it, and the
  // voice is Hindi even when the sentence is Marathi.
  for (const lang of ANNOUNCE_LANGUAGES) {
    for (const mode of ANNOUNCE_MODES) {
      for (const kind of ['ready', 'call']) {
        const said = fillTemplate(templatesFor(lang, mode)[kind],
          announceValues({ mode, lang, name: 'Ramesh Kumar', token: '127', room: '311', doctor: 'Dr. Sharma' }))
        assert.doesNotMatch(said, /\d/, `${lang}/${mode}/${kind} still speaks digits: ${said}`)
      }
    }
  }
})

test('a room that is a label, not a number, is spoken as it is written', () => {
  const said = fillTemplate(templatesFor('hi-IN', 'name').call,
    announceValues({ mode: 'name', lang: 'hi-IN', name: 'Ramesh', token: '7', room: 'OPD-2' }))
  assert.ok(said.includes('OPD-2'), `the room label was mangled: ${said}`)
})

test('a row with no token is still announced by name', () => {
  assert.equal(announceSubject({ mode: 'token', name: NAME, token: '', lang: 'hi-IN' }), NAME)
  assert.equal(announceSubject({ mode: 'both', name: NAME, token: null, lang: 'mr-IN' }), NAME)
})

test('no name and no token announces nothing rather than a gap', () => {
  for (const mode of ANNOUNCE_MODES) {
    assert.equal(announceSubject({ mode, name: '', token: '', lang: 'hi-IN' }), '')
  }
})

test('an unknown language still labels the token rather than dropping it', () => {
  assert.equal(announceSubject({ mode: 'name', token: TOKEN, lang: 'zz-ZZ' }), 'Token number one hundred twenty seven')
})

test('{patient} and {name} both work — the older wording must not go silent', () => {
  // {name} is the current placeholder. {patient} stays alive because a hospital
  // may already have typed it, and their board going quiet is not an acceptable
  // cost for a clearer label.
  const who = announceSubject({ mode: 'name', token: '127', lang: 'hi-IN' })
  const vals = { patient: who, name: who, room: '3' }
  assert.equal(fillTemplate('{patient}, कृपया रूम {room} में आएं।', vals), 'टोकन नंबर एक सौ सत्ताईस, कृपया रूम 3 में आएं।')
  assert.equal(fillTemplate('{name}, कृपया रूम {room} में आएं।', vals), 'टोकन नंबर एक सौ सत्ताईस, कृपया रूम 3 में आएं।')
})
