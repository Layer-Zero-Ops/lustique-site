// worker/src/lib/observe.ts
// Observability helpers: per-request correlation id + optional Sentry error reporting.
// Used by index.ts to wrap the route dispatch so EVERY response carries an
// X-Request-Id (for log correlation) and unexpected errors are reported.
//
// Sentry is OPTIONAL: if env.SENTRY_DSN is unset, reportError is a no-op. No SDK
// dependency — we POST directly to the Sentry store endpoint so the Worker bundle
// stays tiny. See wrangler.toml for the (commented) SENTRY_DSN var.

/** Generate a short, collision-resistant request id. */
export function newRequestId(): string {
  // crypto.randomUUID is available in the Workers runtime.
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/** Attach (or overwrite) the X-Request-Id header on a response. */
export function attachRequestId(res: Response, rid: string): Response {
  const headers = new Headers(res.headers);
  headers.set("X-Request-Id", rid);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

interface SentryEnv {
  SENTRY_DSN?: string;
}

/** Report an unexpected error to Sentry if configured. Never throws. */
export async function reportError(
  env: SentryEnv,
  rid: string,
  err: unknown,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return; // observability gracefully off
  try {
    const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn);
    if (!m) return;
    const [, key, host, project] = m;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const body = JSON.stringify({
      event_id: rid,
      platform: "javascript",
      message,
      stacktrace: stack ? { frames: [{ filename: "worker", function: "<anonymous>", lineno: 1, in_app: true }] } : undefined,
      extra: { rid },
      timestamp: new Date().toISOString(),
    });
    await fetchFn(`https://${host}/api/${project}/store/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}`,
      },
      body,
    }).catch(() => {});
  } catch {
    /* never break the request path over observability */
  }
}
