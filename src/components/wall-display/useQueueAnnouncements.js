import { useEffect, useRef, useState } from 'react'
import { createAnnouncer, browserEngine, fillTemplate } from '@/lib/announce'
import { readOrgSettings } from '@/lib/orgSettingsSchema'
import { shortToken } from './utils'

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

    // Collect first, announce after — so the seed on the very first payload
    // covers everything currently on screen, in one pass.
    const items = []
    for (const u of units) {
      const room = u.room ?? ''
      const doctor = u.doctor || ''

      if (u.serving?.queueEntryId) {
        const sToken = shortToken(u.serving.token)
        items.push({
          id: `${u.serving.queueEntryId}:call`,
          text: fillTemplate(cfg.announceCallText, {
            name: subject(cfg.announceSay, u.serving), room, doctor,
            token: sToken || '',
          }),
        })
      }
      for (const p of u.alerted || []) {
        if (!p?.queueEntryId) continue
        const pToken = shortToken(p.token)
        items.push({
          id: `${p.queueEntryId}:ready`,
          text: fillTemplate(cfg.announceReadyText, {
            name: subject(cfg.announceSay, p), room, doctor, token: pToken || '',
          }),
        })
      }
    }

    // A board that has just loaded — or reloaded after a power cut — must not
    // recite everyone already on screen. Mark them as said, and speak only what
    // changes from here.
    if (!a.hasSeeded()) {
      if (!items.length) return
      a.seed(items.map((i) => i.id))
      setStatus((s) => ({ ...s, enabled: cfg.announceEnabled }))
      return
    }

    if (cfg.announceEnabled) {
      for (const item of items) {
        if (!item.text) continue
        a.announce({
          id: item.id, text: item.text, lang: cfg.announceLanguage,
          repeat: cfg.announceRepeat, chime: cfg.announceChime,
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

/** Name, token, or both — formatted clearly for speech synthesis.
 *  "4" spoken alone sounds like a digit; "Token number 4" is clear to the hall. */
function subject(mode, entry) {
  const name = entry?.name && entry.name !== '—' ? entry.name : ''
  const token = shortToken(entry?.token)
  const formattedToken = token ? `Token number ${token}` : ''
  if (mode === 'token') return formattedToken || name
  if (mode === 'both') return [name, formattedToken].filter(Boolean).join(', ')
  return name || formattedToken
}
