import { useEffect, useRef, useState } from 'react'
import { createAnnouncer, browserEngine, fillTemplate } from '@/lib/announce'
import { readOrgSettings } from '@/lib/orgSettingsSchema'
import { shortToken } from './utils'
import { announceValues, templatesFor, isDefaultText } from '@/lib/announceTemplates'

// Turns the board's columns into spoken announcements.
//
// This is the ONLY file that knows a queue exists — src/lib/announce.js is the
// speaking, and this is the mapping from "what the board is showing" to "what
// should be said". Kept apart because "your report is ready" and "collect your
// medicine" will want the speaking without any of this.
//
// TWO announcements per patient, and they are two different instructions:
//
//   status 'called'      → "you are next, stay near Room 3"   ← must NOT bring
//                                                               them to the door
//   status 'in_progress' → "please come to Room 3"            ← now it must
//
// One combined sentence can only do one of those jobs, and doing the wrong one
// puts the patient back at the doctor's door — the exact behaviour the display
// board exists to remove.

/**
 * @param units     one entry per room+doctor lane, in ONE shape:
 *                    { room, doctor, serving, alerted[] }
 *                  The two board feeds name these differently — the grid sends
 *                  `nowServing`/`flash`, the room screen sends
 *                  `inProgress`/`alerted` — so each caller maps its own payload
 *                  once. Teaching this hook both shapes would mean every future
 *                  board adds a third.
 * @param settings  the org's raw `announce*` values, straight from the API
 */
export function useQueueAnnouncements(units, settings) {
  const announcerRef = useRef(null)
  const [status, setStatus] = useState({ enabled: false, heard: false, languageFallback: null })

  // One announcer for the life of the board. Rebuilding it would empty the
  // "already said" set, and the next refresh would read the hall out again.
  if (!announcerRef.current && typeof window !== 'undefined') {
    announcerRef.current = createAnnouncer(browserEngine())
  }

  useEffect(() => {
    const a = announcerRef.current
    if (!a || !units) return

    // Defaults live in orgSettingsSchema.js, applied here, so a hospital that
    // has never opened the Settings screen still gets a sensible sentence
    // rather than `undefined` read aloud.
    const cfg = readOrgSettings(settings || {})

    // Wording still on a default — including the older text this app shipped,
    // which hardcoded {token} — is upgraded to the current default for the
    // chosen language. The Settings panel does exactly the same on load, and
    // both must agree: a screen that shows one sentence while the hall hears
    // another is worse than either being wrong on its own.
    const tpl = templatesFor(cfg.announceLanguage, cfg.announceSay)
    if (isDefaultText('ready', cfg.announceReadyText)) cfg.announceReadyText = tpl.ready
    if (isDefaultText('call', cfg.announceCallText)) cfg.announceCallText = tpl.call

    // Collect first, announce after — so the seed on the very first payload
    // covers everything currently on screen, in one pass.
    const items = []
    for (const u of units) {
      const room = u.room ?? ''
      const doctor = u.doctor || ''

      const spoken = (entry) => announceValues({
        mode: cfg.announceSay, lang: cfg.announceLanguage,
        name: entry?.name, token: shortToken(entry?.token) || '', room, doctor,
      })

      if (u.serving?.queueEntryId) {
        items.push({
          id: `${u.serving.queueEntryId}:call`,
          text: fillTemplate(cfg.announceCallText, spoken(u.serving)),
        })
      }
      for (const p of u.alerted || []) {
        if (!p?.queueEntryId) continue
        items.push({
          id: `${p.queueEntryId}:ready`,
          text: fillTemplate(cfg.announceReadyText, spoken(p)),
        })
      }
    }

    // A board that has just loaded — or reloaded after a power cut — must not
    // recite everyone already on screen. Mark them as said, and speak only what
    // changes from here.
    //
    // Seeding is keyed on THE PAYLOAD HAVING ARRIVED, not on it containing
    // anyone. Keying it on items was a real bug: a board opened onto an empty
    // room stayed unseeded, so the first Alert a receptionist pressed became the
    // seed and was swallowed in silence — every time, and only the first time,
    // which is the hardest kind to report. `settings` is undefined until the
    // fetch lands, so it is the honest signal for "we have data now".
    if (!a.hasSeeded()) {
      if (settings === undefined) return
      a.seed(items.map((i) => i.id))

      // Then sound the chime ONCE, with no words.
      //
      // Two problems, one answer. Seeding is silent by design, so opening a
      // board looks identical to a board whose audio is broken — and the way
      // audio breaks here is the browser's autoplay policy, which reports no
      // error at all. A single chime proves the speakers are alive without
      // announcing anyone who was already waiting, and it clears the "sound not
      // started" warning in the header.
      if (cfg.announceEnabled) {
        a.announce({ id: '__ready__', text: '', chime: true, repeat: 1, lang: cfg.announceLanguage })
      }
      setStatus((s) => ({ ...s, enabled: cfg.announceEnabled }))
      return
    }

    if (cfg.announceEnabled) {
      for (const item of items) {
        if (!item.text) continue
        a.announce({
          id: item.id, text: item.text, lang: cfg.announceLanguage,
          repeat: cfg.announceRepeat, chime: cfg.announceChime,
          gender: cfg.announceVoiceGender,
        })
      }
    } else {
      // Switched off: still REMEMBER what went past, so turning it on mid-clinic
      // announces the next patient rather than everyone already waiting.
      a.seed(items.map((i) => i.id))
    }

    setStatus({ enabled: cfg.announceEnabled, heard: a.state.heard, languageFallback: a.state.languageFallback })
  }, [units, settings])

  return status
}
