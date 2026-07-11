/**
 * Brevo Campaign API (marketing sends) + contact-list upsert — kept separate from the
 * transactional sendEmail() in email.ts because they're different Brevo APIs with different
 * compliance behavior: campaigns auto-attach the required unsubscribe link and respect Brevo's
 * suppression list; the transactional API does neither. Never send bulk marketing mail through
 * sendEmail() — this module is the only correct path for that.
 */

export interface BrevoEnv {
  BREVO_API_KEY: string;
}

/** Add (or update) a contact on a Brevo list. 201 = created, 204 = already existed — both OK. */
export async function upsertBrevoContact(
  env: BrevoEnv,
  email: string,
  listId: number,
  f: typeof fetch = fetch,
): Promise<void> {
  const r = await f("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, listIds: [listId], updateEnabled: true }),
  });
  if (!r.ok && r.status !== 204) {
    throw new Error(`Brevo contact upsert ${r.status}: ${await r.text()}`);
  }
}

export interface CampaignOpts {
  subject: string;
  htmlContent: string;
  listId: number;
  senderEmail: string;
  senderName?: string;
}

/** Create a classic campaign targeting one list, then send it immediately. Returns the campaign id. */
export async function createAndSendCampaign(
  env: BrevoEnv,
  opts: CampaignOpts,
  f: typeof fetch = fetch,
): Promise<{ id: number }> {
  const createRes = await f("https://api.brevo.com/v3/emailCampaigns", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      name: `${opts.subject} — ${new Date().toISOString().slice(0, 10)}`,
      subject: opts.subject,
      sender: { name: opts.senderName ?? "Lustique Co.", email: opts.senderEmail },
      type: "classic",
      htmlContent: opts.htmlContent,
      recipients: { listIds: [opts.listId] },
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Brevo campaign create ${createRes.status}: ${await createRes.text()}`);
  }
  const { id } = (await createRes.json()) as { id: number };

  const sendRes = await f(`https://api.brevo.com/v3/emailCampaigns/${id}/sendNow`, {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, accept: "application/json" },
  });
  if (!sendRes.ok) {
    throw new Error(`Brevo campaign send ${sendRes.status}: ${await sendRes.text()}`);
  }
  return { id };
}
