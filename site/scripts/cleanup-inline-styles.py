#!/usr/bin/env python3
"""
Clean up remaining inline styles in quote.astro and other .astro files.
Replaces ad-hoc inline styles with reusable CSS utility classes.
"""
import re
import os

# === CSS classes to add to global.css ===
NEW_CSS = """
/* Utility classes for inline-style cleanup */
.field-helper { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--body-text-light); }
.field-label-row { display: flex; align-items: center; font-size: clamp(0.88rem, 1vw, 0.92rem); color: var(--body-text); }
.field-label-start { display: flex; align-items: flex-start; font-size: clamp(0.88rem, 1vw, 0.92rem); color: var(--body-text); cursor: pointer; }
.field-checkbox { width: auto; flex-shrink: 0; }
.section-subhead { font-weight: 600; color: var(--mocha); }
.section-subhead-sm { font-weight: 600; color: var(--mocha); font-size: clamp(0.82rem, 1vw, 0.9rem); }
.form-group-box { border: 1px solid rgba(92,67,50,.12); background: var(--champagne); border-radius: 8px; }
.form-group-inline { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
.form-hidden { display: none; }
.relative { position: relative; }
.estimate-detail { font-size: clamp(0.88rem, 1vw, 0.92rem); color: var(--body-text); }
.estimate-label { font-size: clamp(0.62rem, 0.8vw, 0.74rem); letter-spacing: .14em; text-transform: uppercase; opacity: .85; }
.estimate-sub { opacity: .85; font-size: clamp(0.82rem, 1vw, 0.88rem); }
.venue-suggestions { display: none; position: absolute; left: 0; right: 0; top: 100%; z-index: 20; background: var(--white); border: 1px solid rgba(60,42,42,.18); box-shadow: 0 8px 24px rgba(60,42,42,.12); max-height: 280px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
.venue-map { height: 300px; display: none; max-width: 100%; }
.map-hint { display: none; background: rgba(138,90,74,.07); border: 1px solid rgba(138,90,74,.18); font-size: clamp(0.82rem, 1vw, 0.88rem); color: var(--body-text); }
.map-hint strong { color: var(--mocha); }
.field-full { width: 100%; }
.inline-checkbox-label { display: flex; align-items: center; gap: var(--space-2xs); font-size: clamp(0.85rem, 1vw, 0.92rem); color: var(--body-text); }
.input-auto { width: auto; }
.consent-text a { color: var(--burgundy); }
.btn-full { width: 100%; justify-content: center; }
.status-error { color: var(--error, #c04a5a); }
.hp-field { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
"""

