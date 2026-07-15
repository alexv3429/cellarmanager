/** Pure offline-queue helpers; intentionally testable with plain Node. */
export const QUEUEABLE_ACTIONS = new Set([
  "holdings/add",
  "holdings/move",
  "holdings/remove",
  "inventory/add",
]);

export function isQueueable(action) {
  return QUEUEABLE_ACTIONS.has(action);
}

export function generateClientOpId() {
  if (globalThis.crypto?.randomUUID) return `op-${globalThis.crypto.randomUUID()}`;
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

let lastIssuedAt = 0;

export function createOutboxEntry(action, payload, now = null) {
  if (!isQueueable(action)) {
    throw new Error(`Action '${action}' is not safe to queue offline`);
  }
  const clientOpId = payload.client_op_id || generateClientOpId();
  const createdAt =
    now == null ? Math.max(Date.now(), lastIssuedAt + 1) : Number(now);
  if (now == null) lastIssuedAt = createdAt;
  return {
    clientOpId,
    action,
    payload: { ...payload, client_op_id: clientOpId },
    createdAt,
    attempts: 0,
  };
}

export function orderForReplay(entries) {
  return [...entries].sort((left, right) => left.createdAt - right.createdAt);
}

/**
 * A real HTTP 409 is an unresolved concurrency conflict, never success.
 * Permanent validation/not-found failures are preserved in dead-letter storage.
 */
export function classifyReplayResult(statusCode, maxAttempts, attemptsSoFar) {
  if (statusCode >= 200 && statusCode < 300) return "done";
  if (statusCode === 409) return "conflict";
  if ([400, 401, 403, 404, 405, 413, 415, 422].includes(statusCode)) {
    return "dead_letter";
  }
  if (attemptsSoFar + 1 >= maxAttempts) return "dead_letter";
  return "retry";
}
