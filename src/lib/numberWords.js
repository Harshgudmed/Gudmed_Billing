// A number written out in words, in the language the board is announcing in.
//
// WHY THIS EXISTS: the voice reads a digit string in ITS OWN language, not the
// text's. There is no Marathi voice, so Marathi is read by the Hindi voice —
// which turns room 311 into "तीन सौ ग्यारह" instead of "तीनशे अकरा". The same
// happens to Tamil read by an English voice. Handing the voice words instead of
// digits takes the decision away from it: whatever reads the sentence, the
// number is already in the right language.
//
// Only whole numbers up to 9999 are converted. A room called "OPD-2" or
// "Ground Floor" is passed through untouched — a queue's room is a label, not
// always a number, and mangling it would lose the only direction the patient has.

const UNDER_100 = {
  'en-IN': [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen',
  ],
  'hi-IN': [
    'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
    'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
    'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
    'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
    'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
    'पचास', 'इक्यावन', 'बावन', 'तिरेपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
    'साठ', 'इकसठ', 'बासठ', 'तिरेसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
    'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी',
    'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
    'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
  ],
  'mr-IN': [
    'शून्य', 'एक', 'दोन', 'तीन', 'चार', 'पाच', 'सहा', 'सात', 'आठ', 'नऊ',
    'दहा', 'अकरा', 'बारा', 'तेरा', 'चौदा', 'पंधरा', 'सोळा', 'सतरा', 'अठरा', 'एकोणीस',
    'वीस', 'एकवीस', 'बावीस', 'तेवीस', 'चोवीस', 'पंचवीस', 'सव्वीस', 'सत्तावीस', 'अठ्ठावीस', 'एकोणतीस',
    'तीस', 'एकतीस', 'बत्तीस', 'तेहतीस', 'चौतीस', 'पस्तीस', 'छत्तीस', 'सदतीस', 'अडतीस', 'एकोणचाळीस',
    'चाळीस', 'एक्केचाळीस', 'बेचाळीस', 'त्रेचाळीस', 'चव्वेचाळीस', 'पंचेचाळीस', 'सेहेचाळीस', 'सत्तेचाळीस', 'अठ्ठेचाळीस', 'एकोणपन्नास',
    'पन्नास', 'एक्कावन्न', 'बावन्न', 'त्रेपन्न', 'चोपन्न', 'पंचावन्न', 'छप्पन्न', 'सत्तावन्न', 'अठ्ठावन्न', 'एकोणसाठ',
    'साठ', 'एकसष्ट', 'बासष्ट', 'त्रेसष्ट', 'चौसष्ट', 'पासष्ट', 'सहासष्ट', 'सदुसष्ट', 'अडुसष्ट', 'एकोणसत्तर',
    'सत्तर', 'एक्काहत्तर', 'बाहत्तर', 'त्र्याहत्तर', 'चौऱ्याहत्तर', 'पंच्याहत्तर', 'शहात्तर', 'सत्त्याहत्तर', 'अठ्ठ्याहत्तर', 'एकोणऐंशी',
    'ऐंशी', 'एक्क्याऐंशी', 'ब्याऐंशी', 'त्र्याऐंशी', 'चौऱ्याऐंशी', 'पंच्याऐंशी', 'शहाऐंशी', 'सत्त्याऐंशी', 'अठ्ठ्याऐंशी', 'एकोणनव्वद',
    'नव्वद', 'एक्क्याण्णव', 'ब्याण्णव', 'त्र्याण्णव', 'चौऱ्याण्णव', 'पंच्याण्णव', 'शहाण्णव', 'सत्त्याण्णव', 'अठ्ठ्याण्णव', 'नव्व्याण्णव',
  ],
  'ta-IN': [
    'பூஜ்ஜியம்', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது',
    'பத்து', 'பதினொன்று', 'பன்னிரண்டு', 'பதிமூன்று', 'பதினான்கு', 'பதினைந்து', 'பதினாறு', 'பதினேழு', 'பதினெட்டு', 'பத்தொன்பது',
  ],
}

