// Speaking a line out loud, once, in order.
//
// WHY THIS IS NOT IN THE QUEUE: the waiting hall is the first caller, but it is
// not the only one — "your report is ready" and "collect your medicine at
// counter 2" are the same job with different words. So this file knows about
// utterances and nothing about patients, rooms or queues. What to say is the
// caller's business; saying it exactly once, in order, and not on top of itself
// is this file's.
//
// The four things that make a wall-mounted board go silently mute are all
// handled here, because every one of them is invisible when it happens:
//
//   1. Browsers refuse to make sound until the page has had a user gesture.
//      A TV nobody touches never gets one. speak() then runs, reports no error,
//      and nothing comes out. `state` is exported so a screen can SHOW that it
//      is muted rather than looking identical to "nobody has been called".
//   2. getVoices() is empty on the first call — voices arrive asynchronously.
//      The day's first announcement would otherwise pick the wrong language.
//   3. A page reload makes every waiting patient look newly flagged, so the
//      board would read the entire hall aloud at once. seed() is the answer.
//   4. The board's fallback poll re-delivers the same flagged patient every 30
//      seconds. Ids are remembered so each is spoken once and only once.

// A spoken id is remembered so it is never repeated. Queue-entry ids are minted
// per day and a board can run for weeks, so the set is bounded — oldest first.
// 2000 is far more than one hall sees in a day and costs a few KB.
const MAX_REMEMBERED = 2000

/**
 * Build an announcer over a speech engine.
 *
 * The engine is injected rather than reached for, so the ordering, de-duplication
 * and seeding rules can be tested against a fake in milliseconds instead of
 * against a real browser and a real 5-second utterance.
 *
 * @param {object} engine
 * @param {(text: string, opts: {lang: string, voice: any}) => Promise<void>} engine.speak
 * @param {() => Promise<void>} [engine.chime]      short attention tone before the words
 * @param {() => any[]} [engine.voices]             available voices, for language matching
 * @param {(ms: number) => Promise<void>} [engine.wait]
 */
