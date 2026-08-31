import { describe, expect, it } from "vitest";

import { APP_VERSION } from "./appMetadata";

describe("v0.4 application metadata", () => {
  it("identifies the released application version", () => {
    expect(APP_VERSION).toBe("0.4.0");
  });
});
