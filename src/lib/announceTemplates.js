// The two announcement sentences, for every language AND every "Announce by"
// choice.
//
// BOTH DROPDOWNS REWRITE THE BOXES, and they do it the same way. Picking मराठी
// fills both sentences with Marathi; picking "Token number only" rewrites how
// the patient is addressed in them. Either change produces text the admin can
// read, edit and save — there is no hidden placeholder whose meaning has to be
// looked up somewhere else.
//
// Rather than write 4 languages × 3 modes = 24 sentences by hand, each language
// gives ONE sentence with `{subject}` in it, and each mode says how the subject
// is worded. That way a change to the Marathi phrasing is one edit, not three,
// and the three modes can never drift apart within a language.
//
//     token → टोकन क्रमांक {token}
//     name  → {name}
//     both  → {name}, टोकन क्रमांक {token}
//
// Only `{name}`, `{token}` and `{room}` ever reach the saved text, so what an
// admin sees in the box is exactly what the board will read.
//
// WHICH FOUR LANGUAGES, AND WHY:
//   en-IN  Microsoft Zira / Heera     — installed everywhere
//   hi-IN  Microsoft Kalpana / Hemant — a Windows optional pack
//   mr-IN  no Marathi voice exists, but Marathi is Devanagari and the Hindi
//          voice reads it in full (measured: 11.4s for a ~10s sentence)
//   ta-IN  Microsoft Valluvar         — a Windows optional pack
//
// Telugu was dropped: its script is its own, no Windows voice can read it, and
// an English voice handed Telugu produces noise. Offering it is offering silence.

import { numberWords } from './numberWords.js'

const LANGUAGES = {
  'en-IN': {
    tokenLabel: 'Token number',
    ready: '{subject}, you are next. Please wait near Room {room} and keep your reports ready.',
    call: '{subject}, please come to Room {room}.',
  },
  'hi-IN': {
    tokenLabel: 'टोकन नंबर',
    ready: '{subject}, आप अगले हैं। कृपया रूम {room} के पास इंतज़ार करें और अपनी रिपोर्ट तैयार रखें।',
    call: '{subject}, कृपया रूम {room} में आएं।',
  },
  'mr-IN': {
    tokenLabel: 'टोकन क्रमांक',
    ready: '{subject}, तुमचा नंबर पुढे आहे. कृपया रूम नंबर {room} जवळ थांबा आणि तुमचे अहवाल तयार ठेवा.',
    call: '{subject}, कृपया रूम नंबर {room} मध्ये या.',
  },
  'ta-IN': {
    tokenLabel: 'டோக்கன் எண்',
    ready: '{subject}, நீங்கள் அடுத்தவர். தயவுசெய்து அறை {room} அருகில் காத்திருங்கள், உங்கள் அறிக்கைகளை தயாராக வைத்திருங்கள்.',
    call: '{subject}, தயவுசெய்து அறை {room} க்கு வாருங்கள்.',
  },
}

export const ANNOUNCE_LANGUAGES = Object.keys(LANGUAGES)
export const ANNOUNCE_MODES = ['name', 'token', 'both']

/** How the patient is addressed, for one language and one "Announce by" mode. */
function subjectPhrase(lang, mode) {
  const label = (LANGUAGES[lang] || LANGUAGES['en-IN']).tokenLabel
  if (mode === 'token') return `${label} {token}`
  if (mode === 'both') return `{name}, ${label} {token}`
  return '{name}'
}

/**
 * The two sentences for a language + mode, ready to show in the boxes.
 * An unknown language falls back to English rather than to nothing.
 */
export function templatesFor(lang, mode = 'name') {
  const L = LANGUAGES[lang] || LANGUAGES['en-IN']
  const subject = subjectPhrase(lang, mode)
  return {
    tokenLabel: L.tokenLabel,
    ready: L.ready.replace('{subject}', subject),
    call: L.call.replace('{subject}', subject),
  }
}

/** Every sentence this app has ever supplied, for either box. */
function allDefaults(kind) {
  const out = new Set()
  for (const lang of ANNOUNCE_LANGUAGES) {
    for (const mode of ANNOUNCE_MODES) out.add(templatesFor(lang, mode)[kind])
  }
  for (const t of LEGACY_DEFAULTS[kind] || []) out.add(t)
  return out
}

