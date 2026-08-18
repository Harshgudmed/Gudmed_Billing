import test from 'node:test'
import assert from 'node:assert/strict'
import { createAnnouncer, fillTemplate } from '../announce.js'

// A fake speech engine: records what was said, in order, and resolves instantly.
// The real one takes ~5 seconds per utterance, which is why the ordering and
// de-duplication rules are tested against this instead of against a browser.
function fakeEngine({ voices = [{ lang: 'en-US', name: 'David' }], failOn = null, silent = false } = {}) {
  const said = []
  const chimes = []
  let speaking = 0
  let overlapped = false
  return {
    said,
    chimes,
    get overlapped() { return overlapped },
    voices: () => voices,
    wait: () => Promise.resolve(),
    // `silent` is the autoplay-blocked page: NOTHING reaches the speakers, so
    // the chime fails too. A fake whose chime always works cannot represent
    // that, and would let a mute board test as healthy.
    chime: async () => { if (silent) throw new Error('blocked'); chimes.push(said.length) },
    speak: async (text, opts) => {
      if (failOn && text.includes(failOn)) throw new Error('voice unavailable')
      // If a second utterance starts while one is running, the hall hears both
      // at once and understands neither.
      if (speaking > 0) overlapped = true
      speaking += 1
      await Promise.resolve()
      speaking -= 1
      said.push({ text, lang: opts.lang, voice: opts.voice?.name ?? null })
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

test('the 30-second fallback poll re-sends the same patient and must not re-announce them', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  a.announce({ id: 'q1:ready', text: 'Ramesh, you are next' })
  a.announce({ id: 'q1:ready', text: 'Ramesh, you are next' }) // the poll, 30s later
  a.announce({ id: 'q1:ready', text: 'Ramesh, you are next' }) // and again
  await tick()

  assert.equal(eng.said.length, 1, 'the hall should hear Ramesh once, not three times')
})

test('the same patient still gets BOTH the be-ready and the come-in announcement', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  // Two different sentences about one patient — de-duplication keys on the id,
  // and the id carries which of the two it is.
  a.announce({ id: 'q1:ready', text: 'Ramesh, you are next' })
  a.announce({ id: 'q1:call', text: 'Ramesh, please come to Room 3' })
  await tick()

  assert.deepEqual(eng.said.map((s) => s.text), [
    'Ramesh, you are next',
    'Ramesh, please come to Room 3',
  ])
})

test('two patients called in the same second are read one after the other, never on top', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  a.announce({ id: 'q1:call', text: 'Ramesh to Room 3' })
  a.announce({ id: 'q2:call', text: 'Suresh to Room 5' })
  a.announce({ id: 'q3:call', text: 'Mahesh to Room 7' })
  await tick(); await tick(); await tick()

  assert.equal(eng.overlapped, false, 'utterances overlapped — the hall would understand neither')
  assert.equal(eng.said.length, 3)
  assert.deepEqual(eng.said.map((s) => s.text), ['Ramesh to Room 3', 'Suresh to Room 5', 'Mahesh to Room 7'])
})

test('reloading the board does not read the whole waiting hall aloud', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  // First payload after a reload: five patients are already flagged.
  a.seed(['q1:ready', 'q2:ready', 'q3:ready', 'q4:ready', 'q5:ready'])
  for (const id of ['q1:ready', 'q2:ready', 'q3:ready', 'q4:ready', 'q5:ready']) {
    a.announce({ id, text: 'someone' })
  }
  await tick()
  assert.equal(eng.said.length, 0, 'a power cut should not make the board recite the queue')

  // The next patient flagged AFTER the reload is announced normally.
  a.announce({ id: 'q6:ready', text: 'Kavita, you are next' })
  await tick()
  assert.deepEqual(eng.said.map((s) => s.text), ['Kavita, you are next'])
})

test('a missing Hindi voice falls back to English and SAYS so, instead of going quiet', async () => {
  const eng = fakeEngine({ voices: [{ lang: 'en-US', name: 'David' }] })
  const a = createAnnouncer(eng)

  a.announce({ id: 'q1:call', text: 'Ramesh, Room 3 me aayein', lang: 'hi-IN' })
  await tick()

  assert.equal(eng.said.length, 1, 'it must still be announced')
  assert.equal(eng.said[0].voice, 'David')
  assert.equal(a.state.languageFallback, 'hi-IN', 'the hospital must be able to see the pack is missing')
})

test('an installed Hindi voice is used and reports no fallback', async () => {
  const eng = fakeEngine({ voices: [{ lang: 'en-US', name: 'David' }, { lang: 'hi-IN', name: 'Swara' }] })
  const a = createAnnouncer(eng)

  a.announce({ id: 'q1:call', text: 'Ramesh, Room 3 me aayein', lang: 'hi-IN' })
  await tick()

  assert.equal(eng.said[0].voice, 'Swara')
  assert.equal(a.state.languageFallback, null)
})

