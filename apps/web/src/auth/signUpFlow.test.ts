import { describe, expect, it } from "vitest"

import {
  getSignUpEmailRedirectTo,
  resolveSignUpSuccess,
} from "./signUpFlow"

describe("sign-up email redirect", () => {
  it("uses the deployed application's origin", () => {
    expect(
      getSignUpEmailRedirectTo(
        "https://cellarmanager.example.com/import?step=2",
      ),
    ).toBe("https://cellarmanager.example.com")
  })

  it("supports a local HTTP origin", () => {
    expect(
      getSignUpEmailRedirectTo("http://127.0.0.1:5173"),
    ).toBe("http://127.0.0.1:5173")
  })

  it("rejects origins that cannot be used for web redirects", () => {
    expect(() =>
      getSignUpEmailRedirectTo("file:///tmp/cellarmanager"),
    ).toThrow("must use HTTP or HTTPS")
  })
})

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
        "Check your inbox and Spam folder for a confirmation link, then sign in.",
    })
  })
})
