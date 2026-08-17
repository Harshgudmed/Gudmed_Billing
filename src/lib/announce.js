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

  /** Pick the closest installed voice, and record it when the language is missing. */
  function voiceFor(lang) {
    const voices = engine.voices ? engine.voices() : []
    if (!voices.length) return null
    const want = String(lang || '').toLowerCase()
    const exact = voices.find((v) => String(v.lang).toLowerCase() === want)
    if (exact) return exact
    // hi-IN → any hi-*; en-IN → any en-*
    const base = want.split('-')[0]
    const sameLanguage = voices.find((v) => String(v.lang).toLowerCase().startsWith(base))
    if (sameLanguage) return sameLanguage
    state.languageFallback = lang
    return voices.find((v) => String(v.lang).toLowerCase().startsWith('en')) || voices[0]
  }

  /**
   * Say something once.
   *
   * `id` is the de-duplication key, NOT the text: the same patient may be
   * announced with two different sentences ("be ready", then "come in"), and
   * both must be heard. Callers therefore pass something like
   * `${queueEntryId}:ready` and `${queueEntryId}:call`.
   */
  function announce({ id, text, lang = 'en-IN', repeat = 1, chime = true }) {
    if (!id || !text) return false
    if (spoken.has(id)) return false
    remember(id)
    pending.push({ text, lang, repeat: Math.max(1, Math.min(3, Number(repeat) || 1)), chime })
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
        const voice = voiceFor(item.lang)
        for (let i = 0; i < item.repeat; i++) {
          try {
            if (item.chime && engine.chime) await engine.chime()
            await engine.speak(item.text, { lang: item.lang, voice })
            state.heard = true
            state.spokenCount += 1
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
      const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
      if (!Ctx) return resolve()
      try {
        const ctx = new Ctx()
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
        const total = (NOTES.length - 1) * GAP + RING
        setTimeout(() => { ctx.close?.(); resolve() }, total * 1000 + 260)
      } catch { resolve() }
    }),

    speak: (text, { lang, voice }) => new Promise((resolve, reject) => {
      if (!synth) return reject(new Error('speechSynthesis unavailable'))
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      if (voice) u.voice = voice
      // Slightly under normal: names read at default speed run together in a
      // room with hard floors and a reverberant ceiling.
      u.rate = 0.92
      let settled = false
      const done = (fn, arg) => { if (!settled) { settled = true; fn(arg) } }
      u.onend = () => done(resolve)
      u.onerror = (e) => done(reject, new Error(e?.error || 'speech failed'))
      // An utterance blocked by the autoplay policy fires NEITHER onend nor
      // onerror — it simply never starts. Without this the queue would stall on
      // the first announcement of the day and never speak again.
      const guard = setTimeout(() => done(reject, new Error('speech did not start (autoplay blocked?)')), 15000)
      const clear = () => clearTimeout(guard)
      u.addEventListener('end', clear)
      u.addEventListener('error', clear)
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
    .trim()
}