// Sentences this app shipped in earlier versions. Recognised so a hospital that
// never touched the wording is not treated as having written its own — it would
// be stranded on old text that ignores the dropdowns it is now using.
const LEGACY_DEFAULTS = {
  ready: [
    'टोकन नंबर {token}, आप अगले हैं। कृपया रूम {room} के पास इंतज़ार करें और अपनी रिपोर्ट तैयार रखें।',
    'टोकन नंबर {token}, आप अगले हैं। कृपया रूम {room} के पास इंतजार करें और अपनी रिपोर्ट तैयार रखें।',
    'टोकन क्रमांक {token}, तुमचा नंबर पुढे आहे. कृपया खोली क्रमांक {room} जवळ थांबा आणि तुमचे अहवाल तयार ठेवा.',
    'Token number {token}, you are next. Please wait near Room {room} and keep your reports ready.',
    '{patient}, you are next. Please wait near Room {room} and keep your reports ready.',
    '{patient}, आप अगले हैं। कृपया रूम {room} के पास इंतज़ार करें और अपनी रिपोर्ट तैयार रखें।',
    '{patient}, तुमचा नंबर पुढे आहे. कृपया खोली क्रमांक {room} जवळ थांबा आणि तुमचे अहवाल तयार ठेवा.',
    '{patient}, நீங்கள் அடுத்தவர். தயவுசெய்து அறை {room} அருகில் காத்திருங்கள், உங்கள் அறிக்கைகளை தயாராக வைத்திருங்கள்.',
  ],
  call: [
    'टोकन नंबर {token}, कृपया रूम {room} में आएं।',
    'टोकन क्रमांक {token}, कृपया खोली क्रमांक {room} मध्ये या.',
    'Token number {token}, please come to Room {room}.',
    '{patient}, please come to Room {room}.',
    '{patient}, कृपया रूम {room} में आएं।',
    '{patient}, कृपया खोली क्रमांक {room} मध्ये या.',
    '{patient}, தயவுசெய்து அறை {room} க்கு வாருங்கள்.',
  ],
}

/**
 * Whether this hospital is still on wording this app supplied.
 *
 * True for ANY language and ANY mode — that is what lets either dropdown rewrite
 * the boxes while leaving a hospital's own sentence alone. Someone who typed
 * their own wording keeps it, whichever dropdown they touch afterwards.
 */
export function isDefaultText(kind, text) {
  const t = String(text || '').trim()
  if (!t) return true
  return allDefaults(kind).has(t)
}

/**
 * Rewrite both boxes for a new language and/or mode, keeping anything the
 * hospital wrote itself.
 */
export function retemplate(form, { lang, mode }) {
  const nextLang = lang ?? form.announceLanguage
  const nextMode = mode ?? form.announceSay
  const tpl = templatesFor(nextLang, nextMode)
  const out = { ...form, announceLanguage: nextLang, announceSay: nextMode }
  if (isDefaultText('ready', form.announceReadyText)) out.announceReadyText = tpl.ready
  if (isDefaultText('call', form.announceCallText)) out.announceCallText = tpl.call
  return out
}

/**
 * What `{name}` becomes when the board speaks.
 *
 * A walk-in with no name still has to be called, so an empty name falls back to
 * the labelled token. But ONLY in name mode: the token and its label are already
 * in the sentence in the other two, and falling back there announced the same
 * number twice — "टोकन नंबर 127, टोकन नंबर 127, कृपया रूम 3 में आएं।"
 */
export function announceSubject({ mode = 'name', name = '', token = '', lang = 'en-IN' } = {}) {
  const person = name && name !== '—' ? String(name).trim() : ''
  if (person) return person
  if (mode !== 'name' || !token) return ''
  const label = (LANGUAGES[lang] || LANGUAGES['en-IN']).tokenLabel
  return `${label} ${numberWords(token, lang)}`
}

/**
 * Everything the two sentences need, ready for fillTemplate — SPOKEN forms only.
 *
 * The board and the Settings preview both call this, so what an admin hears when
 * testing is what the hall hears. Numbers become words here and only here: the
 * screen keeps its digits, because 311 is read at a glance and "तीनशे अकरा" is not.
 */
export function announceValues({ mode = 'name', lang = 'en-IN', name = '', token = '', room = '', doctor = '' } = {}) {
  const who = announceSubject({ mode, lang, name, token })
  return {
    // Two names for the same value: {name} is current, {patient} is kept working
    // because a hospital may already have it in wording it typed itself.
    patient: who,
    name: who,
    token: numberWords(token, lang),
    room: numberWords(room, lang),
    doctor,
  }
}

/** True when a language somehow has no wording — the panel warns rather than
 *  letting English arrive silently under another language's voice. */
export const needsOwnWording = (lang) => !LANGUAGES[lang]

// Kept for the tests and for anything that wants the raw per-language sentences.
export const ANNOUNCE_TEMPLATES = LANGUAGES
