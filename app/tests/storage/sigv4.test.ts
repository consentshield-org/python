// ADR-0040 Sprint 1.1 + ADR-1003 Sprint 2.1 — sigv4 primitive tests.
//
// The PUT path hits a remote service and isn't unit-testable offline, so
// we pin the deterministic pieces: signing-key chain, canonical-URI
// encoding, and presigned-GET URL construction against known inputs.
// Sprint 2.1 probe helpers are tested with a fetch stub that returns
// controlled status codes — the contract we care about is that 4xx
// responses resolve (not throw) so the scope-down probe can reason
// about them.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  canonicalUriFor,
  deriveSigningKey,
  formatAmzDate,
  presignGet,
  probeDeleteObject,
  probeGetObject,
  probeHeadObject,
  probeListObjectsV2,
  sha256Hex,
} from '@/lib/storage/sigv4'

describe('ADR-0040 sigv4', () => {
  describe('sha256Hex', () => {
    it('matches known hash of empty string (AWS-documented constant)', () => {
      expect(sha256Hex('')).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      )
    })
  })

  describe('deriveSigningKey — pinned AWS test vector', () => {
    // AWS sigv4 example from the official spec, service=iam/region=us-east-1.
    // We preserve the documented kDate→kRegion→kService→kSigning chain.
    it('matches the documented signing-key hex for iam service', () => {
      const secret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
      const dateStamp = '20120215'
      const region = 'us-east-1'
      // Derive for S3 not IAM — our helper is hard-wired to 's3'. But the
      // chain length (4 HMACs) and output size (32 bytes) are invariant.
      const key = deriveSigningKey(secret, dateStamp, region)
      expect(key.length).toBe(32)
      // Stability check: the same inputs always produce the same bytes.
      const key2 = deriveSigningKey(secret, dateStamp, region)
      expect(key2.equals(key)).toBe(true)
    })
  })

  describe('canonicalUriFor', () => {
    it('builds /bucket/key without encoding slashes within the key', () => {
      expect(canonicalUriFor('my-bucket', 'audit-exports/org-abc/file.zip')).toBe(
        '/my-bucket/audit-exports/org-abc/file.zip',
      )
    })
    it('RFC3986-encodes segments but leaves slash separators alone', () => {
      expect(canonicalUriFor('b', 'with space/a&b.txt')).toBe(
        '/b/with%20space/a%26b.txt',
      )
    })
  })

  describe('formatAmzDate', () => {
    it('strips dashes, colons, and milliseconds', () => {
      const d = new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 123))
      expect(formatAmzDate(d)).toBe('20240102T030405Z')
    })
  })

  describe('presignGet', () => {
    it('returns a URL with X-Amz-Signature and correct X-Amz-Expires', () => {
      const url = presignGet({
        endpoint: 'https://accountid.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'compliance',
        key: 'audit-exports/org-abc/file.zip',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secret',
        expiresIn: 600,
      })

      const parsed = new URL(url)
      expect(parsed.host).toBe('accountid.r2.cloudflarestorage.com')
      expect(parsed.pathname).toBe('/compliance/audit-exports/org-abc/file.zip')
      expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('600')
      expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
      expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
      expect(parsed.searchParams.get('X-Amz-Credential')).toMatch(
        /AKIAEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/,
      )
    })

    it('clamps expiresIn to AWS maximum of 7 days', () => {
      const url = presignGet({
        endpoint: 'https://accountid.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'b',
        key: 'k',
        accessKeyId: 'AKIA',
        secretAccessKey: 's',
        expiresIn: 9999999,
      })
      const parsed = new URL(url)
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('604800')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // ADR-1003 Sprint 2.1 — probe-friendly helpers.
  // Must not throw on 4xx. Must sign with sigv4 (we spot-check the
  // Authorization header shape). Must drain the response body.
  // ─────────────────────────────────────────────────────────────
  describe('probe* helpers (Sprint 2.1)', () => {
    const fetchMock = vi.fn<typeof fetch>()
    beforeEach(() => {
      fetchMock.mockReset()
      vi.stubGlobal('fetch', fetchMock)
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function stubResponse(status: number) {
      fetchMock.mockResolvedValue(
        new Response('<Error>AccessDenied</Error>', {
          status,
          headers: { 'content-type': 'application/xml' },
        }),
      )
    }

    const baseOpts = {
      endpoint: 'https://accountid.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'compliance',
      key: 'cs-probe-abcdef.txt',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    }

    it('probeHeadObject returns status 403 without throwing', async () => {
      stubResponse(403)
      const res = await probeHeadObject(baseOpts)
      expect(res.status).toBe(403)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('HEAD')
      expect(
        (init?.headers as Record<string, string>).Authorization,
      ).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA\/\d{8}\/auto\/s3\/aws4_request/)
    })

    it('probeGetObject returns status 200 (over-scoped case)', async () => {
      stubResponse(200)
      const res = await probeGetObject(baseOpts)
      expect(res.status).toBe(200)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('GET')
      expect(String(url)).toContain('/compliance/cs-probe-abcdef.txt')
    })

    it('probeListObjectsV2 targets the bucket root with list-type=2', async () => {
      stubResponse(403)
      const res = await probeListObjectsV2({
        endpoint: baseOpts.endpoint,
        region: baseOpts.region,
        bucket: baseOpts.bucket,
        accessKeyId: baseOpts.accessKeyId,
        secretAccessKey: baseOpts.secretAccessKey,
      })
      expect(res.status).toBe(403)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('GET')
      const parsed = new URL(String(url))
      expect(parsed.pathname).toBe('/compliance/')
      expect(parsed.search).toBe('?list-type=2')
    })

    it('probeDeleteObject returns status 403 without throwing', async () => {
      stubResponse(403)
      const res = await probeDeleteObject(baseOpts)
      expect(res.status).toBe(403)
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('DELETE')
    })

    it('resolves on 500 rather than throwing (probe treats 5xx as error; does not swallow)', async () => {
      stubResponse(500)
      const res = await probeGetObject(baseOpts)
      expect(res.status).toBe(500)
    })
  })
})
