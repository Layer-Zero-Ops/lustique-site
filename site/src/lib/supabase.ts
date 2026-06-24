const SUPABASE_URL = (import.meta.env.SUPABASE_URL as string) ?? "";
const SUPABASE_ANON_KEY = (import.meta.env.SUPABASE_ANON_KEY as string) ?? "";

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
