# Drinking-window reference rollout

Publishing a reviewed reference and enabling it for a household are separate
decisions. A publication requires a zero-issue draft, a current preflight and
at least one affected household owner's approval of a fresh, whole-cellar
comparison. It no longer waits for every household to approve. Publication
enables that approved pilot household only; every other cellar keeps its
current model or previously selected published version.

After publication, an owner can open Catalogue, request a comparison with the
latest version, inspect the current and proposed three milestones for all of
their wines, and choose whether to use the new version in that cellar. Only
that owner's household selection changes. A later shared publication does not
silently move an existing household to the new version: its previous reviewed
version remains selected until the owner approves a new comparison. Manual
wine windows still take precedence. The audited global emergency switch turns
reference advice off for everyone without deleting their selections.

The comparison must be fresh when approved. A changed cellar, version or
report hash requires another report. The publication transaction rechecks its
pilot's current report, owner and entire cellar. An unreviewed household never
blocks publication and never receives the new dates by default. A household
created after publication can request its own comparison.

This rollout change does **not** create or publish reference dates. The
private workbook audit still finds 226 staged two-date pairs and zero
publishable three-date rows. The eight 2022–2023 Alsace/Beaujolais proposals
are owner estimates, not source-published exact years. The owner permits their
sharing only for explicitly reviewed ageing-category members; group boundaries,
canonical memberships, supporting evidence and reuse rights still require
curator review. Do not turn a regional vintage article into evidence for an
exact year it never states, or apply a generic white profile to every Alsace
grape or a single Cru profile to every Beaujolais cru.

## First real publication checklist

1. Select a deliberately narrow pilot that includes at least one wine in the
   consenting owner's cellar. Resolve its canonical region, appellation,
   producer, product/release and colour as required by the chosen scope.
2. Enter all three explicit years together, plus a rationale, eligible
   memberships, source pointers and a reviewed cross-household reuse policy.
   Record a curator's whole-window approval. Leave unresolved wines on the
   labelled existing model.
3. Record a zero-issue publication preflight and a fresh whole-cellar shadow
   report. The owner compares the exact report and approves it in Catalogue.
4. Apply the database migrations before deploying the web client. A trusted
   operator publishes the draft with
   `publish_drinking_window_reference(version_id)`. Check that at least one
   affected household was enabled and another unreviewed household stayed on
   its previous advice. Verify the wine card and catalogue show the same
   source and three dates, with no invented drink-by year.
5. If advice is wrong, the trusted operator disables reference advice via the
   existing audited emergency switch while the correction is reviewed. A
   content correction is a new immutable version, not an edit to the old one.

Do not call the feature data-ready until this checklist has been completed
with real, reviewed dates. Synthetic database tests prove the workflow, not
the suitability of a drinking window for a real wine.
