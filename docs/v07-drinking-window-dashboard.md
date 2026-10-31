# v0.7.8 drinking-window dashboard

Activity → When to drink summarizes the existing household maturity overview
against the current positive holdings on this device. Counts are bottles, not
wine cards, and wines with no stock are excluded. The five groups mirror the
catalog's guidance states: `priority` and `assess-now` become “Drink sooner”,
followed by `ready`, `assess`, `hold`, and wines with no usable state. Missing
guidance is visible rather than treated as a safe drinking window.

The selected group lists its wines in relevant-year and urgency order, with a
link to each wine card. It shows the suggested drink-by or first useful trial
year where available. The household's manual window takes precedence over the
model, and account-private timing is reflected for the signed-in member, as in
the existing catalog. These dates are advice, not expiry dates. The dashboard
does not create projections, change guidance, or modify inventory.

Maturity guidance is loaded from the existing authenticated online overview;
stock is read from the synchronized local holdings. Offline, a connection
message is shown instead of presenting a potentially stale estimate. The
component discards prior results when the active household changes and does
not display another household's guidance during loading or after a failed
request.
