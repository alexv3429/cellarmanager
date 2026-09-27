import { CaptureImageError } from "./captureImageNormalize.mjs";

const BUCKET = "capture-labels";
const MAX_REQUEST_BYTES = 4_096;
const OBJECT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearerToken(request) {
  const value = request.headers.get("authorization") ?? "";
  return /^Bearer\s+\S{16,8192}$/i.test(value) ? value : "";
}

function serviceHeaders(env, contentType = "application/json") {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "content-type": contentType,
  };
}

function userHeaders(env, authorization) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization,
    "content-type": "application/json",
  };
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function readRequestBody(request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    return null;
  }
}

function isValidClaim(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && OBJECT_KEY_PATTERN.test(value.session_id ?? "")
    && ["claimed", "processing", "processed"].includes(value.state)
    && Array.isArray(value.assets);
}

function isValidAsset(asset) {
  return asset && typeof asset === "object" && !Array.isArray(asset)
    && OBJECT_KEY_PATTERN.test(asset.source_object_name ?? "")
    && OBJECT_KEY_PATTERN.test(asset.normalized_object_name ?? "")
    && ["image/jpeg", "image/png"].includes(asset.content_type)
    && Number.isSafeInteger(asset.uploaded_bytes)
    && asset.uploaded_bytes > 0
    && asset.uploaded_bytes <= 6 * 1024 * 1024;
}

async function postRpc(fetcher, env, name, body, authorization = null) {
  return fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: authorization ? userHeaders(env, authorization) : serviceHeaders(env),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

async function readLimited(response, expectedBytes, limit) {
  if (!response.ok || !response.body || expectedBytes > limit) throw new Error("storage_read_failed");
  const contentLength = Number(response.headers.get("content-length") ?? -1);
  if (contentLength > limit) throw new Error("storage_read_failed");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("storage_read_failed");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedBytes) throw new Error("storage_size_mismatch");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function storageUrl(env, objectName, endpoint = "object/authenticated") {
  return `${env.SUPABASE_URL}/storage/v1/${endpoint}/${BUCKET}/${objectName}`;
}

async function storedObjectMatches(fetcher, env, objectName, expectedBytes) {
  const response = await fetcher(await storageUrl(env, objectName), {
    method: "GET",
    headers: serviceHeaders(env),
    signal: AbortSignal.timeout(20_000),
  });
  const stored = await readLimited(response, expectedBytes, 5 * 1024 * 1024);
  const digest = await crypto.subtle.digest("SHA-256", stored);
  return digest;
}

async function removeObjects(fetcher, env, objectNames) {
  const names = [...new Set(objectNames.filter((name) => OBJECT_KEY_PATTERN.test(name)))];
  if (names.length === 0) return true;
  const response = await fetcher(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: serviceHeaders(env),
    body: JSON.stringify({ prefixes: names }),
    signal: AbortSignal.timeout(20_000),
  });
  return response.ok;
}

async function failAndClean(fetcher, env, sessionId) {
  let response;
  try {
    response = await postRpc(fetcher, env, "fail_capture_preprocessing", {
      p_session_id: sessionId,
    });
  } catch {
    return false;
  }
  if (!response.ok) return false;
  let failure;
  try {
    failure = await response.json();
  } catch {
    return false;
  }
  const names = failure && Array.isArray(failure.object_names) ? failure.object_names : [];
  if (names.some((name) => typeof name !== "string" || !OBJECT_KEY_PATTERN.test(name))) return false;
  if (!(await removeObjects(fetcher, env, names))) return false;
  try {
    const completed = await postRpc(fetcher, env, "complete_capture_cleanup", { p_session_id: sessionId });
    return completed.ok && await completed.json() === true;
  } catch {
    return false;
  }
}

