import { esc, ep, emailBtn, emailNote, emailShell, emailTable } from "./email";
import { getPromoPreset } from "@lustique/pricing";

export interface MarketingEmailInput {
  headline: string;
  /** Plain text, one entry per paragraph — escaped internally, so pass raw admin-entered text. */
  paragraphs: string[];
  highlight?: { label: string; value: string };
  ctaLabel: string;
  ctaHref: string;
  /** Absolute image URL — marketing sends aren't build-time, so this can't be a local astro:assets import. */
  heroImage?: string;
  /** One of shared/pricing's PROMO_PRESETS ids — when given, its `terms` is appended as small print. */
  promoId?: string;
}

/**
 * The one flexible marketing preset (see docs/superpowers/specs/2026-07-03-lustique-marketing-email-design.md
 * §4): copy changes per send, layout and brand styling never do. Built from the same emailShell()
 * components every transactional email uses, so a promo send looks like it belongs to the same brand.
 */
export function marketingEmailHtml(input: MarketingEmailInput): string {
  const heroHtml = input.heroImage
    ? `<img src="${esc(input.heroImage)}" alt="" width="424" style="display:block;width:100%;max-width:424px;height:auto;border-radius:8px;margin:0 0 24px;" />`
    : "";
  const bodyHtml = input.paragraphs.map((p) => ep(esc(p))).join("");
  const highlightHtml = input.highlight
    ? emailTable([{ key: input.highlight.label, val: input.highlight.value, bold: true }])
    : "";
  const promo = input.promoId ? getPromoPreset(input.promoId) : undefined;
  const termsHtml = promo ? `<div style="margin-top:18px;">${emailNote(`Terms: ${esc(promo.terms)}`)}</div>` : "";

  return emailShell({
    heading: esc(input.headline),
    body: heroHtml + bodyHtml + highlightHtml,
    btnZone: emailBtn(input.ctaHref, input.ctaLabel) + termsHtml,
  });
}
