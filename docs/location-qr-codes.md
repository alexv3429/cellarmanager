# Location QR codes (0.6.14)

An Owner can open **Cellar setup**, expand an active cellar, and display or
print a QR label for each active location. The label includes the visible
cellar and location names. It is generated in the browser without a QR service.

In **Inventory**, **Scan a location QR code** opens the device camera. A valid
scan selects the location as the inventory filter and as the default destination
in **Add bottles**. The **Move** form also offers **Scan destination QR**;
there, only a different active location in the current household is accepted.
The scanner runs locally, including when cached cellar data is available
offline. A camera-permission failure leaves manual location selection intact.

The versioned QR payload contains only the household UUID and location UUID.
It is not a login link or bearer credential. Every scan is checked against
the active household and its currently active locations; an archived location,
an unknown location, a code from another household, and a malformed code are
rejected. Renaming a cellar or location does not invalidate a label, while
archiving that location does. Scanning never queues ADD, MOVE, or REMOVE; the
user still confirms each normal inventory operation.

No database migration, external lookup, image upload, or permanent scan record
is introduced.

## Acceptance checklist

- Print a label for an active location and confirm both names and the QR are
  legible on paper.
- Scan it in Inventory; verify the location filter and Add destination, without
  any stock operation.
- Scan a different location in a Move form; verify only the destination changes
  until Move is explicitly confirmed.
- Try a code from another household and an archived location; neither should
  select a destination.
- Deny camera permission; manual location selection remains usable.
