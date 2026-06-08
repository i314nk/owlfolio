const PRIVATE_V4 = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./, /^0\./,
]

export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid source URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Source URL protocol not allowed: ${url.protocol}`)
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) {
    throw new Error(`Source URL host not allowed (loopback): ${host}`)
  }
  if (PRIVATE_V4.some((re) => re.test(host))) {
    throw new Error(`Source URL host not allowed (private): ${host}`)
  }
  return url
}
