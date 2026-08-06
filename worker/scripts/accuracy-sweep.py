#!/usr/bin/env python3
"""
Lustique Co. — Daily Accuracy Sweep (read-only data-quality safety net).

Runs four read-only queries against the Supabase production DB and prints a
flag report.  Designed for the 07:00 SAST Hermes cron job that delivers to
Zandeline's Telegram (chat_id 8770101026).

Checks:
  1. R0-total bookings with populated quote_lines  (parseTotalCents bug)
  2. Stalled enquiries — status=new & created_at > 48h ago
  3. Orphan conversions — converted enquiries with no matching booking
  4. Email-send failures in the audit_log (last 24h)

Golden rule: GET requests only.  Never INSERT/UPDATE/DELETE/PATCH.
"""

import os
import sys
import json
import datetime
import urllib.request
import urllib.error
import urllib.parse

# ── Credentials ────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    # Fallback: read credential files at repo root (git-ignored)
    _proj = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if not SUPABASE_URL:
        _f = os.path.join(_proj, ".supabase-url")
        SUPABASE_URL = open(_f).read().strip() if os.path.isfile(_f) else ""
    if not SUPABASE_KEY:
        _f = os.path.join(_proj, ".supabase-service-key")
        SUPABASE_KEY = open(_f).read().strip() if os.path.isfile(_f) else ""

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY not found in env or credential files.")
    sys.exit(1)

BASE = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Accept": "application/json",
}

HOURS_STALE_ENQUIRY = 48
HOURS_EMAIL_FAIL = 24

# ── Helpers ──────────────────────────────────────────────────────────────────

def query(rest_path):
    """GET /rest/v1/<rest_path> — read-only."""
    url = f"{BASE}/{rest_path}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            if isinstance(data, list):
                return data
            # Error dict from PostgREST
            return {"error": data}
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:400]
        return {"error": e.code, "body": body}


def cents_to_zar(cents):
    if cents is None:
        return "—"
    return f"R{cents / 100:,.0f}"


def fmt_ts(ts):
    if not ts:
        return "—"
    return ts[:10]


# ── Checks ───────────────────────────────────────────────────────────────────

def check_r0_bookings():
    """Bookings where total_cents=0 but quote_lines is a non-empty array."""
    rows = query(
        "bookings?total_cents=eq.0"
        "&select=reference,bride_name,bride_email,total_cents,quote_lines,"
        "wedding_date,status,created_at"
        "&order=created_at.desc"
    )
    if not isinstance(rows, list):
        return {"count": 0, "items": [], "error": rows}
    flags = []
    for b in rows:
        ql = b.get("quote_lines")
        if isinstance(ql, list) and len(ql) > 0:
            flags.append({
                "reference": b.get("reference"),
                "bride_name": b.get("bride_name"),
                "bride_email": b.get("bride_email"),
                "wedding_date": fmt_ts(b.get("wedding_date")),
                "quote_lines_count": len(ql),
            })
    return {"count": len(flags), "items": flags}


