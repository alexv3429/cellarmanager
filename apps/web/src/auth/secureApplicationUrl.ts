export function getSecureApplicationUrl(urlValue: string): string | null {
  const url = new URL(urlValue)
  if (
    url.protocol !== "http:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    return null
  }

  url.protocol = "https:"
  return url.href
}
