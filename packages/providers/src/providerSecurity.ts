export function redactProviderDiagnostic(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)

  return text
    .replace(/\b(Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, (_match, label: string) => `${label}: [redacted-secret]`)
    .replace(
      /\b(Authorization|Proxy-Authorization|X-Api-Key|X-Auth-Token|X-Session-Token)\s*:\s*[^\r\n]+/gi,
      (_match, label: string) => `${label}: [redacted-secret]`,
    )
    .replace(/\b((?:cookie|cookies|sessionid|session_id|session-token|session_token|sid|csrf|xsrf)[A-Za-z0-9_-]*)\b\s*(=|:)\s*[^;\s,\]}]+/gi, (_match, label: string, separator: string) => `${label}${separator} [redacted-secret]`)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted-secret]')
    .replace(/\b([A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)[A-Z0-9_]*)\b\s*(=|:)\s*\S+/gi, (_match, label: string, separator: string) => `${label}${separator} [redacted-secret]`)
    .replace(/\b([A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)[A-Z0-9_]*)\b\s+\S+/gi, (_match, label: string) => `${label} [redacted-secret]`)
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[redacted-secret]')
    .replace(/\b[A-Za-z0-9_-]*token[A-Za-z0-9_-]*\b\s*(?:(?:=|:)\s*)?\S+/gi, 'token [redacted-secret]')
    .replace(/\*\*\*/g, '[redacted-secret]')
    .replace(/(?:\/[A-Za-z0-9._~:@%+\-/]+)+/g, '[redacted-path]')
}
