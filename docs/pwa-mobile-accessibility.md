# PWA, mobile and accessibility baseline

Roadmap step 0.3.16 makes the v0.3 application comfortable to install and use
as a daily phone application without changing its database, synchronization,
or inventory-operation contracts.

## Progressive web app lifecycle

The generated web app manifest identifies CellarManager as a standalone app,
provides regular, maskable and Apple icons, and exposes Inventory and Activity
shortcuts on platforms that support them. Light and dark browser chrome colors
match the application palette.

When a browser exposes its native installation event, CellarManager offers an
Install app action. Platforms that do not expose that event, notably iOS, keep
their normal browser-controlled Add to Home Screen flow. The application does
not simulate or bypass the platform installation prompt.

The service-worker notice gives update availability precedence over first-time
offline readiness and installation. Updating remains an explicit user action;
the app does not reload in the middle of inventory work. Cached application
files make the shell available offline, while PowerSync remains responsible for
persisted cellar data and queued inventory operations.

The production bundle contains legacy public PowerSync assets as well as the
hashed worker and SQLite assets referenced by the application. The service
worker excludes the redundant `@powersync/` copies from its precache. This
avoids caching the same runtime twice and prevents URL-normalization redirects
from blocking service-worker installation through a temporary Cloudflare
tunnel.

PWA lifecycle behavior must be tested from a production build. Vite's normal
development server is useful for implementation but does not represent the
installed service worker or phone networking path.

## Mobile interaction baseline

- interactive controls use at least a 44-pixel touch height
- header, navigation, alerts, content and floating PWA notices respect device
  safe areas
- primary navigation stays reachable while scrolling and keeps all five
  destinations visible without horizontal menu scrolling
- existing inventory, catalog, cellar setup, activity and import card layouts
  remain bounded by the viewport
- text inputs remain at a phone-safe font size and controls opt into direct
  touch manipulation

## Accessibility baseline

- primary destinations are links with real URLs and `aria-current` state
- a keyboard-visible skip link moves directly to the active content
- client-side page changes update the document title, return to the top and
  move focus to the new content region
- visible focus indicators cover navigation, controls, disclosure summaries and
  PWA actions
- inventory and catalog tables provide captions and scoped column headings
- status, error, offline, install and update messages use live-region semantics
- reduced-motion preferences suppress non-essential animation and smooth
  scrolling

This is a practical keyboard, screen-reader semantics, contrast, touch-target
and responsive baseline for personal production. It is not a claim of formal
WCAG certification.
