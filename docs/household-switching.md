# Household switching — 0.5.5

A household is a separately shared wine collection, not a physical cellar or
storage location. An account can be an Owner in one household and a read-only
Member in another. Switching households does not sign out or change memberships.

## User-facing behavior

- The header shows the current household, role, and what that role permits.
- With multiple synchronized memberships, **Switch household** offers the
  available names and roles. Identical names include a short ID for distinction.
- Selecting another household opens an inline confirmation. **Stay here** or
  Escape cancels without clearing any work. Confirmation resets open forms,
  filters, and unsaved local screen state; users should save unfinished edits
  first. Persisted import retry plans remain keyed to their original household.
- Saved inventory operations and queued changes keep their original household
  and device attribution. Switching neither cancels them nor copies them into
  the destination. Synchronization continues under the existing permissions.
- Owners arrive in Inventory; Members arrive in their read-only Cellar browser.
  The household name is also included in the browser title.
- Refresh restores this browser's last selection independently per signed-in
  account. Browser storage errors warn without preventing an in-memory switch.
- Back/Forward works normally within the same household. Encountering a history
  entry scoped to a different household returns to the current household's home;
  changing the active household always requires the selector. Fresh unscoped
  wine links continue to resolve inside the current household only.
- Offline, only synchronized households are available. Local membership can be
  stale while disconnected; PostgreSQL still checks permission for every upload
  on reconnection. A browser preference grants no access.
- When synchronized membership disappears, its workspace immediately unmounts.
  If another household exists, the app explains the fallback. With no available
  household it follows the existing online onboarding/offline-unavailable gate.
  A synchronized role change also remounts the workspace with the new permissions.

## Implementation and verification

`useActiveHousehold` resolves only IDs present in synchronized membership data
during render, rather than waiting for an effect to replace an invalid stored ID.
`ReadyAuthenticatedApp` is keyed by household and role, providing one isolation
boundary for all its stateful descendants, including async responses from an
unmounted screen. Navigation entries carry a household ID, but no credentials.
This adds no database migrations and changes no membership or inventory rules.

Automated regression tests exercise the real React App, selection hook, shell,
switcher, and History API with synthetic child screens and memberships. jsdom is
a development-only test dependency. Existing database authorization and queue
tests remain authoritative for server enforcement; this step does not replace
the full 0.5.8/0.5.11 concurrency and security acceptance suites.

## Manual acceptance (desktop and phone)

Use an account belonging to two households, ideally Owner in one and Member in
the other. Use synthetic data or leave real inventory unchanged.

1. Verify the header's current collection/role, and each destination's role.
   With one household, confirm there is no redundant switching control.
2. Type an unfinished edit or change a filter. Select another household, then
   **Stay here** (also try Escape on desktop). The current screen stays intact.
3. Confirm the switch. Verify the correct collection opens at its home, old
   forms/filters are gone, and Owner actions are absent for a Member.
4. Switch back, then refresh. Verify the selection is remembered and the title
   names the active household. No data or memberships should have changed.
5. Open a wine before switching. After switching, use Back/Forward: the previous
   household's wine must not appear. Within one household, Pairing → wine → Back
   must still preserve the pairing screen state.
6. After both households have synchronized, go offline and switch. The offline
   explanation should be clear; reconnect and check synchronization recovers.
   Any queue test must use a disposable household, never real cellar stock.

As usual, user validation and merge remain separate from implementation.
