# Activity and synchronization UX

Activity exposes the local-first inventory journal and explicit synchronization
state introduced in 0.3.15. Step 0.5.9 adds plain-language rejection explanations
and explicit recovery for the signed-in account's blocked browser uploads.

## Activity

`/activity` shows the latest 100 inventory operations for the active household,
newest first. Each item identifies the wine, quantity, ADD/MOVE/REMOVE action,
source or destination, client timestamp, originating device, optional removal
reason, and synchronization result. Existing catalog wines link to their detail
page; a pending new wine that is not in the synchronized catalog yet remains
readable but is not linked.

The view can search the displayed wine, storage, device, reason, and error
labels, and filter by operation type or synchronization state. The 100-operation
bound keeps a large CSV import or long-lived household usable on a small device;
it is a recent operational feed, not an audit export.

Activity states preserve the journal semantics:

- **Queued** means the operation is stored locally and already reflected by the
  optimistic local projection, but is waiting for server confirmation.
- **Synced** means the server accepted the operation.
- **Rejected** means the authoritative projection excluded the operation; the
  server error code and explanation are shown on its card.

## Header synchronization state

The application header combines browser connectivity, the PowerSync connection
and transfer status, its last completed synchronization, and the active
household's count of pending inventory operations. It distinguishes:

- up to date
- connecting or initial synchronization
- uploading local changes
- refreshing local data
- offline with no queued changes
- offline with changes safely queued on the device
- a synchronization error that needs attention

The header state is informational. Retry behavior remains automatic, and the
existing safeguard still prevents signing out while offline.

## Concurrent changes and retry

Two offline devices can each show a locally queued change to the same bottle.
Only the server's accepted result is authoritative. When one device takes the
last bottle first, the conflicting operation receives a terminal rejection; it
does not remove another bottle or prevent a later valid operation from uploading.
Once the holdings and terminal journal synchronize, rejected optimistic effects
disappear from both devices' projections.

A lost response can cause an upload batch to replay already accepted operations.
The connector keeps the original UUID, originating device and payload, and the
server returns the stored receipt without applying the stock effect again.
Device revocation denies new operations under that registration; an exact retry
of an already accepted operation can still return its immutable receipt.
Authorization errors preserve the local queue instead of pretending it synced.

Step 0.5.8's automated coverage and safe manual checklist are documented in
[`multi-device-inventory-acceptance.md`](multi-device-inventory-acceptance.md).
Step 0.5.9 adds **Review current stock** for terminal rejections, and a separate
**Queued on this browser** review across households. A confirmed online stop
checks for an already-processed receipt first, never undoes accepted stock, and
retains the original request privately. See
[`inventory-conflict-recovery.md`](inventory-conflict-recovery.md) for deployment,
permission boundaries, synchronization limits and the safe acceptance checklist.
