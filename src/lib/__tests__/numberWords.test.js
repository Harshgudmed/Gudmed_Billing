import test from 'node:test'
import assert from 'node:assert/strict'
import { numberWords, NUMBER_WORD_LANGUAGES } from '../numberWords.js'

// Room 311 is the case that started this: the Hindi voice reads a Marathi
// sentence, so "311" came out as "तीन सौ ग्यारह" in the middle of Marathi.

test('the room number is spoken in the sentence\'s own language', () => {
  assert.equal(numberWords('311', 'en-IN'), 'three hundred eleven')
  assert.equal(numberWords('311', 'hi-IN'), 'तीन सौ ग्यारह')
  assert.equal(numberWords('311', 'mr-IN'), 'तीनशे अकरा')
  assert.equal(numberWords('311', 'ta-IN'), 'முந்நூற்றி பதினொன்று')
})

test('Marathi is not just Hindi in the same script', () => {
  // Hindi and Marathi genuinely share their small numbers — तीन is तीन in both —
  // so only the numbers where the two languages differ prove the conversion is
  // doing anything. If these ever match, Marathi is back to Hindi numbers.
  for (const n of [11, 19, 27, 45, 58, 99, 100, 311, 1204]) {
    assert.notEqual(numberWords(String(n), 'mr-IN'), numberWords(String(n), 'hi-IN'), `${n} still reads as Hindi`)
  }
})

test('every language is written in its own script', () => {
  for (const n of [7, 45, 311]) {
    assert.match(numberWords(String(n), 'en-IN'), /^[a-z ]+$/)
    assert.match(numberWords(String(n), 'hi-IN'), /[ऀ-ॿ]/)
    assert.match(numberWords(String(n), 'mr-IN'), /[ऀ-ॿ]/)
    assert.match(numberWords(String(n), 'ta-IN'), /[஀-௿]/)
  }
})

test('a token a receptionist actually issues is read correctly', () => {
  for (const [n, hi, mr] of [
    ['1', 'एक', 'एक'],
    ['7', 'सात', 'सात'],
    ['12', 'बारह', 'बारा'],
    ['19', 'उन्नीस', 'एकोणीस'],
    ['21', 'इक्कीस', 'एकवीस'],
    ['40', 'चालीस', 'चाळीस'],
    ['58', 'अट्ठावन', 'अठ्ठावन्न'],
    ['99', 'निन्यानवे', 'नव्व्याण्णव'],
  ]) {
    assert.equal(numberWords(n, 'hi-IN'), hi, `hi ${n}`)
    assert.equal(numberWords(n, 'mr-IN'), mr, `mr ${n}`)
  }
})

test('a round hundred keeps its standalone form, not the joining one', () => {
  // "நூற்றி" and "एकशे" are the shapes used when something follows. Said alone
  // they are wrong, and a listener hears it immediately.
  assert.equal(numberWords('100', 'mr-IN'), 'शंभर')
  assert.equal(numberWords('100', 'ta-IN'), 'நூறு')
  assert.equal(numberWords('300', 'ta-IN'), 'முந்நூறு')
  assert.equal(numberWords('101', 'mr-IN'), 'एकशे एक')
  assert.equal(numberWords('101', 'ta-IN'), 'நூற்றி ஒன்று')
})

test('a four-digit room number still reads as one number', () => {
  assert.equal(numberWords('1204', 'en-IN'), 'one thousand two hundred four')
  assert.equal(numberWords('1204', 'hi-IN'), 'एक हज़ार दो सौ चार')
  assert.equal(numberWords('1204', 'mr-IN'), 'एक हजार दोनशे चार')
  assert.equal(numberWords('1000', 'ta-IN'), 'ஆயிரம்')
  assert.equal(numberWords('1204', 'ta-IN'), 'ஆயிரத்தி இருநூற்றி நான்கு')
})

test('a room that is not a number is left exactly as it is', () => {
  // Rooms are labels as often as numbers. Converting "OPD-2" would destroy the
  // only direction the patient is given.
  for (const label of ['OPD-2', 'Ground Floor', 'A-101', 'ICU', '3A', '', '  ']) {
    assert.equal(numberWords(label, 'hi-IN'), label.trim(), `mangled ${JSON.stringify(label)}`)
  }
})

test('a token longer than four digits is left to the voice rather than guessed at', () => {
  // Legacy tokens minted by Math.random ran to six digits. Words for those would
  // be a paragraph; the digits are the honest fallback.
  assert.equal(numberWords('759407', 'hi-IN'), '759407')
  assert.equal(numberWords('OPD20260716-759407', 'hi-IN'), 'OPD20260716-759407')
})

test('every whole number a hospital can reach converts without crashing or leaving digits', () => {
  for (const lang of NUMBER_WORD_LANGUAGES) {
    for (let n = 0; n <= 9999; n++) {
      const said = numberWords(String(n), lang)
      assert.ok(said && said.length > 0, `${lang} ${n} produced nothing`)
      assert.doesNotMatch(said, /\d/, `${lang} ${n} left a digit in: ${said}`)
      assert.doesNotMatch(said, /undefined/, `${lang} ${n} hit a gap in the table: ${said}`)
      assert.doesNotMatch(said, /\s{2,}|^\s|\s$/, `${lang} ${n} has stray spacing: "${said}"`)
    }
  }
})

test('zero and missing values do not produce an empty announcement', () => {
  assert.equal(numberWords('0', 'hi-IN'), 'शून्य')
  assert.equal(numberWords(null, 'hi-IN'), '')
  assert.equal(numberWords(undefined, 'hi-IN'), '')
})

test('an unknown language falls back to English rather than crashing', () => {
  assert.equal(numberWords('311', 'zz-ZZ'), 'three hundred eleven')
})

test('a number passed as a number, not a string, still works', () => {
  assert.equal(numberWords(7, 'mr-IN'), 'सात')
  assert.equal(numberWords(311, 'hi-IN'), 'तीन सौ ग्यारह')
})
