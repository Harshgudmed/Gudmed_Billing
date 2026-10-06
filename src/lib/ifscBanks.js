// An IFSC's first four letters name the bank (SBIN0001234 → State Bank of
// India). Used to fill the bank name the moment an IFSC is typed; the person
// can still change it, and a bank not listed here is simply typed in.
const BANKS = {
  SBIN: 'State Bank of India',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  UTIB: 'Axis Bank',
  KKBK: 'Kotak Mahindra Bank',
  PUNB: 'Punjab National Bank',
  BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
  BKID: 'Bank of India',
  IDIB: 'Indian Bank',
  CBIN: 'Central Bank of India',
  IOBA: 'Indian Overseas Bank',
  UCBA: 'UCO Bank',
  MAHB: 'Bank of Maharashtra',
  PSIB: 'Punjab & Sind Bank',
  IBKL: 'IDBI Bank',
  YESB: 'Yes Bank',
  INDB: 'IndusInd Bank',
  IDFB: 'IDFC FIRST Bank',
  FDRL: 'Federal Bank',
  RATN: 'RBL Bank',
  KARB: 'Karnataka Bank',
  KVBL: 'Karur Vysya Bank',
  CIUB: 'City Union Bank',
  SIBL: 'South Indian Bank',
  TMBL: 'Tamilnad Mercantile Bank',
  DLXB: 'Dhanlaxmi Bank',
  JAKA: 'Jammu & Kashmir Bank',
  BDBL: 'Bandhan Bank',
  AUBL: 'AU Small Finance Bank',
  ESFB: 'Equitas Small Finance Bank',
  UJVN: 'Ujjivan Small Finance Bank',
  DBSS: 'DBS Bank India',
  HSBC: 'HSBC',
  SCBL: 'Standard Chartered Bank',
  CITI: 'Citibank',
}

/** The bank an IFSC belongs to, or null when the code is not known. */
export function bankFromIfsc(ifsc) {
  const code = String(ifsc || '').trim().toUpperCase().slice(0, 4)
  return code.length === 4 ? BANKS[code] || null : null
}