# === Replacements for quote.astro ===
QUOTE_REPLACEMENTS = [
    # Estimate box label
    ('<div style="font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;opacity:.85;">Your live estimate</div>',
     '<div class="estimate-label">Your live estimate</div>'),
    ('<div id="estimateSub" style="opacity:.85;font-size:.88rem;">Updates as you fill in the form</div>',
     '<div id="estimateSub" class="estimate-sub">Updates as you fill in the form</div>'),
    # HP field
    ('<input type="text" name="company" id="hp_company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;">',
     '<input type="text" name="company" id="hp_company" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp-field">'),
    # Venue field
    ('<div class="field" style="position:relative;">',
     '<div class="field relative">'),
    ('<span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--body-text-light);">(start typing — we’ll search for it)</span>',
     '<span class="field-helper">(start typing — we’ll search for it)</span>'),
    ('<div id="venueSuggestions" style="display: none; position: absolute; left: 0; right: 0; top: 100%; z-index: 20; background: #fff; border: 1px solid rgba(60,42,42,.18); box-shadow: 0 8px 24px rgba(60,42,42,.12); max-height: 280px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y"></div>',
     '<div id="venueSuggestions" class="venue-suggestions"></div>'),
    ('<div id="venueMap" style="height: 300px; display: none; max-width: 100%"></div>',
     '<div id="venueMap" class="venue-map"></div>'),
    ('<div id="mapHint" style="display: none; background: rgba(138,90,74,.07); border: 1px solid rgba(138,90,74,.18); font-size: .88rem; color: var(--body-text)">',
     '<div id="mapHint" class="map-hint">'),
    ('<strong style="color:var(--mocha);">📍 Pick a suggestion above for the exact pin.</strong>',
     '<strong class="map-hint-strong">📍 Pick a suggestion above for the exact pin.</strong>'),
    ('<div class="field" id="bandWrap" style="display: none">',
     '<div class="field form-hidden" id="bandWrap">'),
    # Checkbox labels  
    ('<p style="font-weight: 600; color: var(--mocha)">Bridesmaids</p>',
     '<p class="section-subhead">Bridesmaids</p>'),
    ('<p style="font-weight: 600; color: var(--mocha)">Mothers (of the bride &amp; groom)</p>',
     '<p class="section-subhead">Mothers (of the bride &amp; groom)</p>'),
    ('<p style="font-weight: 600; color: var(--mocha)">Flower girls</p>',
     '<p class="section-subhead">Flower girls</p>'),
    ('<p style="font-weight: 600; color: var(--mocha)">Other guests</p>',
     '<p class="section-subhead">Other guests</p>'),
    # Form group boxes
    ('<div style="border: 1px solid #ece4da; background: #fcf9f5">\n            <p style="font-weight: 600; color: var(--mocha); font-size: .9rem">Bridesmaids</p>',
     '<div class="form-group-box">\n            <p class="section-subhead-sm">Bridesmaids</p>'),
    ('<div style="border: 1px solid #ece4da; background: #fcf9f5">\n            <p style="font-weight: 600; color: var(--mocha); font-size: .9rem">Mothers (of the bride &amp; groom)</p>',
     '<div class="form-group-box">\n            <p class="section-subhead-sm">Mothers (of the bride &amp; groom)</p>'),
    ('<div style="border: 1px solid #ece4da; background: #fcf9f5">\n            <p style="font-weight: 600; color: var(--mocha); font-size: .9rem">Other guests</p>',
     '<div class="form-group-box">\n            <p class="section-subhead-sm">Other guests</p>'),
    # Field label helper spans
    ('<span style="font-weight:400;color:var(--body-text-light);">(of those needing hair — we’ll confirm each at the trial)</span>',
     '<span class="field-helper">(of those needing hair — we’ll confirm each at the trial)</span>'),
    ('<span style="font-weight:400;color:var(--body-text-light);">(optional — R850 each, only if your timeline is tight. Larger parties already include the help.)</span>',
     '<span class="field-helper">(optional — R850 each, only if your timeline is tight. Larger parties already include the help.)</span>'),
    ('<span style="font-weight:400;color:var(--body-text-light);">(choose the length for each person getting hair styling)</span>',
     '<span class="field-helper">(choose the length for each person getting hair styling)</span>'),
    # Checkbox label inline styles
    ('<div style="display: flex; flex-wrap: wrap">',
     '<div class="form-group-inline">'),
    ('<label style="display: flex; align-items: center; font-size: .92rem; color: var(--body-text)"><input type="checkbox" id="brideWantsMakeup" checked style="width:auto;"> Makeup</label>',
     '<label class="inline-checkbox-label"><input type="checkbox" id="brideWantsMakeup" checked class="input-auto"> Makeup</label>'),
    ('<label style="display: flex; align-items: center; font-size: .92rem; color: var(--body-text)"><input type="checkbox" id="brideWantsHair" checked style="width:auto;"> Hair</label>',
     '<label class="inline-checkbox-label"><input type="checkbox" id="brideWantsHair" checked class="input-auto"> Hair</label>'),
    ('<label style="display: flex; align-items: center; font-size: .92rem; color: var(--body-text)"><input type="checkbox" id="brideWantsTrial" checked style="width:auto;"> Include a trial</label>',
     '<label class="inline-checkbox-label"><input type="checkbox" id="brideWantsTrial" checked class="input-auto"> Include a trial</label>'),
    # Estimate breakdown and promo
    ('<div id="estimateBreakdown" style="font-size: .92rem; color: var(--body-text)"></div>',
     '<div id="estimateBreakdown" class="estimate-detail"></div>'),
    ('<div id="promoRow" style="display:none;">',
     '<div id="promoRow" class="form-hidden">'),
    ('<label style="display: flex; align-items: center; font-size: .92rem; color: var(--body-text)"><input type="checkbox" id="promoToggle" checked style="width:auto;"> <span id="promoToggleLabel">Apply the current offer to my estimate</span></label></div>',
     '<label class="inline-checkbox-label"><input type="checkbox" id="promoToggle" checked class="input-auto"> <span id="promoToggleLabel">Apply the current offer to my estimate</span></label></div>'),
    # Consent
    ('<div >\n          <label style="display: flex; align-items: flex-start; font-size: .92rem; color: var(--body-text); cursor: pointer">\n            <input type="checkbox" id="consentCheck" style="width: auto; flex-shrink: 0">\n            <span>I consent to Lustique Co. processing my personal information to prepare my quote and contact me about my enquiry, as described in the <a href="privacy.html" target="_blank" style="color:var(--burgundy);">Privacy Policy</a>. (Required)</span>\n          </label>\n        </div>',
     '<div class="consent-section">\n          <label class="field-label-start">\n            <input type="checkbox" id="consentCheck" class="input-auto">\n            <span>I consent to Lustique Co. processing my personal information to prepare my quote and contact me about my enquiry, as described in the <a href="privacy.html" target="_blank" class="consent-text">Privacy Policy</a>. (Required)</span>\n          </label>\n        </div>'),
    # Submit button
    ('<button type="button" class="btn btn-primary" id="sendEnquiry" style="width:100%;justify-content:center;">',
     '<button type="button" class="btn btn-primary btn-full" id="sendEnquiry">'),
    # Status
    ('<p class="note center" id="enquiryStatus" role="alert" style="color: #c04a5a"></p>',
     '<p class="note center status-error" id="enquiryStatus" role="alert"></p>'),
    # Hidden sections
    ('<div class="form-step reveal" id="eventFields" style="display:none;">',
     '<div class="form-step reveal form-hidden" id="eventFields">'),
    ('<div role="group" aria-labelledby="evHairLabel" id="evHairWrap" style="display: none">',
     '<div role="group" aria-labelledby="evHairLabel" id="evHairWrap" class="form-hidden">'),
]

