const BUCKET = "capture-labels";
const MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const MODEL_VERSION = "cloudflare-moondream3.1-9b-a2b-v1";
const MAX_REQUEST_BYTES = 4_096;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const OBJECT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OCR_QUESTION = [
  "Act as OCR, not as a wine expert or image captioner.",
  "Read the main front paper label; ignore the bottle, reflections, and background.",
  "Transcribe every visible word and number in reading order, preserving the printed language, spelling, accents, capitalization, and line breaks.",
  "Focus on the producer near the top, the wine or appellation in the center, and the vintage and volume near the bottom.",
  "Include partially readable words; use [illegible] only for unreadable spans. Never guess or invent text.",
  "If any characters are readable, return them rather than an empty answer. Return only the transcription.",
].join(" ");

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function bearerToken(request) {
  const value = request.headers.get("authorization") ?? "";
  return /^Bearer\s+\S{16,8192}$/i.test(value) ? value : "";
}

function headersForService(env, contentType = "application/json") {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "content-type": contentType,
  };
}

function headersForUser(env, authorization) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization,
    "content-type": "application/json",
  };
}

async function readRequestBody(request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES || !request.body) return null;
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

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function postRpc(fetcher, env, name, body, authorization) {
  return fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: headersForUser(env, authorization),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

async function readLimited(response, expectedBytes) {
  if (!response.ok || !response.body || !Number.isSafeInteger(expectedBytes)
      || expectedBytes < 1 || expectedBytes > MAX_IMAGE_BYTES) {
    throw new Error("capture_image_unavailable");
  }
  const declaredBytes = Number(response.headers.get("content-length") ?? -1);
  if (declaredBytes > MAX_IMAGE_BYTES) throw new Error("capture_image_unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES || size > expectedBytes) {
        await reader.cancel();
        throw new Error("capture_image_unavailable");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedBytes) throw new Error("capture_image_unavailable");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new Error("capture_image_unavailable");
  }
  return bytes;
}

function asDataUri(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function recognizedText(result) {
  if (!isPlainRecord(result) || typeof result.answer !== "string") return "";
  return result.answer.replaceAll("\u0000", "").trim();
}

function validAsset(asset) {
  return isPlainRecord(asset)
    && OBJECT_KEY_PATTERN.test(asset.object_name ?? "")
    && asset.content_type === "image/jpeg"
    && Number.isSafeInteger(asset.size_bytes)
    && asset.size_bytes > 0
    && asset.size_bytes <= MAX_IMAGE_BYTES;
}

function validNames(value) {
  return Array.isArray(value) && value.length <= 4
    && value.every((name) => typeof name === "string" && OBJECT_KEY_PATTERN.test(name));
}

async function removeObjects(fetcher, env, names) {
  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length === 0) return true;
  const response = await fetcher(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: headersForService(env),
    body: JSON.stringify({ prefixes: uniqueNames }),
    signal: AbortSignal.timeout(20_000),
  });
  return response.ok;
}

export async function handleCaptureRecognition(request, env, dependencies = {}) {
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
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY
      || (!env.AI && typeof dependencies.runModel !== "function")) {
    return json({ error: "not_configured" }, 503);
  }

  const fetcher = dependencies.fetch ?? fetch;
  const runModel = dependencies.runModel ?? ((model, input) => env.AI.run(model, input));
  let assetsResponse;
  try {
    assetsResponse = await postRpc(fetcher, env, "list_capture_processed_assets", {
      p_session_id: body.sessionId,
    }, authorization);
  } catch {
    return json({ error: "capture_unavailable" }, 503);
  }
  if (!assetsResponse.ok) {
    return json({ error: assetsResponse.status === 401 || assetsResponse.status === 403 ? "forbidden" : "capture_unavailable" },
      assetsResponse.status === 401 || assetsResponse.status === 403 ? 403 : 503);
  }

  let assets;
  try {
    assets = await assetsResponse.json();
  } catch {
    return json({ error: "capture_unavailable" }, 503);
  }
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > 2 || assets.some((asset) => !validAsset(asset))) {
    return json({ error: "capture_unavailable" }, 409);
  }

  const pages = [];
  try {
    for (const asset of assets) {
      const imageResponse = await fetcher(
        `${env.SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${asset.object_name}`,
        {
          method: "GET",
          headers: headersForService(env),
          signal: AbortSignal.timeout(20_000),
        },
      );
      const bytes = await readLimited(imageResponse, asset.size_bytes);
      const result = await runModel(MODEL, {
        task: "query",
        image: asDataUri(bytes),
        question: OCR_QUESTION,
        reasoning: false,
        temperature: 0,
        max_tokens: 512,
        stream: false,
      });
      const text = recognizedText(result);
      if (!text) {
        const outputTokens = isPlainRecord(result) && isPlainRecord(result.metrics)
          && Number.isSafeInteger(result.metrics.output_tokens)
          ? result.metrics.output_tokens
          : null;
        console.warn("capture_ocr_empty_answer", {
          model: MODEL,
          answerType: isPlainRecord(result) && result.answer === null ? "null" : typeof result?.answer,
          finishReason: isPlainRecord(result) && typeof result.finish_reason === "string"
            ? result.finish_reason
            : null,
          outputTokens,
        });
      }
      if (text.length > 10_000) throw new Error("recognition_output_too_large");
      pages.push({ object_name: asset.object_name, text, confidence: 0 });
    }
  } catch {
    // Do not retry a provider call automatically: the image stays available for
    // an explicit owner retry and the daily free allowance remains predictable.
    return json({ error: "recognition_unavailable" }, 503);
  }
  if (!pages.some((page) => page.text.length > 0)) return json({ error: "no_text" }, 422);

  let savedResponse;
  try {
    savedResponse = await postRpc(fetcher, env, "complete_capture_ocr", {
      p_session_id: body.sessionId,
      p_pages: pages,
      p_language_code: "und",
      p_engine_version: MODEL_VERSION,
    }, authorization);
  } catch {
    return json({ error: "recognition_save_failed" }, 503);
  }
  if (!savedResponse.ok) return json({ error: "recognition_save_failed" }, 503);

  let saved;
  try {
    saved = await savedResponse.json();
  } catch {
    return json({ error: "recognition_save_failed" }, 503);
  }
  if (!isPlainRecord(saved)
      || !["ocr_deletion_pending", "recognized"].includes(saved.state)
      || !validNames(saved.object_names)) {
    return json({ error: "recognition_save_failed" }, 503);
  }

  let state = saved.state;
  if (state === "ocr_deletion_pending") {
    try {
      const deleted = await removeObjects(fetcher, env, saved.object_names);
      if (deleted) {
        const completed = await postRpc(fetcher, env, "complete_capture_cleanup", {
          p_session_id: body.sessionId,
        }, authorization);
        if (completed.ok && await completed.json() === true) state = "recognized";
      }
    } catch {
      // The OCR text is already durably saved. Scheduled cleanup retries image deletion.
    }
  }

  return json({
    state,
    engine_version: MODEL_VERSION,
    pages: pages.map(({ text, confidence }) => ({ text, confidence })),
  });
}