test('one failed utterance does not silence the patients behind it', async () => {
  const eng = fakeEngine({ failOn: 'Suresh' })
  const a = createAnnouncer(eng)

  a.announce({ id: 'q1:call', text: 'Ramesh to Room 3' })
  a.announce({ id: 'q2:call', text: 'Suresh to Room 5' })   // throws
  a.announce({ id: 'q3:call', text: 'Mahesh to Room 7' })
  await tick(); await tick(); await tick()

  assert.deepEqual(eng.said.map((s) => s.text), ['Ramesh to Room 3', 'Mahesh to Room 7'])
  assert.match(a.state.lastError, /voice unavailable/)
})

test('repeat says it twice with the chime once before each reading', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  a.announce({ id: 'q1:call', text: 'Ramesh to Room 3', repeat: 2 })
  await tick(); await tick()

  assert.equal(eng.said.length, 2, 'nobody hears it the first time')
  assert.equal(eng.chimes.length, 2)
})

test('repeat is clamped — a bad setting cannot make the board talk over the next call', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  a.announce({ id: 'q1:call', text: 'x', repeat: 99 })
  await tick(); await tick(); await tick(); await tick()

  assert.equal(eng.said.length, 3, '99 repeats would hold the queue for minutes')
})

test('a page whose audio is blocked never reads as working — silence is a fault worth showing', async () => {
  // The autoplay policy stops EVERYTHING, chime included, and tells the page
  // nothing. From across a hall that is indistinguishable from "nobody has been
  // called", so the board has to be able to tell the two apart.
  const blocked = fakeEngine({ silent: true, failOn: 'Ramesh' })
  const a = createAnnouncer(blocked)

  assert.equal(a.state.heard, false)
  a.announce({ id: 'q1:call', text: 'Ramesh to Room 3' })
  await tick()
  assert.equal(a.state.heard, false, 'nothing reached the speakers, so nothing may be claimed')

  const ok = createAnnouncer(fakeEngine())
  ok.announce({ id: 'q2:call', text: 'Suresh to Room 5' })
  await tick()
  assert.equal(ok.state.heard, true)
})

test('the startup chime plays with no words — that is how a board proves its speakers work', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  const queued = a.announce({ id: '__ready__', text: '', chime: true })
  await tick()

  assert.equal(queued, true)
  assert.equal(eng.chimes.length, 1, 'the chime must sound')
  assert.equal(eng.said.length, 0, 'but nobody already waiting may be announced')
  assert.equal(a.state.heard, true, 'and it clears the "sound not started" warning')
  assert.equal(a.state.spokenCount, 0, 'it is not an announcement')
})

test('a call with neither words nor a chime does nothing at all', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)
  assert.equal(a.announce({ id: 'x', text: '', chime: false }), false)
  await tick()
  assert.equal(eng.chimes.length + eng.said.length, 0)
})

test('a chime that plays while the VOICE fails still proves the speakers are alive', async () => {
  // Different fault, different answer: if the chime came out, the output device
  // works and the problem is the voice — telling staff "no sound" would send
  // them to check the wrong thing.
  const eng = fakeEngine({ failOn: 'Ramesh' })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'Ramesh to Room 3' })
  await tick()

  assert.equal(eng.chimes.length, 1)
  assert.equal(eng.said.length, 0, 'the voice failed')
  assert.equal(a.state.heard, true, 'but audio itself is fine')
})

// ── which voice reads it ────────────────────────────────────────────────────
// This machine's real set, in the order Windows lists them — which is why the
// male Hindi voice was being picked before this existed.
const WINDOWS_VOICES = [
  { lang: 'en-US', name: 'Microsoft David - English (United States)' },
  { lang: 'en-US', name: 'Microsoft Mark - English (United States)' },
  { lang: 'en-US', name: 'Microsoft Zira - English (United States)' },
  { lang: 'hi-IN', name: 'Microsoft Hemant - Hindi (India)' },
  { lang: 'hi-IN', name: 'Microsoft Kalpana - Hindi (India)' },
]

test('a female voice is chosen even when Windows lists the male one first', async () => {
  const eng = fakeEngine({ voices: WINDOWS_VOICES })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'Room 3', lang: 'hi-IN', gender: 'female' })
  await tick()
  assert.match(eng.said[0].voice, /Kalpana/, 'Hemant is listed first and was being picked')
})

test('asking for male still gets male', async () => {
  const eng = fakeEngine({ voices: WINDOWS_VOICES })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'Room 3', lang: 'hi-IN', gender: 'male' })
  await tick()
  assert.match(eng.said[0].voice, /Hemant/)
})

test('LANGUAGE beats gender — a Marathi hospital is never handed an English voice', async () => {
  // Only a male Marathi voice installed. Asking for female must NOT fall back to
  // English Zira: an English voice reading Marathi text is far worse than a male
  // voice reading it correctly.
  const eng = fakeEngine({
    voices: [...WINDOWS_VOICES, { lang: 'mr-IN', name: 'Microsoft Manohar - Marathi (India)' }],
  })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'खोली 3', lang: 'mr-IN', gender: 'female' })
  await tick()
  assert.match(eng.said[0].voice, /Manohar/, 'the Marathi voice must win over the female English one')
  assert.equal(a.state.languageFallback, null, 'and this is not a language fallback')
})