// English and Tamil build their 20-99 from a tens word plus a unit; Hindi and
// Marathi cannot — every one of their ninety-nine numbers is its own word, which
// is why those two are listed in full above.
const TENS = {
  'en-IN': ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'],
  'ta-IN': ['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'எண்பது', 'தொண்ணூறு'],
}
// The form a tens word takes when a unit follows it (Tamil changes; English does not).
const TENS_JOINED = {
  'en-IN': TENS['en-IN'],
  'ta-IN': ['', '', 'இருபத்தி', 'முப்பத்தி', 'நாற்பத்தி', 'ஐம்பத்தி', 'அறுபத்தி', 'எழுபத்தி', 'எண்பத்தி', 'தொண்ணூற்றி'],
}

// Hundreds, in two forms: standing alone (room 300) and with more to follow
// (room 311). Tamil and Marathi change shape between the two — "நூறு" becomes
// "நூற்றி", "शंभर" becomes "एकशे" — and using the standalone form mid-number is
// the kind of mistake a listener notices immediately.
const HUNDREDS = {
  'en-IN': {
    alone: ['', 'one hundred', 'two hundred', 'three hundred', 'four hundred', 'five hundred', 'six hundred', 'seven hundred', 'eight hundred', 'nine hundred'],
  },
  'hi-IN': {
    alone: ['', 'एक सौ', 'दो सौ', 'तीन सौ', 'चार सौ', 'पाँच सौ', 'छह सौ', 'सात सौ', 'आठ सौ', 'नौ सौ'],
  },
  'mr-IN': {
    alone: ['', 'शंभर', 'दोनशे', 'तीनशे', 'चारशे', 'पाचशे', 'सहाशे', 'सातशे', 'आठशे', 'नऊशे'],
    joined: ['', 'एकशे', 'दोनशे', 'तीनशे', 'चारशे', 'पाचशे', 'सहाशे', 'सातशे', 'आठशे', 'नऊशे'],
  },
  'ta-IN': {
    alone: ['', 'நூறு', 'இருநூறு', 'முந்நூறு', 'நானூறு', 'ஐந்நூறு', 'அறுநூறு', 'எழுநூறு', 'எண்ணூறு', 'தொள்ளாயிரம்'],
    joined: ['', 'நூற்றி', 'இருநூற்றி', 'முந்நூற்றி', 'நானூற்றி', 'ஐந்நூற்றி', 'அறுநூற்றி', 'எழுநூற்றி', 'எண்ணூற்றி', 'தொள்ளாயிரத்தி'],
  },
}

const THOUSANDS = {
  'en-IN': {
    alone: ['', 'one thousand', 'two thousand', 'three thousand', 'four thousand', 'five thousand', 'six thousand', 'seven thousand', 'eight thousand', 'nine thousand'],
  },
  'hi-IN': {
    alone: ['', 'एक हज़ार', 'दो हज़ार', 'तीन हज़ार', 'चार हज़ार', 'पाँच हज़ार', 'छह हज़ार', 'सात हज़ार', 'आठ हज़ार', 'नौ हज़ार'],
  },
  'mr-IN': {
    alone: ['', 'एक हजार', 'दोन हजार', 'तीन हजार', 'चार हजार', 'पाच हजार', 'सहा हजार', 'सात हजार', 'आठ हजार', 'नऊ हजार'],
  },
  'ta-IN': {
    alone: ['', 'ஆயிரம்', 'இரண்டாயிரம்', 'மூவாயிரம்', 'நான்காயிரம்', 'ஐயாயிரம்', 'ஆறாயிரம்', 'ஏழாயிரம்', 'எட்டாயிரம்', 'ஒன்பதாயிரம்'],
    joined: ['', 'ஆயிரத்தி', 'இரண்டாயிரத்தி', 'மூவாயிரத்தி', 'நான்காயிரத்தி', 'ஐயாயிரத்தி', 'ஆறாயிரத்தி', 'ஏழாயிரத்தி', 'எட்டாயிரத்தி', 'ஒன்பதாயிரத்தி'],
  },
}

const pick = (table, digit, more) => (more && table.joined ? table.joined : table.alone)[digit]

/** 0-99 in one language. */
function under100(n, lang) {
  const words = UNDER_100[lang]
  if (n < words.length) return words[n]
  const t = Math.floor(n / 10)
  const u = n % 10
  if (!u) return TENS[lang][t]
  return `${TENS_JOINED[lang][t]} ${UNDER_100[lang][u]}`
}

/**
 * A number in words, or the original text when it is not a plain whole number
 * this can handle. Callers pass the value straight through, so a room named
 * "OPD-2" survives and only "311" is converted.
 */
export function numberWords(value, lang = 'en-IN') {
  const raw = String(value ?? '').trim()
  if (!UNDER_100[lang]) lang = 'en-IN'
  if (!/^\d{1,4}$/.test(raw)) return raw

  const n = Number(raw)
  if (n === 0) return UNDER_100[lang][0]

  const parts = []
  const th = Math.floor(n / 1000)
  const h = Math.floor((n % 1000) / 100)
  const rest = n % 100

  if (th) parts.push(pick(THOUSANDS[lang], th, h > 0 || rest > 0))
  if (h) parts.push(pick(HUNDREDS[lang], h, rest > 0))
  if (rest) parts.push(under100(rest, lang))
  return parts.join(' ')
}

export const NUMBER_WORD_LANGUAGES = Object.keys(UNDER_100)
