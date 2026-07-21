/**
 * One-off script: queries the Wave GraphQL API to find the IDs needed for
 * WAVE_BUSINESS_ID, WAVE_PRODUCT_ID, and WAVE_BANK_ACCOUNT_ID.
 *
 * Usage (OAuth client credentials — recommended):
 *   WAVE_CLIENT_ID="..." WAVE_CLIENT_SECRET="..." node scripts/query-wave.mjs
 *
 * Usage (direct Bearer token — if you have a valid Full Access Token):
 *   WAVE_API_KEY="wfa_..." node scripts/query-wave.mjs
 *
 * Delete this file once the secrets are stored in Wrangler.
 */

const WAVE_URL = "https://gql.waveapps.com/graphql/public";
const TOKEN_URL = "https://api.waveapps.com/oauth2/token/";

// Get access token: either via OAuth client credentials, or use direct key
let key = process.env.WAVE_API_KEY;

const clientId = process.env.WAVE_CLIENT_ID;
const clientSecret = process.env.WAVE_CLIENT_SECRET;

if (clientId && clientSecret) {
  console.log("Using OAuth client credentials flow...");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const body = await r.json();
  if (!r.ok || !body.access_token) {
    console.error("OAuth token exchange failed:", JSON.stringify(body, null, 2));
    process.exit(1);
  }
  key = body.access_token;
  console.log("Access token obtained.\n");
} else if (!key) {
  console.error("Set either:\n  WAVE_CLIENT_ID + WAVE_CLIENT_SECRET  (OAuth flow)\n  WAVE_API_KEY  (direct Bearer token)");
  process.exit(1);
}

async function gql(query, variables = {}) {
  const r = await fetch(WAVE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`Wave HTTP ${r.status}: ${await r.text()}`);
  const body = await r.json();
  if (body.errors?.length) throw new Error(`Wave GQL: ${body.errors.map(e => e.message).join("; ")}`);
  return body.data;
}

const businessData = await gql(`{
  businesses(page: 1, pageSize: 10) {
    edges { node { id name currency { code } } }
  }
}`);

const businesses = businessData.businesses.edges.map(e => e.node);
if (!businesses.length) { console.error("No Wave businesses found."); process.exit(1); }

console.log("\n=== BUSINESSES ===");
businesses.forEach(b => console.log(`  ${b.id}  ${b.name}  (${b.currency.code})`));

const bizId = businesses[0].id;
console.log(`\nUsing first business: ${businesses[0].name}`);

const [productData, accountData] = await Promise.all([
  gql(`query($id: ID!) {
    business(id: $id) {
      products(page: 1, pageSize: 50) {
        edges { node { id name unitPrice } }
      }
    }
  }`, { id: bizId }),

  gql(`query($id: ID!) {
    business(id: $id) {
      accounts(types: [BANK], page: 1, pageSize: 50) {
        edges { node { id name accountNumber } }
      }
    }
  }`, { id: bizId }),
]);

console.log("\n=== PRODUCTS / SERVICES ===");
productData.business.products.edges.forEach(e =>
  console.log(`  ${e.node.id}  ${e.node.name}  (R${e.node.unitPrice ?? "—"})`)
);

console.log("\n=== BANK ACCOUNTS ===");
accountData.business.accounts.edges.forEach(e =>
  console.log(`  ${e.node.id}  ${e.node.name}  ${e.node.accountNumber ?? ""}`)
);

console.log("\n=== WRANGLER COMMANDS ===");
console.log(`wrangler secret put WAVE_BUSINESS_ID --name lustique-form-handler`);
console.log(`  → paste: ${bizId}`);
console.log(`wrangler secret put WAVE_PRODUCT_ID --name lustique-form-handler`);
console.log(`  → paste the product ID above that matches Lustique's booking service`);
console.log(`wrangler secret put WAVE_BANK_ACCOUNT_ID --name lustique-form-handler`);
console.log(`  → paste the bank account ID above`);
