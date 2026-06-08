import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl } from '../sourceGrounding'

describe('assertPublicHttpUrl', () => {
  it('accepts public https urls', () => {
    expect(assertPublicHttpUrl('https://www.sec.gov/cgi-bin/browse-edgar').hostname).toBe('www.sec.gov')
  })

  it('rejects non-http protocols', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(/protocol/i)
    expect(() => assertPublicHttpUrl('ftp://example.com')).toThrow(/protocol/i)
  })

  it('rejects localhost, loopback, link-local and private ranges', () => {
    for (const url of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://0.0.0.0/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://172.16.0.1/x',
    ]) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(/not allowed|private|loopback/i)
    }
  })
})
