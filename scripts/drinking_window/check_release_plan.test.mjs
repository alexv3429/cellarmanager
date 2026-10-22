import assert from "node:assert/strict"
import test from "node:test"
import { checkPlanUpdate, requiresPlanUpdate, planPath } from "./check_release_plan.mjs"

test("migration, policy, and focused UI changes require a plan update", () => {
  for (const path of [
    "supabase/migrations/20261017190000_drinking_window_publication.sql",
    "docs/drinking-window-staged-rollout.md",
    "apps/web/src/components/WineMaturityPanel.tsx",
    "scripts/drinking_window/first_review_batch.mjs",
  ]) {
    assert.equal(requiresPlanUpdate([path]), true, path)
    assert.equal(checkPlanUpdate([path]), false, path)
    assert.equal(checkPlanUpdate([path, planPath]), true, path)
  }
})

test("feature edits in shared files require a plan update", () => {
  const patch = "diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx\n@@ -1 +1 @@\n-  showMaturity(oldValue)\n+  showMaturity(newValue)\n"
  assert.equal(requiresPlanUpdate(["apps/web/src/App.tsx"], patch), true)
  assert.equal(checkPlanUpdate(["apps/web/src/App.tsx"], patch), false)
})

test("unrelated code and documentation do not require a plan update", () => {
  const patch = "diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx\n@@ -1 +1 @@\n-  showInventory(oldValue)\n+  showInventory(newValue)\n"
  assert.equal(requiresPlanUpdate(["apps/web/src/App.tsx", "docs/inventory.md"], patch), false)
  assert.equal(checkPlanUpdate(["apps/web/src/App.tsx", "docs/inventory.md"], patch), true)
})

test("the plan alone is allowed and unchanged diff headers do not count", () => {
  assert.equal(checkPlanUpdate([planPath]), true)
  assert.equal(requiresPlanUpdate(["apps/web/src/App.tsx"], "diff --git a/maturity b/maturity\n@@ -1 +1 @@\n+unrelated\n"), false)
})
