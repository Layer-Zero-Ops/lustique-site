const SUPABASE_URL =
  (import.meta.env.SUPABASE_URL as string | undefined) ||
  "https://ywoovdpnphcogwgoqhst.supabase.co";
const SUPABASE_ANON_KEY =
  (import.meta.env.SUPABASE_ANON_KEY as string | undefined) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3b292ZHBucGhjb2d3Z29xaHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTI2MTUsImV4cCI6MjA5NjkyODYxNX0.hUxMUBrm8sKOj2E3Uv6OG5J1EYGPn4ToCF14y1OtgII";

export async function supabaseGet<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) return [];
  return res.json() as Promise<T[]>;
}

export const storageUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/Portfolio/${path}`;
