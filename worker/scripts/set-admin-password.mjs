#!/usr/bin/env node
// Sets a password on the Lustique admin Supabase user.
// Run: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node worker/scripts/set-admin-password.mjs
//
// Get these values from:
//   SUPABASE_URL        — Supabase dashboard → Settings → API → Project URL
//   SUPABASE_SERVICE_KEY — Supabase dashboard → Settings → API → service_role (secret)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const EMAIL = "info@lustiqueco.co.za";
const NEW_PASSWORD = process.env.ADMIN_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing env vars. Run:\n");
  console.error("  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=... ADMIN_PASSWORD=... node worker/scripts/set-admin-password.mjs\n");
  process.exit(1);
}
if (!NEW_PASSWORD) {
  console.error("Missing ADMIN_PASSWORD env var.");
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// 1. Find the user by email
const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(EMAIL)}&page=1&per_page=10`, { headers });
if (!listRes.ok) {
  console.error("Failed to list users:", listRes.status, await listRes.text());
  process.exit(1);
}
const { users } = await listRes.json();
const user = users?.find((u) => u.email === EMAIL);
if (!user) {
  console.error(`User ${EMAIL} not found in Supabase auth.`);
  process.exit(1);
}
console.log(`Found user: ${user.email} (${user.id})`);

// 2. Set the password and confirm the email — an unconfirmed email makes Supabase's
// password grant reject with "Email not confirmed" even with the correct password.
const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ password: NEW_PASSWORD, email_confirm: true }),
});
if (!updateRes.ok) {
  console.error("Failed to set password:", updateRes.status, await updateRes.text());
  process.exit(1);
}
console.log(`\n✓ Password set for ${EMAIL}.`);
console.log(`\nGo to: https://lustiqueco.co.za/api/admin/login`);
console.log(`Expand "Sign in with password instead" and use your new password.\n`);
