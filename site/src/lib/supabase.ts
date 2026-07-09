const SUPABASE_URL =
  (import.meta.env.SUPABASE_URL as string | undefined) ||
  "https://ywoovdpnphcogwgoqhst.supabase.co";
const SUPABASE_ANON_KEY =
  (import.meta.env.SUPABASE_ANON_KEY as string | undefined) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3b292ZHBucGhjb2d3Z29xaHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTI2MTUsImV4cCI6MjA5NjkyODYxNX0.hUxMUBrm8sKOj2E3Uv6OG5J1EYGPn4ToCF14y1OtgII";

/**
 * One retry before giving up — a build-time fetch failure here (e.g. a transient
 * network/DNS blip reaching Supabase) must never hard-fail the entire site build and
 * block deploying unrelated fixes. Worst case: this build's blog listing comes up
 * short, logged loudly, instead of the whole site failing to ship.
 */
export async function supabaseGet<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const attempt = () =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
  try {
    let res: Response;
    try {
      res = await attempt();
    } catch {
      res = await attempt(); // one retry on network-level failure
    }
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch (err) {
    console.error(`[supabaseGet] build-time fetch failed for "${path}" after retry — continuing with an empty result:`, err);
    return [];
  }
}

export const storageUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/Portfolio/${path}`;