export function createAnnouncer(engine) {
  const spoken = new Set()
  const order = []            // insertion order, to prune the oldest
  const pending = []
  let draining = false
  let seeded = false

  const wait = engine.wait || ((ms) => new Promise((r) => setTimeout(r, ms)))

  const state = {
    // Set true by the first utterance that actually starts. A board can read
    // this to show a speaker icon — silence and "nobody was called" look
    // identical from across a hall, and only one of them is a fault.
    heard: false,
    // Set when the requested language has no installed voice. The caller should
    // surface it: falling back to English silently means a hospital believes it
    // configured Hindi and never finds out it did not.
    languageFallback: null,
    lastError: null,
    spokenCount: 0,
  }

  function remember(id) {
    if (spoken.has(id)) return
    spoken.add(id)
    order.push(id)
    while (order.length > MAX_REMEMBERED) spoken.delete(order.shift())
  }

  /**
   * Mark ids as already announced without saying anything.
   *
   * Called with whatever is already flagged the FIRST time a board loads. Without
   * it, opening or reloading the board announces every waiting patient at once —
   * which is exactly what a wall display does after a power cut, when the hall is
   * fullest and the noise is least welcome.
   */
  function seed(ids) {
    for (const id of ids) remember(id)
    seeded = true
  }

  const hasSeeded = () => seeded

  /**
   * Pick the closest installed voice, and record it when the language is missing.
   *
   * Language first, then gender. Getting that order right matters: a hospital
   * that asked for Hindi must not be given an English female voice because it
   * also asked for a female one.
   *
   * Gender has to be matched by NAME because the Web Speech API does not expose
   * it — `SpeechSynthesisVoice` carries name, lang and localService, and nothing
   * else. Windows ships a fixed, small set, so naming them is exact rather than
   * a guess; an unrecognised voice simply doesn't match either list and the
   * language choice still stands.
   */
  const FEMALE_VOICES = /zira|kalpana|heera|swara|aarohi|neerja|jenny|aria|michelle|hazel|susan|linda|catherine|sonia|natasha|female/i
  const MALE_VOICES = /david|mark|hemant|madhur|prabhat|valluvar|guy|eric|christopher|george|ryan|male/i

  // Languages that share a writing system, so one's voice can read the other's
  // text. Only Devanagari matters here and only in one direction that helps:
  // Windows has a Hindi voice and no Marathi one, and Hindi reads Marathi.
  //
  // Telugu is deliberately absent. Its script is its own, and no voice on a
  // Windows machine can read it — an English voice handed Telugu produces noise,
  // not an accent, so pretending there is a fallback would be worse than
  // reporting there is none.
  const SAME_SCRIPT = {
    mr: ['hi'],           // Marathi  ← Hindi voice, Devanagari
    ne: ['hi'],           // Nepali
    sa: ['hi'],           // Sanskrit
    kok: ['hi'],          // Konkani
    hi: ['mr'],           // and the reverse, if only Marathi were ever installed
  }

  function voiceFor(lang, gender = 'female') {
    const voices = engine.voices ? engine.voices() : []
    if (!voices.length) return null

    const want = String(lang || '').toLowerCase()
    const base = want.split('-')[0]

    // Everything that can speak this language, best match first.
    let pool = voices.filter((v) => String(v.lang).toLowerCase() === want)
    if (!pool.length) pool = voices.filter((v) => String(v.lang).toLowerCase().startsWith(base))

    // Then a voice for a language written in the SAME SCRIPT, before English.
    //
    // Windows ships no Marathi voice — Microsoft's own Narrator voice list has
    // Hindi, Tamil and Indian English and nothing else from India. But Marathi
    // and Hindi are both written in Devanagari, and the Hindi voice reads
    // Marathi text correctly: measured at 8.9 seconds for a sentence it should
    // take ~6.6s to say, i.e. all of it.
    //
    // Falling back to English instead is not a degraded result, it is silence:
    // an English voice handed Devanagari gave up after 0.2 seconds. So a
    // same-script voice has to be tried first — it is the difference between an
    // accent and nothing at all.
    //
    // The accent IS Hindi, and a Marathi speaker should judge whether that is
    // acceptable for their hall. `languageFallback` is still set so the board
    // shows it happened rather than letting it pass unnoticed.
    if (!pool.length) {
      const kin = SAME_SCRIPT[base]
      if (kin) {
        pool = voices.filter((v) => kin.includes(String(v.lang).toLowerCase().split('-')[0]))
        if (pool.length) state.languageFallback = lang
      }
    }

    if (!pool.length) {
      state.languageFallback = lang
      pool = voices.filter((v) => String(v.lang).toLowerCase().startsWith('en'))
    }
    if (!pool.length) pool = voices

    // Then the preferred gender WITHIN that pool. If this language only ships
    // one voice, the language wins — a male Marathi voice is right where an
    // English female one is not.
    if (gender === 'female' || gender === 'male') {
      const wantRe = gender === 'female' ? FEMALE_VOICES : MALE_VOICES
      const match = pool.find((v) => wantRe.test(v.name))
      if (match) return match
    }
    return pool[0]
  }

  /**
   * Say something once.
   *
   * `id` is the de-duplication key, NOT the text: the same patient may be
   * announced with two different sentences ("be ready", then "come in"), and
   * both must be heard. Callers therefore pass something like
   * `${queueEntryId}:ready` and `${queueEntryId}:call`.
   */
  function announce({ id, text = '', lang = 'en-IN', repeat = 1, chime = true, gender = 'female' }) {
    if (!id) return false
    // Text may be deliberately empty — a board sounds a bare chime on startup to
    // prove its speakers work without reading out patients who were already
    // waiting. A call with neither words nor a chime has nothing to do.
    const words = String(text || '').trim()
    if (!words && !chime) return false
    if (spoken.has(id)) return false
    remember(id)
    pending.push({ text: words, lang, gender, repeat: Math.max(1, Math.min(3, Number(repeat) || 1)), chime })
    drain()
    return true
  }

  // Strictly one at a time. Two patients called in the same second would
  // otherwise speak over each other and neither would be understood — which is
  // worse than announcing only one of them.
  async function drain() {
    if (draining) return
    draining = true
    try {
      while (pending.length) {
        const item = pending.shift()
        const voice = voiceFor(item.lang, item.gender)
        for (let i = 0; i < item.repeat; i++) {
          try {
            if (item.chime && engine.chime) {
              await engine.chime()
              // The chime alone proves the output device works — which is the
              // whole point of the startup one, where there are no words to say.
              state.heard = true
            }
            if (item.text) {
              await engine.speak(item.text, { lang: item.lang, voice })
              state.heard = true
              state.spokenCount += 1
            }
          } catch (err) {
            // A failed utterance must not stop the queue: the NEXT patient's
            // announcement is more useful than retrying this one.
            state.lastError = err?.message || String(err)
          }
          // A gap between repeats, or the second reading runs into the first
          // and sounds like one long sentence.
          if (i < item.repeat - 1) await wait(1200)
        }
      }
    } finally {
      draining = false
    }
  }

  /** Drop everything not yet spoken — used when a board changes screen or unmounts. */
  function reset() {
    pending.length = 0
  }

  return { announce, seed, hasSeeded, reset, state, _pendingCount: () => pending.length }
}

