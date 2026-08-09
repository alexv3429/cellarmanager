import { describe, expect, it } from "vitest"

import { resolveSignUpSuccess } from "./signUpFlow"

describe("sign-up completion", () => {
  it("leaves immediate authenticated signup to the session transition", () => {
    expect(resolveSignUpSuccess(true)).toEqual({
      nextMode: "sign-up",
      clearPassword: false,
      message: null,
    })
  })

  it("moves confirmation-required signup back to sign in", () => {
    expect(resolveSignUpSuccess(false)).toEqual({
      nextMode: "sign-in",
      clearPassword: true,
      message:
        "Check your email for a confirmation link, then sign in.",
    })
  })
})
