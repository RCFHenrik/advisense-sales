/**
 * Currency utilities for localized revenue display.
 *
 * Revenue is stored in SEK in the database. This module converts and formats
 * amounts into the local currency of the logged-in user's site using
 * configurable FX rates from SystemConfig.
 */

// Country code (ISO 3166-1 alpha-2) → currency code (ISO 4217)
const COUNTRY_CURRENCY: Record<string, string> = {
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  FI: 'EUR',
  DE: 'EUR',
  GB: 'GBP',
};

// Currency → locale for correct number/symbol formatting
const CURRENCY_LOCALE: Record<string, string> = {
  SEK: 'sv-SE',
  NOK: 'nb-NO',
  DKK: 'da-DK',
  EUR: 'de-DE',
  GBP: 'en-GB',
};

/**
 * Derive the display currency from the user's site country code.
 * Falls back to SEK if country code is unknown or missing.
 */
export function getCurrencyForCountry(countryCode: string | undefined): string {
  return (countryCode && COUNTRY_CURRENCY[countryCode]) || 'SEK';
}

/**
 * Convert a SEK amount to the target currency and format it for display.
 * Amounts are rounded to the nearest 500 for clean presentation.
 *
 * @param sekAmount - Revenue value in SEK (as stored in DB)
 * @param currencyCode - Target currency (e.g. 'SEK', 'NOK', 'EUR')
 * @param fxRates - Map of currency codes to FX rates (SEK → target)
 */
export function formatRevenue(
  sekAmount: number,
  currencyCode: string,
  fxRates: Record<string, number>,
): string {
  const rate = currencyCode === 'SEK' ? 1 : (fxRates[currencyCode] ?? 1);
  const converted = sekAmount * rate;
  // Round to nearest 500
  const rounded = Math.round(converted / 500) * 500;
  const locale = CURRENCY_LOCALE[currencyCode] || 'sv-SE';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(rounded);
}
