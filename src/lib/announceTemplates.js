// The two announcement sentences, per language.
//
// Switching the language dropdown has to switch the words too — otherwise a
// hospital picks मराठी, the board loads a Marathi voice, and reads out Hindi
// with it. But a hospital that has WRITTEN ITS OWN wording must not lose it, so
// the swap only happens when the text on screen is still an untouched default
// (see isDefaultText below).
//
// `{name}` resolves through the "Announce by" setting — patient name, token, or
// both — so one template serves all three without being rewritten.
//
// WHAT IS AND IS NOT HERE, deliberately:
//
// English, Hindi and Marathi are written out. The language dropdown offers
// fifteen more, and those fall back to English with a prompt to type their own.
// That is not laziness — an announcement is read aloud to a waiting room, and a
// sentence that is grammatically wrong or unidiomatic in Tamil is worse than an
// English one, because nobody in the hall can correct it and the hospital may
// not notice for weeks. A translation belongs to someone who speaks the
// language, typed into the box, not guessed at here.

export const ANNOUNCE_TEMPLATES = {
  'en-IN': {
    ready: '{name}, you are next. Please wait near Room {room} and keep your reports ready.',
    call: '{name}, please come to Room {room}.',
  },
  'hi-IN': {
    ready: '{name}, आप अगले हैं। कृपया रूम {room} के पास इंतज़ार करें और अपनी रिपोर्ट तैयार रखें।',
    call: '{name}, कृपया रूम {room} में आएं।',
  },
  'mr-IN': {
    ready: '{name}, तुमचा नंबर पुढे आहे. कृपया खोली {room} जवळ थांबा आणि तुमचे अहवाल तयार ठेवा.',
    call: '{name}, कृपया खोली क्रमांक {room} मध्ये या.',
  },
}

// en-US and en-GB say the same thing as en-IN; there is no reason to keep three
// identical copies that can drift apart.
ANNOUNCE_TEMPLATES['en-US'] = ANNOUNCE_TEMPLATES['en-IN']
ANNOUNCE_TEMPLATES['en-GB'] = ANNOUNCE_TEMPLATES['en-IN']

/** Whether this hospital has written its own words yet. */
export function isDefaultText(kind, text) {
  const t = String(text || '').trim()
  if (!t) return true
  return Object.values(ANNOUNCE_TEMPLATES).some((tpl) => tpl[kind] === t)
}

/** The pair for a language, falling back to English when none is written yet. */
export function templatesFor(lang) {
  return ANNOUNCE_TEMPLATES[lang] || ANNOUNCE_TEMPLATES['en-IN']
}

/** True when this language has no translation here and the hospital should type
 *  its own — the panel says so rather than letting English arrive silently. */
export const needsOwnWording = (lang) => !ANNOUNCE_TEMPLATES[lang]
