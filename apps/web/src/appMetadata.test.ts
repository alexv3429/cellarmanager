import { describe, expect, it } from "vitest";

import { APP_VERSION } from "./appMetadata";

describe("v0.2 application metadata", () => {
  it("identifies the new development line", () => {
    expect(APP_VERSION).toBe("0.2.0-alpha");
  });
});
