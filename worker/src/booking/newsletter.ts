// POST /api/newsletter — add email to Brevo contact list for the newsletter.
// BREVO_NEWSLETTER_LIST_ID must be set as a Worker secret (numeric list ID from Brevo).

interface NewsletterEnv {
  BREVO_API_KEY: string;
  BREVO_NEWSLETTER_LIST_ID: string;
  ALLOWED_ORIGIN?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

export async function handleNewsletter(
  req: Request,
  env: NewsletterEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN ?? "https://lustiqueco.co.za";
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  let email = "";
  try {
    const body = (await req.json()) as { email?: unknown };
    email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid body" }), { status: 400, headers: cors });
  }

  if (!email || !EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid email" }), { status: 400, headers: cors });
  }

  const listId = parseInt(env.BREVO_NEWSLETTER_LIST_ID ?? "0", 10);
  if (!listId) {
    return new Response(JSON.stringify({ ok: false, error: "list not configured" }), { status: 503, headers: cors });
  }

  const res = await f("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ email, listIds: [listId], updateEnabled: true }),
  });

  // 201 = created, 204 = already exists (updateEnabled), both are success
  if (!res.ok && res.status !== 204) {
    return new Response(JSON.stringify({ ok: false }), { status: 502, headers: cors });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
}
