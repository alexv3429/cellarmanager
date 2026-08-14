# Activity and synchronization UX

Roadmap step 0.3.15 makes the existing local-first inventory journal visible
to the user and replaces the ambiguous connection label with an explicit
synchronization state. It does not change the inventory-operation or database
contracts.

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