# === Process quote.astro ===
QUOTE_PATH = "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/src/pages/quote.astro"
with open(QUOTE_PATH, "r") as f:
    content = f.read()

for old, new in QUOTE_REPLACEMENTS:
    if old in content:
        content = content.replace(old, new)
    else:
        print(f"  WARNING: not found: {old[:60]}...")

with open(QUOTE_PATH, "w") as f:
    f.write(content)

print(f"✅ Processed quote.astro — {len(QUOTE_REPLACEMENTS)} replacements")

# === Add CSS classes to global.css ===
CSS_PATH = "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/src/styles/global.css"
with open(CSS_PATH, "r") as f:
    css = f.read()

css += "\n" + NEW_CSS
with open(CSS_PATH, "w") as f:
    f.write(css)

print(f"✅ Added {len(NEW_CSS)} chars of CSS utility classes to global.css")

# === Also fix booking-received.astro ===
BOOKING_PATH = "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/src/pages/booking-received.astro"
if os.path.exists(BOOKING_PATH):
    with open(BOOKING_PATH, "r") as f:
        content = f.read()
    # Replace inline styles with utility classes
    content = content.replace(
        '<p style="text-align:center;font-size:1.12rem;">',
        '<p class="center" style="font-size:clamp(1.12rem,2vw,1.2rem);">'
    )
    content = content.replace(
        '<ol style="max-width: 46ch; line-height: 2.1">',
        '<ol class="maxw-text" style="line-height:2.1;">'
    )
    content = content.replace(
        '<div style="display: grid; max-width: 48ch; text-align: left">',
        '<div class="form-group-inline maxw-text" style="text-align:left;">'
    )
    content = content.replace(
        '<div style="border: 1px solid #ece4da; background: #fcf9f5">',
        '<div class="form-group-box">'
    )
    with open(BOOKING_PATH, "w") as f:
        f.write(content)
    print(f"✅ Processed booking-received.astro")

# === 404 page ===
NOTFOUND_PATH = "/Users/pieter/Layer-Zero-Studios/Custom Builds/Lustique/site/src/pages/404.astro"
if os.path.exists(NOTFOUND_PATH):
    with open(NOTFOUND_PATH, "r") as f:
        content = f.read()
    content = content.replace(
        '<section class="page-hero" style="min-height:62vh;display:flex;flex-direction:column;justify-content:center;">',
        '<section class="page-hero hero-alt">'
    )
    content = content.replace(
        '<div style="display: flex; justify-content: center; flex-wrap: wrap">',
        '<div class="form-group-inline justify-center">'
    )
    with open(NOTFOUND_PATH, "w") as f:
        f.write(content)
    # Add CSS
    with open(CSS_PATH, "r") as f:
        css = f.read()
    if ".hero-alt" not in css:
        css += "\n.hero-alt { min-height: 62vh; display: flex; flex-direction: column; justify-content: center; }\n.justify-center { justify-content: center; }\n"
        with open(CSS_PATH, "w") as f:
            f.write(css)
    print(f"✅ Processed 404.astro")

print("\nDone! Now run: npm run build --workspace site")