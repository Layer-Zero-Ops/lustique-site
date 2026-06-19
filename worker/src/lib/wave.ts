/**
 * Wave accounting API client (S8).
 *
 * Wave uses GraphQL at https://gql.waveapps.com/graphql/public.
 * Auth: OAuth 2.0 — WAVE_REFRESH_TOKEN + WAVE_CLIENT_ID + WAVE_CLIENT_SECRET
 *       are exchanged for a short-lived access token before each request.
 *
 * Callers guard on `env.WAVE_CLIENT_ID && env.WAVE_BUSINESS_ID` before calling;
 * all functions throw on failure so callers can catch, audit-log, and continue.
 *
 * fetch is injectable for unit tests.
 */

export interface WaveEnv {
  WAVE_CLIENT_ID?: string;      // OAuth app client ID
  WAVE_CLIENT_SECRET?: string;  // OAuth app client secret
  WAVE_REFRESH_TOKEN?: string;  // Long-lived refresh token (from wave-auth.mjs one-off)
  WAVE_BUSINESS_ID?: string;    // Wave business UUID
  WAVE_PRODUCT_ID?: string;     // Wave product/service ID for invoice line items
  WAVE_BANK_ACCOUNT_ID?: string; // Wave account where payments are received
  // Legacy: direct Bearer token (falls back if refresh flow not configured)
  WAVE_API_KEY?: string;
}

const WAVE_URL = "https://gql.waveapps.com/graphql/public";
const WAVE_TOKEN_URL = "https://api.waveapps.com/oauth2/token/";

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/** Exchange refresh token for a short-lived access token. */
async function getAccessToken(env: WaveEnv, f: typeof fetch): Promise<string> {
  if (env.WAVE_REFRESH_TOKEN && env.WAVE_CLIENT_ID && env.WAVE_CLIENT_SECRET) {
    const r = await f(WAVE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.WAVE_CLIENT_ID,
        client_secret: env.WAVE_CLIENT_SECRET,
        refresh_token: env.WAVE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!r.ok) throw new Error(`Wave token refresh HTTP ${r.status}: ${await r.text()}`);
    const body = (await r.json()) as { access_token?: string; error?: string };
    if (!body.access_token) throw new Error(`Wave token refresh failed: ${body.error ?? "no access_token"}`);
    return body.access_token;
  }
  // Legacy fallback: static API key
  if (env.WAVE_API_KEY) return env.WAVE_API_KEY;
  throw new Error("Wave: no credentials configured (need WAVE_REFRESH_TOKEN+CLIENT or WAVE_API_KEY)");
}

