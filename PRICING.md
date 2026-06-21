# Lustique Cosmetology — Pricing Model & Estimator Spec

**Status:** v1 — core locked by Zandeline; new-service prices proposed (await her confirmation)
**Last updated:** 2026-06-01
**Purpose:** Single source of truth for all pricing logic. The website estimator and the /pricing page are both built from this file.

---

## 1. Core principle (locked)

**Component pricing only. No bundle discounts** (unless a promotion is explicitly running).

The "packages" (Bride, Bride + 1, Bride + 2 …) are **presets that pre-select who needs services** — the price is always the sum of the individual components. There is no separate discounted "package rate." This was confirmed by Zandeline (Q20).

This makes the estimator pure arithmetic:

```
ESTIMATE = bride_services
         + Σ(party member services)
         + travel
```

Verified against the existing PDF: Solo Bride, short hair = R850 (makeup trial) + R850 (makeup day) + R495 (hair trial) + R495 (hair day) = **R2,690 ≈ the PDF's "Package 1 from R2,700."** The numbers reconcile.

**Display rule (locked):** Replace every "FROM ±R" with a firm **"From R"**. Keep length-tiering (SA market has not adopted flat-rate bridal hair; tiering by length/complexity is the norm — confirmed by Zandeline, Q1). Maintain a **clear visual separation between bride pricing and bridal-party pricing** (Q1).

---

## 2. Hair length definitions (locked — Zandeline Q16)

These are the objective rules the estimator uses. Display them with a small diagram on the pricing page so brides self-classify correctly.

| Tier | Definition |
|---|---|
| **Short** | Chin length |
| **Medium** | Chin to shoulder length |
| **Long** | Below shoulder to mid-back |
| **X-Long** | Mid-back to pantyline |
| **Beyond X-Long** | Longer than pantyline → **Price on request** (estimator shows "we'll confirm this one personally") |

> **Estimator input (2026-06-04):** the bridal party's hair is captured as a **length distribution**, not one length for everyone — *"of those needing hair, how many Short / Medium / Long / X-Long?"* The form defaults to a single length (collapsed) and, on "some have different lengths?", expands to four count buckets that should sum to the party members needing hair (a live "placed of N" counter reconciles them). Each head is then priced at its own length, so the quote is exact and independent of party size. Flower-girls-under-12 keep the cheaper hair table on their own length. The 4+ "cheapest look free" promo is unchanged — it still frees the single least-expensive person; the estimator hands the distribution's lengths to heads deterministically (short→x-long) when reconstructing per-person costs.

---

## 3. Component price list (locked — from 2026–2027 PDF)

### Bride

| Service | Short | Medium | Long | X-Long |
|---|---|---|---|---|
| Bridal makeup — trial | R850 | R850 | R850 | R850 |
| Bridal makeup — wedding day | R850 | R850 | R850 | R850 |
| Bridal hair — trial | R495 | R595 | R695 | R795 |
| Bridal hair — wedding day | R495 | R595 | R695 | R795 |
| Strip lashes + touch-up kit | Included | Included | Included | Included |
| **Bride subtotal (trial + day, hair + makeup)** | **R2,690** | **R2,890** | **R3,090** | **R3,290** |

> Note: the bride's "package" always includes the trial. That's deliberate — Zandeline calls the trial "the most important part of the whole bridal hair and makeup experience."

### Party members — makeup (flat, not length-tiered)

| Person | Makeup |
|---|---|
| Bridesmaid / family member | R550 |
| Mother of bride / groom | R500 |
| Wedding guest | R550 |
| Flower girl under 12 | R250 |
| Flower girl over 12 | R500 |
| Strip lashes (per add-on person) | R75 |

### Party members — hair (length-tiered)

| Person | Short | Medium | Long | X-Long |
|---|---|---|---|---|
| Bridesmaid | R395 | R495 | R595 | R695 |
| Mom / gran of bride / groom | R395 | R495 | R595 | R695 |
| Flower girl under 12 | R200 | R250 | R300 | R400 |
| Flower girl over 12 | R395 | R495 | R595 | R695 |
| Wedding guest | R395 | R495 | R595 | R695 |
| Event (non-wedding) | R395 | R495 | R595 | R695 |

### Event / non-bridal makeup (flat)

| Service | Price |
|---|---|
| Matric farewell | R750 |
| Editorial | R750 |
| Photoshoot (lashes incl.) | R600 |

### Day-of additional artist(s)

**Corrected model (Pieter, 2026-06-04):** for larger parties the additional artist(s) come **with the package** — their cost is **already built into the per-person prices**, so it is **NOT** added on top (the old auto-tier double-counted it and made adding one cheap person spike the total ~R850). An additional artist is charged **only when the bride requests one** for a tighter morning timeline, at **R850 per artist** (`requestedArtists × R850`).

