/**
 * One-off OAuth flow: gets a Wave refresh_token and queries business/product/account IDs.
 *
 * Usage:
 *   WAVE_CLIENT_ID="..." WAVE_CLIENT_SECRET="..." node scripts/wave-auth.mjs
 *
 * It opens your browser to authorize, catches the callback on localhost:8765,
 * exchanges the code for tokens, then prints the wrangler secret put commands.
 *
 * Delete this file after running.
 */
import http from "http";
import { exec } from "child_process";

const CLIENT_ID = process.env.WAVE_CLIENT_ID;
const CLIENT_SECRET = process.env.WAVE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8765/callback";
const TOKEN_URL = "https://api.waveapps.com/oauth2/token/";
const WAVE_URL = "https://gql.waveapps.com/graphql/public";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set WAVE_CLIENT_ID and WAVE_CLIENT_SECRET before running.");
  process.exit(1);
}

const authUrl =
  `https://api.waveapps.com/oauth2/authorize/?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&response_type=code&scope=account%3Aread%20account%3Awrite` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

console.log("\nOpening Wave authorization in your browser...");
console.log("If it doesn't open, visit:\n", authUrl, "\n");
exec(`open "${authUrl}"`);

// Local server to catch the OAuth callback
const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost:8765");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    res.writeHead(200, { "Content-Type": "text/html" });
    if (code) {
      res.end("<h2>Authorized ✓ — you can close this tab and return to the terminal.</h2>");
      server.close();
      resolve(code);
    } else {
      res.end(`<h2>Error: ${error ?? "unknown"}</h2>`);
      server.close();
      reject(new Error(`Wave OAuth error: ${error}`));
    }
  });
  server.listen(8765, () => console.log("Waiting for Wave to redirect to localhost:8765..."));
});

console.log("\nExchanging code for tokens...");
const tokenRes = await fetch(TOKEN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  }),
});
const tokens = await tokenRes.json();
if (!tokenRes.ok || !tokens.access_token) {
  console.error("Token exchange failed:", JSON.stringify(tokens, null, 2));
  process.exit(1);
}

const { access_token, refresh_token } = tokens;
console.log("Tokens obtained.\n");

// Query Wave for business, products, and bank accounts
async function gql(query, variables = {}) {
  const r = await fetch(WAVE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
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

console.log("=== BUSINESSES ===");
businesses.forEach(b => console.log(`  ${b.id}  ${b.name}  (${b.currency.code})`));

const bizId = businesses[0].id;

const [productData, accountData] = await Promise.all([
  gql(`query($id:ID!){ business(id:$id){ products(page:1,pageSize:50){ edges{ node{ id name unitPrice } } } } }`, { id: bizId }),
  gql(`query($id:ID!){ business(id:$id){ accounts(types:[BANK],page:1,pageSize:50){ edges{ node{ id name accountNumber } } } } }`, { id: bizId }),
]);

console.log("\n=== PRODUCTS / SERVICES ===");
productData.business.products.edges.forEach(e =>
  console.log(`  ${e.node.id}  ${e.node.name}  (R${e.node.unitPrice ?? "—"})`)
);

console.log("\n=== BANK ACCOUNTS ===");
accountData.business.accounts.edges.forEach(e =>
  console.log(`  ${e.node.id}  ${e.node.name}  ${e.node.accountNumber ?? ""}`)
);

console.log("\n=== RUN THESE WRANGLER COMMANDS ===");
console.log(`\n1. wrangler secret put WAVE_BUSINESS_ID --name lustique-form-handler`);
console.log(`   → paste: ${bizId}`);
console.log(`\n2. wrangler secret put WAVE_CLIENT_ID --name lustique-form-handler`);
console.log(`   → paste: ${CLIENT_ID}`);
console.log(`\n3. wrangler secret put WAVE_CLIENT_SECRET --name lustique-form-handler`);
console.log(`   → paste: (your client secret)`);
console.log(`\n4. wrangler secret put WAVE_REFRESH_TOKEN --name lustique-form-handler`);
console.log(`   → paste: ${refresh_token}`);
console.log(`\n5. wrangler secret put WAVE_PRODUCT_ID --name lustique-form-handler`);
console.log(`   → paste the product ID above (the bridal booking service)`);
console.log(`\n6. wrangler secret put WAVE_BANK_ACCOUNT_ID --name lustique-form-handler`);
console.log(`   → paste the bank account ID above`);
console.log(`\nNote: WAVE_API_KEY is no longer needed — delete it:`);
console.log(`  wrangler secret delete WAVE_API_KEY --name lustique-form-handler`);
