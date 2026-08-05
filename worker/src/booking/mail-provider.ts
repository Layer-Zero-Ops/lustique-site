// worker/src/booking/mail-provider.ts
// Phase 9 — mailbox-agnostic email ingestion for the dashboard inbox.
// A single interface (MailProvider) so Spacemail (primary) and Gmail (transition
// overlap) are swappable. The sync job (run on a schedule / cron) pulls new messages
// into the `messages` table. Only snippet + headers + deep-link are stored (POPIA).

export interface RawMessage {
  externalId: string;
  threadId?: string;
  fromName?: string;
  fromEmail: string;
  toEmail?: string;
  subject?: string;
  snippet: string;
  receivedAt: string; // ISO
}

export interface MailProvider {
  readonly name: "spacemail" | "gmail";
  /** Fetch messages newer than `sinceUid`/`sinceHistory`, up to `limit`. */
  fetchNew(since: string | null, limit: number): Promise<RawMessage[]>;
}

/** Pure: shape a RawMessage into the DB row (provider-tagged, dedup key). */
export function normalise(provider: "spacemail" | "gmail", m: RawMessage) {
  return {
    provider,
    external_id: m.externalId,
    thread_id: m.threadId ?? null,
    from_name: m.fromName ?? null,
    from_email: m.fromEmail,
    to_email: m.toEmail ?? null,
    subject: m.subject ?? null,
    snippet: m.snippet,
    received_at: m.receivedAt,
    is_read: false,
    is_archived: false,
  };
}

/**
 * Pure dedup/merge decision for the sync loop (testable without I/O).
 * Returns the subset of raw messages that are NOT already present in `knownIds`.
 */
export function pickNew(raw: RawMessage[], knownIds: Set<string>): RawMessage[] {
  return raw.filter((m) => !knownIds.has(m.externalId));
}

// ── Spacemail provider (IMAP/API). Credentials from env at call time. ──
export interface SpacemailConfig {
  imapHost: string;
  imapPort: number;
  username: string;
  password: string; // app password, never the mailbox login password
}

/**
 * Spacemail fetch. A CF Worker cannot hold a persistent IMAP connection, so this is
 * invoked by a scheduled job (Supabase Edge Function or Worker cron) that polls IMAP
 * every ~5–10 min. The actual IMAP library call happens in the runtime (injected `f`);
 * here we define the provider shape + config validation. The real fetch is wired when
 * Spacemail creds land (Pieter creates the account). SMTP send (reply) uses the same
 * config over the Spacemail SMTP endpoint.
 */
export function makeSpacemailProvider(cfg: SpacemailConfig): MailProvider {
  return {
    name: "spacemail",
    async fetchNew(_since: string | null, _limit: number): Promise<RawMessage[]> {
      // Injected IMAP client would run here. Until creds land, returns [] (no-op sync).
      void cfg;
      return [];
    },
  };
}

// ── Gmail provider (transition overlap only; read-only). ──
export interface GmailConfig {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}
export function makeGmailProvider(_cfg: GmailConfig): MailProvider {
  return {
    name: "gmail",
    async fetchNew(_since: string | null, _limit: number): Promise<RawMessage[]> {
      // Gmail API history.list + messages.get; wired when Workspace OAuth consent lands.
      return [];
    },
  };
}