| Party size | Artists working | Surcharge? |
|---|---|---|
| 5+ people | 1 assistant | ✅ included in per-person prices — **no surcharge** |
| 9+ people | 2 assistants | ✅ included in per-person prices — **no surcharge** |
| Any size | An extra artist the bride requests | ➕ **R850 each**, added on request only |

> Earlier note (superseded): "the estimator auto-adds the right tier." It no longer does — see above.

---

## 4. Travel (locked rate — one mechanic to confirm)

- **Rate:** R7.00 per km, round trip *(increased from R5; Pieter, Jun 2026)*
- **Free travel within 30 km** (round trip) of the studio
- **Origin:** **242 Frangipani Street, La Montagne, Pretoria** *(confirmed; the live site's Doornpoort address is outdated — CONTENT.md C1)*
- **Destination-wedding threshold:** more than **200 km one way** → custom quote (not auto-estimated)
- **Overnight:** R1000 per artist per night when required (or client-provided 3-star)
- **Blacklist:** none currently

### ⚠️ One thing to confirm before the estimator ships

Zandeline wrote "R7.00 p/km for a round trip." I'm reading that as:

> **travel = round-trip distance × R7/km** — e.g., a venue 50 km from the studio = 100 km round trip × R7 = **R700**.

This matches the methodology already implied by the old PDF (rate × round-trip km, only the rate changed R5→R7). **If she actually means R7 × one-way distance (so 50 km away = R350), every out-of-town quote halves.** Since destination weddings across four provinces are her growth area, this number must be exactly right. → **Confirm interpretation.** (Listed in §8 open items.)

### Estimator travel UX

The bride won't know her km. So the estimator offers:
- A dropdown of **common venue clusters** with pre-computed round-trip travel (Pretoria East, Centurion, Midrand, Hartbeespoort/Magaliesburg, Bela-Bela, etc.)
- An "other / type my town" option that asks for the town and returns "we'll confirm travel personally"
- Destination (>200 km) → "this is a destination wedding — we'll send a tailored quote"

---

## 5. Deposit, payment & cancellation (locked — from signed service agreement)

> **Confirmed (Pieter, Jun 2026):** booking fee is **50%**. The old 40% Google-Form figure is superseded. **Action: redraft the service agreement + T&Cs with Claude** so the website, the signed agreement, and the new pricing all align (CONTENT.md deliverable).

### Booking fee / deposit

- **50% upfront to secure the date.**
- **Flexible option:** pay **25% now** (if that's all the bride can afford) + **the remaining 25% later** — on a chosen date, or together with the balance.
- **Balance due 14 working days before** the event (via EFT). Non-payment in time → automatic cancellation.
- *(Exact non-refundable terms + cancellation tiers to be finalised in the service-agreement redraft.)*

### Balance

- All remaining balances due **no later than 14 business days before** the event.
- Non-payment in time → automatic cancellation.

### Cancellation (original date unchanged)

| Notice before event | Client liable for |
|---|---|
| 6 months prior | 50% of total |
| 3 months prior | 60% of total |
| 2 months prior | 75% of total |
| 30 days or less | 100% (full amount) |

- Cancel within 30 days *of booking*: full refund. After that: liable for the 40% non-refundable portion.
- Transferred (postponed-to-new-date) bookings: no refunds on a subsequent cancellation.

### Postponement

- One free weekday postponement.
- Weekend postponement: R1,000 fee. Each additional postponement: R1,000.
- Penalty 20–50% depending on notice period.

### Other

- Overtime: R250 per 30-minute increment if the schedule runs late due to client-side delays.
- Destination (>200 km one way): client covers minimum 2 nights' accommodation, minimum 3-star.

### Funnel implication

The online booking step collects **only the booking fee** (Option 1/2/3 selector) to lock the date, then routes to the signed agreement for the rest. We do **not** try to automate the full installment schedule — that stays human + agreement-backed.

---

## 6. New services — PROPOSED pricing (await Zandeline's confirmation)

Zandeline (Q23) asked to add these and to "research the current market to determine pricing." Below are researched ranges with a recommended Lustique price that fits her **"premium at an accessible price"** position (Q3). **These are proposals, not locked** — she sets the final number.

### Market context (SA, Gauteng, 2026)

- Special-occasion / event makeup in Gauteng commonly runs **R550–R1,200** depending on artist tier; "per face" figures span **R700–R3,500** across the market.
- A Pretoria East competitor (Beauty by Odette) mirrors Lustique almost exactly: R2,700 bridal package, R850 bridal makeup, R600 mom — confirming Lustique's bridal pricing is **bang-on local market**.
- Maternity-shoot makeup observed **starting ~R1,850** (full shoot package, not a single face).
- Pageant/stage makeup is more intensive (theatrical, longer wear, stage lighting) and typically commands a premium over standard event makeup.

### Proposed additions

| Service | Existing? | Market range | **Proposed Lustique price** | Rationale |
|---|---|---|---|---|
| Matric farewell makeup | Yes (R750) | R550–R900 | **Hold R750** | Already well-placed |
| Editorial makeup | Yes (R750) | R750–R1,500 | **Hold R750** (consider R850) | Slight headroom |
| Photoshoot makeup (lashes incl.) | Yes (R600) | R600–R1,200 | **Hold R600** | Entry point, drives volume |
| Engagement shoot makeup | New | R600–R1,000 | **R650** (+ hair by length) | Just above photoshoot; couples often upsell to hair |
| Maternity shoot makeup | New | R650–R1,850 | **R650** (+ hair by length) | Same tier as engagement |
| Corporate event makeup | New | R550–R900 | **R650** per face | Volume/group potential |
| Pageant / stage makeup | New | R750–R1,500 | **R950** | Premium for intensity + duration |
| "Any special event" makeup | New | — | **R650 base** + hair by length | Catch-all so nothing is un-quotable |

> Event hair for all of the above uses the existing length-tiered event hair table (R395 / R495 / R595 / R695).

---

## 7. Group lessons (locked — Zandeline Q21)

A distinct service line, separate from bridal. Gets its own page: **/services/group-lessons**.

| Item | Detail |
|---|---|
| Format | Groups of **6 or more only** |
| Teacher | Zandeline, + an assistant when the group is more than 8 (subject to team availability) |
| Location | **Bez Ranch, Kameelfontein, Pretoria**, or on-location (travel fees apply) |
| Price — groups **under 10** | **R700 per person** |
| Price — groups **10+** | **R600 per person** |
| Included | Goodie bag (brush set), tea, coffee, juice, water |
| Light meal | Price per person on request |

---

## 8. Workshops (future — Zandeline Q22)

Zandeline wants paid workshops but they're not yet defined. **Do not build a workshop product for v1.** Reserve a clean URL (`/services/workshops` → "Coming soon — register your interest") and an email-capture so we start a waitlist that feeds Brevo. Define properly post-launch.

---

## 9. Yoco payment processing fees

**Purpose:** margin/reporting only. The bride pays the quoted net amount; Lustique absorbs the fee (locked 2026-06-18).

### Plans and in-person rates provided by Pieter (2026-06-21, excl. VAT)

| Plan | In-person local debit | In-person local debit (after R50k) | In-person local credit | In-person local credit (after R50k) |
|---|---|---|---|---|
| Core | 2.30% | 1.35% | 2.30% | 2.30% |
| Plus | 2.10% | 1.25% | 2.20% | 2.20% |
| Pro  | 1.95% | 1.20% | 2.15% | 2.15% |

> **⚠️ Important distinction:** These are **in-person / card-machine** rates. Lustique uses Yoco's **online checkout** (payment links via the API), which has a **separate blended online rate**. The `YOCO_FEE_PCT` Worker var (currently `3.5` as a placeholder) must be set to the correct **online checkout** rate from the Yoco Business Portal (Settings → Pricing → Online Payments). Verify which plan Lustique is on, then record the confirmed online rate below.

### Confirmed rate (update when verified from Yoco portal)

| Field | Value |
|---|---|
| Plan | — (confirm: Core / Plus / Pro) |
| Online checkout rate | — % (blended; confirm from portal) |
| Verified date | — |
| `YOCO_FEE_PCT` wrangler.toml | — (update from 3.5 once confirmed) |

---

## 10. Open pricing items (need answers before estimator ships)

1. ~~Travel mechanic~~ ✅ **Resolved:** R7/km on **round-trip** distance, **free within 30 km**, from the La Montagne studio.
2. **New-service prices (§6)** — confirm or adjust the eight proposed numbers.
3. **Editorial bump** — hold R750 or move to R850?
4. ~~Promotions~~ ✅ **Resolved + implemented (2026-06-04):** the active promo is a **config object** (`ACTIVE_PROMO` in `shared/pricing`), never hardcoded — Zandeline rotates it (later via CMS). Current active promo = "4+ booked → least-expensive look free." **Under-12 flower girls are never the free look** (they're juniors), so adding one never steals the discount; the freed look is always a full party look. The bride is also never the freed look.
5. **Minimum booking value** — is there a floor (e.g., "weddings under R2,000 not viable on a Saturday")? Useful for gently filtering the "too small / too late" enquiries Zandeline named as non-ideal (Q4).
6. **Promo engine** — the estimator must compute the "cheapest person free" dynamically. Confirm: does "free" cover that person's **hair + makeup both**, and does the trial count toward the "4+"? (Assumed: both services free; trial excluded from the count.)