export async function handleCapturePreprocessing(request, env, dependencies = {}) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "invalid_request" }, 400);
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);
    } catch {
      return json({ error: "forbidden" }, 403);
    }
  }
  const authorization = bearerToken(request);
  if (!authorization) return json({ error: "authentication_required" }, 401);
  const body = await readRequestBody(request);
  if (!body || Object.keys(body).length !== 1 || !OBJECT_KEY_PATTERN.test(body.sessionId ?? "")) {
    return json({ error: "invalid_request" }, 400);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return json({ error: "not_configured" }, 503);

  const fetcher = dependencies.fetch ?? fetch;
  const processImage = dependencies.processImage;
  if (typeof processImage !== "function") return json({ error: "not_configured" }, 503);

  let claimResponse;
  try {
    claimResponse = await postRpc(fetcher, env, "claim_capture_preprocessing", {
      p_session_id: body.sessionId,
    }, authorization);
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }
  if (!claimResponse.ok) {
    return json({ error: claimResponse.status === 401 || claimResponse.status === 403 ? "forbidden" : "capture_unavailable" },
      claimResponse.status === 401 || claimResponse.status === 403 ? 403 : 409);
  }

  let claim;
  try {
    claim = await claimResponse.json();
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }
  if (!isValidClaim(claim)) return json({ error: "capture_unavailable" }, 409);
  if (claim.state === "processed") return json({ status: "processed" });
  if (claim.state === "processing") return json({ status: "processing" }, 202);
  if (claim.state !== "claimed") return json({ error: "capture_unavailable" }, 409);
  if (claim.assets.length < 1 || claim.assets.length > 2 || claim.assets.some((asset) => !isValidAsset(asset))) {
    await failAndClean(fetcher, env, claim.session_id);
    return json({ error: "photo_preparation_failed" }, 422);
  }

  try {
    for (const asset of claim.assets) {
      const sourceResponse = await fetcher(await storageUrl(env, asset.source_object_name), {
        method: "GET",
        headers: serviceHeaders(env),
        signal: AbortSignal.timeout(20_000),
      });
      const sourceBytes = await readLimited(sourceResponse, asset.uploaded_bytes, 6 * 1024 * 1024);
      const normalized = await processImage(sourceBytes, asset.content_type);
      if (!normalized || normalized.contentType !== "image/jpeg"
          || !(normalized.bytes instanceof Uint8Array)
          || normalized.bytes.length < 4
          || normalized.bytes.length > 5 * 1024 * 1024
          || !OBJECT_KEY_PATTERN.test(asset.normalized_object_name)) {
        throw new CaptureImageError("invalid");
      }

      const uploadResponse = await fetcher(await storageUrl(env, asset.normalized_object_name, "object"), {
        method: "POST",
        headers: {
          ...serviceHeaders(env, "image/jpeg"),
          "cache-control": "no-store",
          "x-upsert": "false",
        },
        body: normalized.bytes,
        signal: AbortSignal.timeout(20_000),
      });
      if (!uploadResponse.ok) throw new Error("normalized_upload_failed");

      const storedDigest = await storedObjectMatches(fetcher, env, asset.normalized_object_name, normalized.bytes.length);
      const expectedDigest = await crypto.subtle.digest("SHA-256", normalized.bytes);
      const same = new Uint8Array(storedDigest).every((value, index) => value === new Uint8Array(expectedDigest)[index]);
      if (!same) throw new Error("normalized_upload_mismatch");

      if (!(await removeObjects(fetcher, env, [asset.source_object_name]))) {
        throw new Error("source_delete_failed");
      }
    }

    const completed = await postRpc(fetcher, env, "complete_capture_preprocessing", {
      p_session_id: claim.session_id,
    });
    if (!completed.ok || await completed.json() !== true) throw new Error("preprocessing_finalize_failed");
    return json({ status: "processed", count: claim.assets.length });
  } catch (error) {
    const cleaned = await failAndClean(fetcher, env, claim.session_id);
    const invalidImage = error instanceof CaptureImageError
      && ["invalid", "dimensions", "too_large"].includes(error.code);
    return json({
      error: invalidImage ? "invalid_photo" : "photo_preparation_failed",
      cleanup: cleaned ? "complete" : "pending",
    }, invalidImage ? 422 : 503);
  }
}

export async function handleCapturePreview(request, env, dependencies = {}) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "invalid_request" }, 400);
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);
    } catch {
      return json({ error: "forbidden" }, 403);
    }
  }
  const authorization = bearerToken(request);
  if (!authorization) return json({ error: "authentication_required" }, 401);
  const body = await readRequestBody(request);
  if (!body || Object.keys(body).length !== 2
      || !OBJECT_KEY_PATTERN.test(body.sessionId ?? "")
      || !OBJECT_KEY_PATTERN.test(body.objectName ?? "")) {
    return json({ error: "invalid_request" }, 400);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return json({ error: "not_configured" }, 503);

  const fetcher = dependencies.fetch ?? fetch;
  let listResponse;
  try {
    listResponse = await postRpc(fetcher, env, "list_capture_processed_assets", {
      p_session_id: body.sessionId,
    }, authorization);
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }
  if (!listResponse.ok) return json({ error: "capture_unavailable" }, 403);
  let assets;
  try {
    assets = await listResponse.json();
  } catch {
    return json({ error: "capture_unavailable" }, 503);
  }
  if (!Array.isArray(assets)) return json({ error: "capture_unavailable" }, 403);
  const asset = assets.find((item) => item && typeof item === "object"
    && item.object_name === body.objectName);
  if (!asset || asset.content_type !== "image/jpeg"
      || !Number.isSafeInteger(asset.size_bytes)
      || asset.size_bytes < 1 || asset.size_bytes > 5 * 1024 * 1024) {
    return json({ error: "capture_unavailable" }, 403);
  }

  try {
    const response = await fetcher(await storageUrl(env, asset.object_name), {
      method: "GET",
      headers: serviceHeaders(env),
      signal: AbortSignal.timeout(20_000),
    });
    const bytes = await readLimited(response, asset.size_bytes, 5 * 1024 * 1024);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
        || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      return json({ error: "capture_unavailable" }, 422);
    }
    return new Response(bytes, {
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "image/jpeg",
        expires: "0",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return json({ error: "capture_unavailable" }, 503);
  }
}
