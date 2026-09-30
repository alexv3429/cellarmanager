const GTIN14 = /^[0-9]{14}$/;
const USER_AGENT = "CellarManager/0.6.15 (https://github.com/alexv3429/cellarmanager)";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function validGtin14(code) {
  if (typeof code !== "string" || !GTIN14.test(code) || !/[1-9]/.test(code)) return false;
  const sum = [...code.slice(0, 13)].reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(code[13]);
}

function clean(value) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export async function handleBarcodeLookup(request, env, dependencies = {}) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return json({ error: "invalid_request" }, 400);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S{16,8192}$/i.test(authorization)) return json({ error: "authentication_required" }, 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return json({ error: "not_configured" }, 503);

  let input;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 128) return json({ error: "invalid_request" }, 400);
    const body = await request.text();
    if (body.length > 128) return json({ error: "invalid_request" }, 400);
    input = JSON.parse(body);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== 1 || !validGtin14(input.gtin14)) {
    return json({ error: "invalid_gtin" }, 400);
  }

  const fetcher = dependencies.fetch ?? fetch;
  try {
    const auth = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY, authorization },
      signal: AbortSignal.timeout(10_000),
    });
    if (!auth.ok) return json({ error: auth.status >= 500 ? "authentication_unavailable" : "authentication_required" }, auth.status >= 500 ? 503 : 401);
    const user = await auth.json();
    if (!user?.id) return json({ error: "authentication_required" }, 401);
  } catch {
    return json({ error: "authentication_unavailable" }, 503);
  }

  try {
    // A token is never sent to Open Food Facts; only the explicit GTIN is.
    const code = input.gtin14.replace(/^0+(?=\d{8,13}$)/, "");
    const apiUrl = `https://world.openfoodfacts.org/api/v3/product/${code}?fields=code,product_name,brands,quantity`;
    const result = await fetcher(apiUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      // Workers reject redirect: "error". Manual mode avoids following a
      // provider redirect and keeps the code on the approved hostname.
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (result.status === 404) return json({ product: null });
    if (result.status === 429) return json({ error: "provider_rate_limited" }, 503);
    if (result.status === 403) return json({ error: "provider_denied" }, 503);
    if (!result.ok || Number(result.headers.get("content-length") ?? 0) > 32_768) {
      return json({ error: "provider_unavailable" }, 503);
    }
    const raw = await result.text();
    if (raw.length > 32_768) return json({ error: "provider_unavailable" }, 503);
    const payload = JSON.parse(raw);
    const product = payload?.product;
    if (!product || typeof product !== "object") return json({ product: null });
    // Never trust a provider response for a different package identifier.
    if (typeof product.code !== "string" || !/^[0-9]{8,14}$/.test(product.code)
        || product.code.replace(/^0+/, "").padStart(14, "0") !== input.gtin14) {
      return json({ error: "provider_mismatch" }, 503);
    }
    return json({ product: {
      name: clean(product.product_name),
      brand: clean(product.brands),
      quantity: clean(product.quantity),
      sourceUrl: `https://world.openfoodfacts.org/product/${product.code}`,
    } });
  } catch {
    return json({ error: "provider_unavailable" }, 503);
  }
}
