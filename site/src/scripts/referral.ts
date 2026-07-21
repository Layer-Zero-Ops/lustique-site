/* ============================================================
   Referral attribution — capture which vendor/venue partner link
   (?ref=<slug>) sent this visitor, so it can ride along with
   whatever enquiry they eventually submit. Kept in sessionStorage:
   survives the multi-step quote form, cleared when the tab closes —
   no persistent cross-visit tracking is needed for this.
   ============================================================ */

const STORAGE_KEY = "lustique_referral_source";

/** Call on every page load. Only overwrites the stored value when the
 *  current URL actually carries new attribution — so a bride who lands
 *  via a partner link, then browses several pages before enquiring,
 *  keeps that original attribution rather than losing it on a page
 *  with no query string. */
export function captureReferralSource(search: string): void {
  const params = new URLSearchParams(search);
  const value = params.get("ref") || params.get("utm_source");
  if (!value) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, value.slice(0, 80));
  } catch {
    /* sessionStorage unavailable (private browsing edge cases) — attribution is best-effort only */
  }
}

export function readReferralSource(): string | undefined {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