def check_stalled_enquiries():
    """Enquiries with status=new and created_at older than 48h."""
    cutoff = (
        datetime.datetime.now(datetime.timezone.utc)
        - datetime.timedelta(hours=HOURS_STALE_ENQUIRY)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    encoded = urllib.parse.quote(cutoff, safe="")
    rows = query(
        f"enquiries?status=eq.new&created_at=lt.{encoded}"
        "&select=id,name,email,created_at,referral_source"
        "&order=created_at.asc"
    )
    if not isinstance(rows, list):
        return {"count": 0, "items": [], "error": rows}
    flags = []
    for e in rows:
        flags.append({
            "name": e.get("name"),
            "email": e.get("email"),
            "created_at": fmt_ts(e.get("created_at")),
        })
    return {"count": len(flags), "items": flags}


def check_orphan_conversions():
    """Converted enquiries whose email does not match any booking's bride_email.

    Uses URL-encoded email to handle special chars like '+' in test addresses.
    Also cross-checks booking_id linkage for context.
    """
    rows = query(
        "enquiries?status=eq.converted"
        "&select=id,name,email,booking_id,created_at"
        "&order=created_at.desc"
    )
    if not isinstance(rows, list):
        return {"count": 0, "items": [], "error": rows}
    flags = []
    for e in rows:
        email = e.get("email", "")
        booking_id = e.get("booking_id")
        # Check by email (URL-encoded to handle '+' etc.)
        enc_email = urllib.parse.quote(email, safe="")
        by_email = query(f"bookings?bride_email=eq.{enc_email}&select=id,reference,status&limit=1")
        email_matched = isinstance(by_email, list) and len(by_email) > 0

        # Also check by booking_id for context
        booking_id_valid = False
        booking_ref = None
        if booking_id:
            by_id = query(f"bookings?id=eq.{booking_id}&select=reference,status&limit=1")
            if isinstance(by_id, list) and len(by_id) > 0:
                booking_id_valid = True
                booking_ref = by_id[0].get("reference")

        if not email_matched:
            flags.append({
                "name": e.get("name"),
                "email": email,
                "email_matched": email_matched,
                "booking_id_valid": booking_id_valid,
                "booking_reference": booking_ref,
            })
    return {"count": len(flags), "items": flags}


def check_email_failures():
    """Audit-log events related to email-send failures in the last 24h.

    Checks event_type values containing 'email' and/or 'fail'.
    """
    cutoff = (
        datetime.datetime.now(datetime.timezone.utc)
        - datetime.timedelta(hours=HOURS_EMAIL_FAIL)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    encoded = urllib.parse.quote(cutoff, safe="")
    rows = query(
        f"audit_log?created_at=gt.{encoded}"
        "&select=event_type,booking_id,created_at,payload"
        "&order=created_at.desc&limit=100"
    )
    if not isinstance(rows, list):
        return {"count": 0, "items": [], "error": rows}
    # Look for any event_type containing 'email' or 'fail'
    failures = [
        e for e in rows
        if "email" in (e.get("event_type", "")).lower()
        or "fail" in (e.get("event_type", "")).lower()
    ]
    return {"count": len(failures), "items": failures}


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    print(f"Lustique Accuracy Sweep — {now.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("=" * 60)

    r0 = check_r0_bookings()
    print(f"\n1. R0-total bookings (total_cents=0, quote_lines present):")
    if r0["count"] == 0:
        print("   ✅ Clean — no R0-total bookings with line items.")
    else:
        print(f"   ⚠️  {r0['count']} booking(s) flagged:")
        for b in r0["items"]:
            print(f"     • {b['reference']} {b['bride_name']} "
                  f"({b['wedding_date']}) — {b['quote_lines_count']} line items, total 0")

    stalled = check_stalled_enquiries()
    print(f"\n2. Stalled enquiries (status=new, >{HOURS_STALE_ENQUIRY}h old):")
    if stalled["count"] == 0:
        print("   ✅ Clean — no stale new enquiries.")
    else:
        print(f"   ⚠️  {stalled['count']} enquiry(ies) flagged:")
        for e in stalled["items"]:
            print(f"     • {e['name']} ({e['email']}) — since {e['created_at']}")

    orphan = check_orphan_conversions()
    print(f"\n3. Orphan conversions (converted, no matching booking email):")
    if orphan["count"] == 0:
        print("   ✅ Clean — all conversions link to bookings.")
    else:
        print(f"   ⚠️  {orphan['count']} orphan(s) flagged:")
        for o in orphan["items"]:
            detail = ""
            if o.get("booking_id_valid"):
                detail = f" — booking_id resolves to {o.get('booking_reference')} (email mismatch)"
            print(f"     • {o['name']} ({o['email']}){detail}")

    email = check_email_failures()
    print(f"\n4. Email-send failures (audit_log, last {HOURS_EMAIL_FAIL}h):")
    if email["count"] == 0:
        print("   ✅ Clean — no email-send failures logged.")
    else:
        print(f"   ⚠️  {email['count']} failure(s) logged:")
        for f in email["items"]:
            print(f"     • {f.get('event_type')} — {f.get('created_at', '')[:19]}")

    print("\n" + "=" * 60)
    issues = r0["count"] + stalled["count"] + orphan["count"] + email["count"]
    if issues == 0:
        print("✅ ALL CLEAR — all quiet on the Lustique accuracy front.")
    else:
        print(f"⚠️  {issues} issue(s) flagged across 4 checks.")


if __name__ == "__main__":
    main()
