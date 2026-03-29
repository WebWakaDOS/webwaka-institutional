/**
 * Internationalisation — WebWaka Institutional Suite
 *
 * Invariant 5: Nigeria First — en-NG is the default locale
 * Invariant 6: Africa First — 7 locales supported
 *
 * Currency: All amounts stored as kobo integers (NGN × 100).
 * NEVER store naira floats. ALWAYS convert to kobo before DB writes.
 */

export const DEFAULT_LOCALE = 'en-NG';
export const SUPPORTED_LOCALES = ['en-NG', 'en-GH', 'en-KE', 'en-ZA', 'fr-CI', 'yo-NG', 'ha-NG'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

// Currency subunit multipliers (all × 100 for kobo/pesewa/cent)
const CURRENCY_SUBUNIT: Record<string, number> = {
  NGN: 100, GHS: 100, KES: 100, ZAR: 100, XOF: 100,
};

/**
 * Convert a major currency unit to its subunit (kobo, pesewa, cent).
 * Always returns an integer — Invariant 5: Nigeria First.
 */
export function toSubunit(amount: number, currency: string): number {
  const multiplier = CURRENCY_SUBUNIT[currency] ?? 100;
  return Math.round(amount * multiplier);
}

/**
 * Format a kobo integer amount as a human-readable currency string.
 * @param amountKobo — amount in kobo (integer)
 * @param currency — ISO 4217 currency code
 * @param locale — BCP 47 locale string (defaults to en-NG)
 */
export function formatCurrency(amountKobo: number, currency: string, locale: SupportedLocale = DEFAULT_LOCALE): string {
  const majorAmount = amountKobo / (CURRENCY_SUBUNIT[currency] ?? 100);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(majorAmount);
}

// Nigerian educational institution types
export const INSTITUTION_TYPE_LABELS: Record<string, Record<SupportedLocale, string>> = {
  primary_school: {
    'en-NG': 'Primary School', 'en-GH': 'Primary School', 'en-KE': 'Primary School',
    'en-ZA': 'Primary School', 'fr-CI': 'École Primaire', 'yo-NG': 'Ile-iwe Alakobere', 'ha-NG': 'Makarantar Firamare',
  },
  secondary_school: {
    'en-NG': 'Secondary School', 'en-GH': 'Senior High School', 'en-KE': 'Secondary School',
    'en-ZA': 'High School', 'fr-CI': 'Lycée', 'yo-NG': 'Ile-iwe Girama', 'ha-NG': 'Makarantar Sakandare',
  },
  university: {
    'en-NG': 'University', 'en-GH': 'University', 'en-KE': 'University',
    'en-ZA': 'University', 'fr-CI': 'Université', 'yo-NG': 'Ile-iwe Giga', 'ha-NG': 'Jami\'a',
  },
  polytechnic: {
    'en-NG': 'Polytechnic', 'en-GH': 'Polytechnic', 'en-KE': 'Technical University',
    'en-ZA': 'University of Technology', 'fr-CI': 'Polytechnique', 'yo-NG': 'Ile-iwe Imọ-ẹrọ', 'ha-NG': 'Polytechnic',
  },
  vocational: {
    'en-NG': 'Vocational School', 'en-GH': 'Technical/Vocational School', 'en-KE': 'Vocational Training Centre',
    'en-ZA': 'TVET College', 'fr-CI': 'Centre de Formation Professionnelle', 'yo-NG': 'Ile-iwe Iṣẹ', 'ha-NG': 'Cibiyar Horar da Sana\'a',
  },
  training_centre: {
    'en-NG': 'Training Centre', 'en-GH': 'Training Centre', 'en-KE': 'Training Centre',
    'en-ZA': 'Training Centre', 'fr-CI': 'Centre de Formation', 'yo-NG': 'Ile-ikọ', 'ha-NG': 'Cibiyar Horarwa',
  },
};

// Nigerian fee types
export const FEE_TYPE_LABELS: Record<string, Record<SupportedLocale, string>> = {
  tuition: {
    'en-NG': 'Tuition Fee', 'en-GH': 'Tuition Fee', 'en-KE': 'School Fee',
    'en-ZA': 'Tuition Fee', 'fr-CI': 'Frais de Scolarité', 'yo-NG': 'Owo Ile-iwe', 'ha-NG': 'Kudin Makaranta',
  },
  hostel: {
    'en-NG': 'Hostel Fee', 'en-GH': 'Boarding Fee', 'en-KE': 'Boarding Fee',
    'en-ZA': 'Residence Fee', 'fr-CI': 'Frais de Résidence', 'yo-NG': 'Owo Ibugbe', 'ha-NG': 'Kudin Gida',
  },
  exam: {
    'en-NG': 'Examination Fee', 'en-GH': 'Examination Fee', 'en-KE': 'Examination Fee',
    'en-ZA': 'Examination Fee', 'fr-CI': "Frais d'Examen", 'yo-NG': 'Owo Idanwo', 'ha-NG': 'Kudin Jarrabawa',
  },
};
