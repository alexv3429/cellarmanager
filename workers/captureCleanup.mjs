const BUCKET = "capture-labels";
const BATCH_SIZE = 10;
const OBJECT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceHeaders(env) {
  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "content-type": "application/json",
  };
  return headers;
}

async function postRpc(fetcher, env, name, body) {
  return fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders(env),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
}

export async function cleanupExpiredCaptureSessions(env, dependencies = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return { status: "not_configured", claimed: 0, deleted: 0, failed: 0 };
  }

  const fetcher = dependencies.fetch ?? fetch;
  let claimResponse;
  try {
    claimResponse = await postRpc(fetcher, env, "claim_capture_cleanup", {
      p_limit: BATCH_SIZE,
    });
  } catch {
    return { status: "failed", claimed: 0, deleted: 0, failed: 1 };
  }
  if (!claimResponse.ok) {
    return { status: "failed", claimed: 0, deleted: 0, failed: 1 };
  }

  let sessions;
  try {
    sessions = await claimResponse.json();
  } catch {
    return { status: "failed", claimed: 0, deleted: 0, failed: 1 };
  }
  if (!Array.isArray(sessions)) {
    return { status: "failed", claimed: 0, deleted: 0, failed: 1 };
  }

  const outcome = { status: "completed", claimed: sessions.length, deleted: 0, failed: 0 };
  for (const session of sessions) {
    const sessionId = typeof session?.session_id === "string" ? session.session_id : "";
    const names = Array.isArray(session?.object_names) ? session.object_names : null;
    if (!OBJECT_KEY_PATTERN.test(sessionId) || !names || names.some((name) =>
      typeof name !== "string" || !OBJECT_KEY_PATTERN.test(name))) {
      outcome.failed += 1;
      continue;
    }

    if (names.length > 0) {
      let deleteResponse;
      try {
        deleteResponse = await fetcher(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
          method: "DELETE",
          headers: serviceHeaders(env),
          body: JSON.stringify({ prefixes: names }),
          signal: AbortSignal.timeout(12000),
        });
      } catch {
        outcome.failed += 1;
        continue;
      }
      if (!deleteResponse.ok) {
        outcome.failed += 1;
        continue;
      }
    }

    let completeResponse;
    try {
      completeResponse = await postRpc(fetcher, env, "complete_capture_cleanup", {
        p_session_id: sessionId,
      });
    } catch {
      outcome.failed += 1;
      continue;
    }
    if (!completeResponse.ok) {
      outcome.failed += 1;
      continue;
    }
    let removed;
    try {
      removed = await completeResponse.json();
    } catch {
      outcome.failed += 1;
      continue;
    }
    if (removed !== true) {
      outcome.failed += 1;
      continue;
    }
    outcome.deleted += 1;
  }

  if (outcome.failed > 0) outcome.status = "partial";
  return outcome;
}
