// Modern Supabase secret keys authenticate through apikey; only legacy JWT
// service-role keys may also be used as Bearer tokens.
export function supabaseServiceHeaders(secretKey, contentType = "application/json") {
  const headers = { apikey: secretKey, "content-type": contentType };
  if (secretKey.split(".").length === 3) {
    headers.authorization = `Bearer ${secretKey}`;
  }
  return headers;
}