async function gql<T>(
  env: WaveEnv,
  query: string,
  variables: Record<string, unknown>,
  f: typeof fetch,
): Promise<T> {
  const token = await getAccessToken(env, f);
  const r = await f(WAVE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`Wave HTTP ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as GqlResponse<T>;
  if (body.errors?.length) throw new Error(`Wave GQL: ${body.errors.map((e) => e.message).join("; ")}`);
  if (!body.data) throw new Error("Wave: empty data response");
  return body.data;
}

// ── customerCreate ────────────────────────────────────────────────────────────

const CUSTOMER_CREATE = `
  mutation CustomerCreate($businessId: ID!, $input: CustomerCreateInput!) {
    customerCreate(businessId: $businessId, input: $input) {
      didSucceed
      inputErrors { message code }
      customer { id }
    }
  }
`;

interface CustomerCreateData {
  customerCreate: {
    didSucceed: boolean;
    inputErrors: Array<{ message: string; code: string }>;
    customer: { id: string } | null;
  };
}

/** Create a Wave customer. Returns the Wave customer ID. */
export async function createCustomer(
  env: WaveEnv,
  name: string,
  email: string,
  f: typeof fetch = fetch,
): Promise<string> {
  const data = await gql<CustomerCreateData>(
    env,
    CUSTOMER_CREATE,
    { businessId: env.WAVE_BUSINESS_ID!, input: { name, email, currency: "ZAR" } },
    f,
  );
  if (!data.customerCreate.didSucceed || !data.customerCreate.customer) {
    const errs = data.customerCreate.inputErrors.map((e) => e.message).join("; ");
    throw new Error(`Wave customerCreate failed: ${errs}`);
  }
  return data.customerCreate.customer.id;
}

// ── invoiceCreate ─────────────────────────────────────────────────────────────

const INVOICE_CREATE = `
  mutation InvoiceCreate($businessId: ID!, $input: InvoiceCreateInput!) {
    invoiceCreate(businessId: $businessId, input: $input) {
      didSucceed
      inputErrors { message code }
      invoice { id }
    }
  }
`;

interface InvoiceCreateData {
  invoiceCreate: {
    didSucceed: boolean;
    inputErrors: Array<{ message: string; code: string }>;
    invoice: { id: string } | null;
  };
}

/**
 * Create a Wave invoice against the customer. Returns the Wave invoice ID.
 *
 * Requires WAVE_PRODUCT_ID — throws if absent so callers can catch and skip.
 * totalCents is split into one line item at the given amount (ZAR).
 * weddingDate ("YYYY-MM-DD") becomes the invoice date.
 */
export async function createInvoice(
  env: WaveEnv,
  waveCustomerId: string,
  reference: string,
  totalCents: number,
  weddingDate: string,
  f: typeof fetch = fetch,
): Promise<string> {
  if (!env.WAVE_PRODUCT_ID) throw new Error("Wave: WAVE_PRODUCT_ID not configured");
  const totalRand = totalCents / 100;
  const data = await gql<InvoiceCreateData>(
    env,
    INVOICE_CREATE,
    {
      businessId: env.WAVE_BUSINESS_ID!,
      input: {
        customerId: waveCustomerId,
        invoiceDate: weddingDate,
        memo: `Lustique Co. bridal booking · ref ${reference}`,
        status: "SAVED",
        itemsCreate: [
          {
            productId: env.WAVE_PRODUCT_ID,
            quantity: "1",
            unitPrice: totalRand,
            description: `Wedding hair & makeup · ref ${reference}`,
          },
        ],
      },
    },
    f,
  );
  if (!data.invoiceCreate.didSucceed || !data.invoiceCreate.invoice) {
    const errs = data.invoiceCreate.inputErrors.map((e) => e.message).join("; ");
    throw new Error(`Wave invoiceCreate failed: ${errs}`);
  }
  return data.invoiceCreate.invoice.id;
}

// ── invoicePaymentCreate ──────────────────────────────────────────────────────

const PAYMENT_CREATE = `
  mutation InvoicePaymentCreate($businessId: ID!, $input: InvoicePaymentCreateInput!) {
    invoicePaymentCreate(businessId: $businessId, input: $input) {
      didSucceed
      inputErrors { message code }
    }
  }
`;

interface PaymentCreateData {
  invoicePaymentCreate: {
    didSucceed: boolean;
    inputErrors: Array<{ message: string; code: string }>;
  };
}

/**
 * Record a payment against a Wave invoice.
 *
 * Requires WAVE_BANK_ACCOUNT_ID — throws if absent.
 * amountCents is the net amount received (not the gross amount with card fees).
 * paymentDate: "YYYY-MM-DD"
 */
export async function recordPayment(
  env: WaveEnv,
  waveInvoiceId: string,
  amountCents: number,
  paymentDate: string,
  memo: string,
  f: typeof fetch = fetch,
): Promise<void> {
  if (!env.WAVE_BANK_ACCOUNT_ID) throw new Error("Wave: WAVE_BANK_ACCOUNT_ID not configured");
  const data = await gql<PaymentCreateData>(
    env,
    PAYMENT_CREATE,
    {
      businessId: env.WAVE_BUSINESS_ID!,
      input: {
        invoiceId: waveInvoiceId,
        paymentAccountId: env.WAVE_BANK_ACCOUNT_ID,
        paymentDate,
        amount: amountCents / 100,
        memo,
      },
    },
    f,
  );
  if (!data.invoicePaymentCreate.didSucceed) {
    const errs = data.invoicePaymentCreate.inputErrors.map((e) => e.message).join("; ");
    throw new Error(`Wave invoicePaymentCreate failed: ${errs}`);
  }
}