test('"any" takes whatever the language offers first', async () => {
  const eng = fakeEngine({ voices: WINDOWS_VOICES })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'Room 3', lang: 'hi-IN', gender: 'any' })
  await tick()
  assert.match(eng.said[0].voice, /Hemant/)
})

test('an unknown voice name still gets used rather than leaving the board silent', async () => {
  const eng = fakeEngine({ voices: [{ lang: 'hi-IN', name: 'SomeVendor Neural Voice 7' }] })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'Room 3', lang: 'hi-IN', gender: 'female' })
  await tick()
  assert.equal(eng.said.length, 1, 'no name match, but the language match still stands')
  assert.match(eng.said[0].voice, /SomeVendor/)
})

test('MARATHI falls back to the HINDI voice, not English — same script, so it can be read', async () => {
  // Windows ships no Marathi voice. English handed Devanagari gives up after
  // 0.2 seconds — measured. The Hindi voice reads Marathi text in full.
  // Falling back to English here is not a worse accent, it is silence.
  const eng = fakeEngine({ voices: [
    { lang: 'en-US', name: 'Microsoft Zira - English (United States)' },
    { lang: 'hi-IN', name: 'Microsoft Kalpana - Hindi (India)' },
  ] })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'कृपया खोली क्रमांक चार मध्ये या.', lang: 'mr-IN' })
  await tick()

  assert.match(eng.said[0].voice, /Kalpana/, 'must use the Hindi voice, not Zira')
  assert.equal(a.state.languageFallback, 'mr-IN', 'and must still report that it fell back')
})

test('TELUGU has no same-script fallback and says so — its script is its own', async () => {
  // No voice on a Windows machine can read Telugu. Pretending otherwise would
  // hand it to English, which produces noise rather than an accent.
  const eng = fakeEngine({ voices: [
    { lang: 'en-US', name: 'Microsoft Zira - English (United States)' },
    { lang: 'hi-IN', name: 'Microsoft Kalpana - Hindi (India)' },
  ] })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'దయచేసి గది కి రండి', lang: 'te-IN' })
  await tick()

  assert.match(eng.said[0].voice, /Zira/, 'English, because there is nothing closer')
  assert.equal(a.state.languageFallback, 'te-IN', 'the hospital must be told')
})

test('an installed Marathi voice is preferred over the Hindi one', async () => {
  const eng = fakeEngine({ voices: [
    { lang: 'hi-IN', name: 'Microsoft Kalpana - Hindi (India)' },
    { lang: 'mr-IN', name: 'Microsoft Aarohi - Marathi (India)' },
  ] })
  const a = createAnnouncer(eng)
  a.announce({ id: 'q1:call', text: 'खोली चार', lang: 'mr-IN' })
  await tick()

  assert.match(eng.said[0].voice, /Aarohi/)
  assert.equal(a.state.languageFallback, null, 'a real match is not a fallback')
})

test('a board running for weeks does not grow its memory without limit', async () => {
  const eng = fakeEngine()
  const a = createAnnouncer(eng)

  for (let i = 0; i < 2500; i++) a.announce({ id: `q${i}:call`, text: `p${i}` })
  await tick()

  // The oldest ids are forgotten, so the very first patient could in principle be
  // announced again — 2000 entries later, in a different clinic session. That is
  // the right trade: an unbounded Set on a screen that never reloads is not.
  assert.equal(a.announce({ id: 'q0:call', text: 'p0' }), true)
  assert.equal(a.announce({ id: 'q2499:call', text: 'p2499' }), false, 'recent ids must still be remembered')
})

// ── fillTemplate ────────────────────────────────────────────────────────────

test('a placeholder with no value is dropped, not printed as {doctor} over the speakers', () => {
  assert.equal(
    fillTemplate('{name}, please come to Room {room}. {doctor}', { name: 'Ramesh', room: '3' }),
    'Ramesh, please come to Room 3.',
  )
})

test('an empty value does not leave a double space or a floating comma', () => {
  assert.equal(fillTemplate('{name}, {doctor} is ready', { name: 'Ramesh', doctor: '' }), 'Ramesh, is ready')
  assert.equal(fillTemplate('{a} {b} {c}', { b: 'only' }), 'only')
})

test('a hospital can write the whole sentence in Hindi', () => {
  assert.equal(
    fillTemplate('{name}, kripya Room {room} me aayein.', { name: 'रमेश कुमार', room: '3' }),
    'रमेश कुमार, kripya Room 3 me aayein.',
  )
})

test('a name with an apostrophe survives — O\'Brien is a real patient name', () => {
  assert.equal(fillTemplate('{name} to Room {room}', { name: "O'Brien", room: '2' }), "O'Brien to Room 2")
})
