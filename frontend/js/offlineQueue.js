/**
 * Pure functions for the offline mutation queue. Deliberately free of any
 * IndexedDB/fetch/DOM dependency so they can be unit tested with plain
 * Node (see frontend/tests/logic.test.js) with zero extra installs.
 */

/** Endpoints that mutate server state and are safe to queue and replay
 * later; each carries a client-generated id so the server can dedupe a
 * retried/replayed request (see backend `client_op_id` handling). */
export const QUEUEABLE_ACTIONS = new Set(["holdings/add", "holdings/move", "holdings/remove"]);

export function isQueueable(action) {
  return QUEUEABLE_ACTIONS.has(action);
}

export function generateClientOpId() {
  // Not cryptographic - just needs to be unique enough to dedupe retries.
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build an outbox entry for a queued mutation.
 * @param {string} action - one of QUEUEABLE_ACTIONS
 * @param {object} payload - the request body that would have been sent
 * @param {number} [now] - injectable clock for tests
 */
export function createOutboxEntry(action, payload, now = Date.now()) {
  if (!isQueueable(action)) {
    throw new Error(`Action '${action}' is not safe to queue offline`);
  }
  const clientOpId = payload.client_op_id || generateClientOpId();
  return {
    clientOpId,
    action,
    payload: { ...payload, client_op_id: clientOpId },
    createdAt: now,
    attempts: 0,
  };
}

/** Sort outbox entries oldest-first so replay preserves the order the
 * person actually performed the actions in. */
export function orderForReplay(entries) {
  return [...entries].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Decide what to do with an outbox entry after attempting to replay it.
 * Mirrors the server's behaviour: 2xx or 409-with-same-client-op-id (already
 * applied) both mean "done, remove from queue"; other errors mean "keep for
 * a later retry" (up to a cap, after which it's surfaced to the person).
 */
export function classifyReplayResult(statusCode, maxAttempts, attemptsSoFar) {
  if (statusCode >= 200 && statusCode < 300) return "done";
  if (statusCode === 409) return "done"; // idempotent dedup, or a real conflict either way needs no automatic retry
  if (attemptsSoFar + 1 >= maxAttempts) return "give_up";
  return "retry";
}
