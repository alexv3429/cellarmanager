import { describe, expect, it } from "vitest"

import { getSecureApplicationUrl } from "./secureApplicationUrl"

describe("secure application navigation", () => {
  it("preserves invitation fragments, paths, and queries while upgrading HTTP", () => {
    const token = "a".repeat(64)
    expect(getSecureApplicationUrl(`http://preview.trycloudflare.com/invite?from=email#token=${token}`))
      .toBe(`https://preview.trycloudflare.com/invite?from=email#token=${token}`)
  })

  it("also preserves authentication callback fragments", () => {
    expect(getSecureApplicationUrl("http://cellar.example/#access_token=synthetic&type=signup"))
      .toBe("https://cellar.example/#access_token=synthetic&type=signup")
  })

  it("does not redirect secure pages or trusted loopback development", () => {
    for (const url of ["https://preview.trycloudflare.com/invite", "http://localhost:8796", "http://127.0.0.1:8796", "http://[::1]:8796"]) {
      expect(getSecureApplicationUrl(url)).toBeNull()
    }
  })

  it("does not treat lookalike localhost names or LAN addresses as secure contexts", () => {
    for (const host of ["localhost.attacker.example", "192.168.1.10"]) {
      expect(getSecureApplicationUrl(`http://${host}/`)).toBe(`https://${host}/`)
    }
  })
})
