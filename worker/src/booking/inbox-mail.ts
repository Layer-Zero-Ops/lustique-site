// worker/src/booking/inbox-mail.ts
// Phase 9 — email sync job: pulls new messages from the active MailProvider into the
// `messages` table. Triggered by a scheduled cron OR the "Sync mail" dashboard button.
// POPIA: only snippet + headers + deep-link stored; never the full body.

import { getAdminSession, type AdminUser, type AuthEnv } from "./auth";
import { type DbEnv } from "./db";
import { makeSpacemailProvider, normalise, pickNew, type RawMessage } from "./mail-provider";

export interface MailSyncEnv extends AuthEnv, DbEnv {
  SUPABASE_JWT_SECRET: string;
  SIGNING_SECRET: string;
  // Spacemail IMAP/SMTP (set as secrets when the account is created)
  SPACEMAIL_IMAP_HOST?: string;
  SPACEMAIL_IMAP_PORT?: string;
  SPACEMAIL_USER?: string;
  SPACEMAIL_APP_PASSWORD?: string;
}

/**
 * Run one sync pass. `provider` is injected so tests can use a fake; in production it
 * is built from Spacemail (or Gmail) env. Returns how many new messages were stored.
 */
export async function runMailSync(
  env: MailSyncEnv,
  provider: { fetchNew(since: string | null, limit: number): Promise<RawMessage[]> },
  f: typeof fetch = fetch,
): Promise<number> {
  if (!env.SPACEMAIL_USER || !env.SPACEMAIL_APP_PASSWORD) return 0; // not configured yet

  // Last synced external id (cheap: newest message by received_at)
  const last = await f(`${env.SUPABASE_URL}/rest/v1/messages?select=external_id,received_at&provider=eq.spacemail&order=received_at.desc&limit=1`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  const lastRows = last.ok ? ((await last.json()) as Array<{ external_id: string; received_at: string }>) : [];
  const since = lastRows[0]?.received_at ?? null;

  const raw = await provider.fetchNew(since, 100);
  const known = new Set(lastRows.map((r) => r.external_id));
  const fresh = pickNew(raw, known).map((m) => normalise("spacemail", m));

  for (const row of fresh) {
    await f(`${env.SUPABASE_URL}/rest/v1/messages`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  }
  return fresh.length;
}

/** POST /api/admin/inbox/sync — manual trigger from the dashboard. */
export async function handleAdminMailSync(
  req: Request,
  env: MailSyncEnv,
  f: typeof fetch = fetch,
): Promise<Response> {
  const session = await getAdminSession(req, env, f);
  if (!session) return new Response(null, { status: 302, headers: { Location: "/api/admin/login?msg=session-expired" } });

  const provider = makeSpacemailProvider({
    imapHost: env.SPACEMAIL_IMAP_HOST ?? "imap.spacemail.io",
    imapPort: Number(env.SPACEMAIL_IMAP_PORT ?? 993),
    username: env.SPACEMAIL_USER ?? "",
    password: env.SPACEMAIL_APP_PASSWORD ?? "",
  });
  const count = await runMailSync(env, provider, f);
  return new Response(null, { status: 302, headers: { Location: `/api/admin/inbox?synced=${count}` } });
}
