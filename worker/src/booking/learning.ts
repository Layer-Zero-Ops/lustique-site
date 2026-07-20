// worker/src/booking/learning.ts
// Self-optimization loop (Clio v2). See docs/ROADMAP-self-optimizing.md.
//
// learningPass(env) is called from the nightly scheduled() handler. It:
//   1. reads the agent ground-truth (GET /api/admin/clio/learning equivalent — here
//      we read the tables directly via the service key),
//   2. computes ONE candidate insight from real data (conversion / source mix / offer gaps),
//   3. WRITES a proposal to clio_proposals (status 'proposed') + notifies Zandeline.
//
// It NEVER applies a change. Application happens only after Zandeline approves
// (Telegram tap) and the apply path touches a CONFIG doc, not code. Failed
// experiments are auto-reverted by a separate timer (out of scope here).
//
// This file is INERT until migrations 0027/0028 are applied. Every table read
// degrades gracefully (empty array) so the nightly cron never throws.

import { type DashboardEnv } from "./dashboard";

// Local copies (these helpers are module-private in dashboard.ts; mirror the pattern
// used by blog.ts). Service-key auth; never client-side.
function supabaseUrl(env: DashboardEnv, path: string): string {
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  return `${base}/rest/v1/${path}`;
}
function supabaseHeaders(env: DashboardEnv): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

interface LearningState {
  learning: unknown[];
  openProposals: unknown[];
  safeChange: Array<{ doc: string; key: string; allowed: boolean }>;
}

interface ProposalSeed {
  area: string;
  hypotheis: string;
  expectedEffect: string;
  rollback: string;
  targetDoc: string;
  targetKey: string;
  currentValue?: unknown;
  rationale?: Record<string, unknown>;
}

/** Read the agent ground-truth in one shot (graceful: empty arrays if tables absent). */
async function readLearningState(env: DashboardEnv, fetchFn: typeof fetch): Promise<LearningState> {
  const get = async (path: string) => {
    const r = await fetchFn(supabaseUrl(env, path), { headers: supabaseHeaders(env) });
    return r.ok ? ((await r.json()) as unknown[]) : [];
  };
  const [learning, openProposals, safeChange] = await Promise.all([
    get("clio_learning?order=created_at.desc&limit=100&select=id,area,lesson,verdict,confidence,scope,tags"),
    get("clio_proposals?status=in.(proposed,approved,applied)&order=created_at.desc&limit=50&select=id,status,area"),
    get("clio_safe_change?select=doc,key,allowed"),
  ]);
  return {
    learning: learning as unknown[],
    openProposals: openProposals as unknown[],
    safeChange: safeChange as Array<{ doc: string; key: string; allowed: boolean }>,
  };
}

/** Persist a proposal (status 'proposed'). Inert until 0027 exists. */
async function writeProposal(env: DashboardEnv, fetchFn: typeof fetch, seed: ProposalSeed): Promise<boolean> {
  const r = await fetchFn(
    supabaseUrl(env, "clio_proposals"),
    {
      method: "POST",
      headers: { ...supabaseHeaders(env), "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "proposed",
        area: seed.area,
        hypotheis: seed.hypotheis,
        expected_effect: seed.expectedEffect,
        rollback: seed.rollback,
        target_doc: seed.targetDoc,
        target_key: seed.targetKey,
        current_value: seed.currentValue ?? null,
        rationale: seed.rationale ?? {},
      }),
    },
  );
  return r.ok;
}

/** Decide ONE candidate experiment from data. Pure function — easy to test, easy to extend. */
function decideCandidate(state: LearningState, data: { sourceMix?: Record<string, number>; trialConv?: number; portfolioConv?: number }): ProposalSeed | null {
  // Guard: never stack proposals — one open bet at a time keeps the loop safe.
  if (state.openProposals.length > 0) return null;

  // Example heuristic (extend with real GA4/Supabase queries): if Trial traffic
  // converts materially worse than Portfolio, propose a hero-line swap on the trial guide.
  if (
    data.trialConv != null &&
    data.portfolioConv != null &&
    data.trialConv + 1.5 < data.portfolioConv
  ) {
    return {
      area: "hero",
      hypotheis: "Trial-page visitors convert below portfolio traffic; a more outcome-led hero line should lift request rate.",
      expectedEffect: `Trial→request +~${((data.portfolioConv - data.trialConv) * 0.6).toFixed(1)}pp (measured on next cohort vs current ${data.trialConv}pp).`,
      rollback: "Restore prior hero line in siteSettings:hero_line.",
      targetDoc: "siteSettings",
      targetKey: "hero_line",
      rationale: { trialConv: data.trialConv, portfolioConv: data.portfolioConv },
    };
  }
  return null;
}

/**
 * Nightly learning pass. Returns the number of proposals written (0 or 1).
 * Safe to call every cron tick: reads are graceful, writes are single + gated.
 */
export async function learningPass(
  env: DashboardEnv,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  try {
    const state = await readLearningState(env, fetchFn);
    // TODO: replace the placeholder heuristics below with real queries
    // (GA4 via the now-wired measurement ID + Supabase booking/enquiry aggregation).
    const data = await gatherSignals(env, fetchFn);
    const candidate = decideCandidate(state, data);
    if (!candidate) return 0;
    const ok = await writeProposal(env, fetchFn, candidate);
    if (ok) {
      await fetchFn(
        supabaseUrl(env, "clio_activity"),
        {
          method: "POST",
          headers: { ...supabaseHeaders(env), "content-type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({
            event_type: "learning_proposal",
            title: `Proposed experiment: ${candidate.area}`,
            body: candidate.hypotheis,
            audience: "zandeline",
            payload: { area: candidate.area, expected_effect: candidate.expectedEffect },
          }),
        },
      ).catch(() => {});
    }
    return ok ? 1 : 0;
  } catch {
    return 0; // never break the nightly cron
  }
}

/**
 * Gather the real signals the loop reasons over. Placeholder aggregation —
 * the actual queries (GA4 events + Supabase enquiries/bookings) land here.
 * Returns {} today so the pass is inert until wired.
 */
async function gatherSignals(_env: DashboardEnv, _fetchFn: typeof fetch): Promise<Record<string, unknown>> {
  return {};
}