/**
 * The real engine, over the browser's Web Speech API.
 *
 * Deliberately the ONLY part of this file that touches a browser global, so the
 * rules above can be tested against a fake instead of against a real five-second
 * utterance.
 *
 * No `setSinkId` here, and none is possible: speechSynthesis has no output-device
 * API at all (measured — `<audio>` has one, speech does not). It plays to the
 * machine's default output, which is exactly right for a display PC: whatever the
 * hospital plugged in — the TV over HDMI, or an amplifier in the hall — is chosen
 * once in Windows and this follows it.
 */
export function browserEngine() {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null

  // getVoices() is empty on the first call and fills in asynchronously, so the
  // day's first announcement would otherwise pick the wrong language — or none.
  let cached = []
  if (synth) {
    const load = () => { cached = synth.getVoices() || [] }
    load()
    synth.addEventListener?.('voiceschanged', load)
  }

  // HOLDS THE UTTERANCE ALIVE.
  //
  // Chrome garbage-collects a SpeechSynthesisUtterance that nothing references,
  // and when it does, the speech STOPS MID-SENTENCE — no error, no `end` event,
  // just a half-said announcement. Created inside a Promise the way this was,
  // the only reference lived in a closure the collector was free to take.
  // Reported as "poora word nahi bola": long sentences lost their tail, short
  // ones usually survived, which is exactly the pattern GC produces.
  let holding = null

  // ONE AudioContext, reused.
  //
  // A context created per chime starts SUSPENDED — browsers only let audio run
  // after a gesture, and a wall board never gets one. Suspended, the oscillators
  // are scheduled and simply never sound: the chime "plays" and the hall hears
  // nothing. Reusing one context lets it be resumed once and stay running, and
  // it stops leaking a context (browsers cap them at ~6 per page, after which
  // creation throws and the chime dies for good).
  let audio = null
  function audioCtx() {
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
    if (!Ctx) return null
    if (!audio || audio.state === 'closed') audio = new Ctx()
    if (audio.state === 'suspended') audio.resume?.()   // the part that was missing
    return audio
  }

  return {
    voices: () => cached,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),

    // The station chime — three rising bell notes before the words.
    //
    // Its job is to buy the first second of the sentence. Without it the
    // patient's name is already half-said before anyone in the hall has looked
    // up, and the one word that matters is the one they miss.
    //
    // Synthesised, not a downloaded file: a waiting-room board has to work when
    // the hospital's internet does not, and this is thirty lines against an
    // asset that can 404 in the one place nobody is watching.
    //
    // Why it sounds like a bell rather than a beep:
    //   · G5-B5-D6 — a major triad. Rising reads as "something is coming";
    //     a falling pair reads as "that's over", which is the wrong message.
    //   · Each note carries a quiet octave above it, detuned by half a hertz.
    //     A single sine is a test tone; two slightly-apart partials beat against
    //     each other and the ear hears warmth.
    //   · Long exponential tails that OVERLAP the next note, so it rings as one
    //     phrase instead of three separate pips.
    //   · Every level is ramped. A gain switched on at full is a hard click,
    //     and on hall speakers a click is louder than the note.
    chime: () => new Promise((resolve) => {
      const ctx = audioCtx()
      if (!ctx) return resolve()
      try {
        const t0 = ctx.currentTime + 0.02
        // Shared output stage, gently rolled off above 6 kHz — cheap PA speakers
        // turn high partials into hiss, and a hospital hall is full of hard
        // surfaces that already exaggerate them.
        const out = ctx.createGain()
        out.gain.value = 0.9
        const tone = ctx.createBiquadFilter()
        tone.type = 'lowpass'
        tone.frequency.value = 6000
        out.connect(tone); tone.connect(ctx.destination)

        const NOTES = [783.99, 987.77, 1174.66]   // G5 · B5 · D6
        const GAP = 0.26
        const RING = 1.5

        NOTES.forEach((freq, i) => {
          const at = t0 + i * GAP
          // Fundamental, plus its octave at a fifth of the level: the octave is
          // what makes it read as a bell rather than as a whistle.
          for (const [mult, level, detune] of [[1, 0.34, 0], [2, 0.07, 0.5]]) {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.value = freq * mult + detune
            osc.connect(gain); gain.connect(out)
            gain.gain.setValueAtTime(0.0001, at)
            gain.gain.exponentialRampToValueAtTime(level, at + 0.012)  // struck, not faded in
            gain.gain.exponentialRampToValueAtTime(0.0001, at + RING)  // and left to ring
            osc.start(at); osc.stop(at + RING + 0.05)
          }
        })

        // Let the last note decay, then a beat of silence before the words. Run
        // together, the chime and the first syllable mask each other.
        //
        // The context is NOT closed — it is reused for every later chime. Closing
        // it forced a new one each time, and each new one starts suspended.
        const total = (NOTES.length - 1) * GAP + RING
        setTimeout(resolve, total * 1000 + 260)
      } catch { resolve() }
    }),

    speak: (text, { lang, voice }) => new Promise((resolve, reject) => {
      if (!synth) return reject(new Error('speechSynthesis unavailable'))

      // A previous utterance still queued would make this one wait behind it —
      // and if that one was cut short, the queue can wedge. Start clean.
      synth.cancel()

      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      if (voice) u.voice = voice
      // Slightly under normal: names read at default speed run together in a
      // room with hard floors and a reverberant ceiling.
      u.rate = 0.92
      u.volume = 1
      // The reference that stops Chrome collecting it mid-sentence.
      holding = u

      let settled = false
      let keepAlive = null
      const done = (fn, arg) => {
        if (settled) return
        settled = true
        clearTimeout(guard)
        clearInterval(keepAlive)
        holding = null
        fn(arg)
      }

      u.onend = () => done(resolve)
      u.onerror = (e) => done(reject, new Error(e?.error || 'speech failed'))

      // Chrome stops speaking after about 15 seconds unless the engine is nudged.
      // pause() + resume() is the long-standing workaround; without it a long
      // announcement — and a hospital's own wording can easily run 12 seconds —
      // simply stops partway with no event at all.
      keepAlive = setInterval(() => {
        if (settled || !synth.speaking) return
        synth.pause()
        synth.resume()
      }, 10000)

      // An utterance blocked by the autoplay policy fires NEITHER onend nor
      // onerror — it simply never starts. Without this the queue would stall on
      // the first announcement of the day and never speak again. Generous,
      // because the timeout has to outlast the longest sentence a hospital
      // might type, not the shortest.
      const guard = setTimeout(
        () => done(reject, new Error('speech did not start (autoplay blocked?)')),
        60000,
      )

      synth.speak(u)
    }),
  }
}

/**
 * Fill `{name}, please come to Room {room}` with real values.
 *
 * Hospital-editable text, so an unknown placeholder must not print as `{doctor}`
 * on a public announcement — it is dropped, and the double spaces it leaves
 * behind are collapsed so the sentence still reads.
 */
export function fillTemplate(template, values = {}) {
  return String(template || '')
    .replace(/\{(\w+)\}/g, (_, key) => {
      const v = values[key]
      return v === undefined || v === null || v === '' ? '' : String(v)
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    // A placeholder that resolved to nothing leaves its punctuation behind —
    // ", Token number 127, please come to Room 3" for a walk-in with no name.
    .replace(/^[\s,.।]+/, '')
    .replace(/([,।])\1+/g, '$1')
    .trim()
}
