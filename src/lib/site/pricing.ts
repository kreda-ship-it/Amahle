/**
 * Printing prices and durations for the public site.
 *
 * Both of these look trivial and are not. A wrong price on a salon's website
 * is an argument at the till, so the rules live in one place rather than being
 * re-improvised on every page that shows a number.
 */

/**
 * How the salon wants a price printed. Mirrors the `price_display` column in
 * migration 007 exactly — Postgres constrains it to these three, and any value
 * we do not recognise is treated as `hidden`, because printing nothing is the
 * safe way to be wrong.
 */
export type PriceDisplay = "exact" | "from" | "hidden";

/*
 * The one locale hardcoded in this codebase.
 *
 * An organization carries its timezone and its currency but not a locale, so
 * there is nothing in the database to read. `en-US` is right for the salon we
 * have. When a salon elsewhere needs different grouping or decimal marks, the
 * fix is a `locale` column beside `currency` and this constant reading from
 * it — not a second copy of this function.
 */
const LOCALE = "en-US";

/**
 * `40` with currency `USD` becomes `$40`. `12.5` becomes `$12.50`.
 *
 * No trailing `.00`, because a price list full of them reads like a receipt.
 * Real cents still print, so nothing is silently rounded away.
 */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Intl throws on a currency code it does not know. A salon whose currency
    // is mistyped should still get a readable page rather than a crash.
    return `${currency} ${amount}`;
  }
}

/**
 * What to print in place of a price.
 *
 * Returns null when the salon has chosen to show no number, so the caller can
 * leave the space empty or write its own invitation to call. Null rather than
 * an empty string, so a forgotten check is a type error rather than a blank.
 */
export function formatPrice(
  price: number,
  priceDisplay: string,
  currency: string,
): string | null {
  switch (priceDisplay) {
    case "exact":
      return formatMoney(price, currency);

    // Braiding and colour are priced by length and condition. "from $180" is
    // the honest version of a number that genuinely varies; a flat price would
    // be a promise the salon cannot keep.
    case "from":
      return `from ${formatMoney(price, currency)}`;

    // 'hidden', and anything unrecognised.
    default:
      return null;
  }
}

/**
 * `45` becomes `45 min`. `90` becomes `1 hr 30 min`. `480` becomes `8 hr`.
 *
 * Deliberately not "0.75 hours" or "1.5 hrs" — someone reading a price list is
 * working out whether they can fit an appointment into an afternoon, and hours
 * and minutes is how people actually think about that.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} hr`;

  return `${hours} hr ${remainder} min`;
}
