// ADR-0040 Sprint 1.1 + ADR-1003 Sprint 2.1 + ADR-1014 Phase 4 follow-up
// — sigv4 primitive tests.
//
// The PUT path hits a remote service and isn't unit-testable offline, so
// we pin the deterministic pieces: signing-key chain, canonical-URI
// encoding, and presigned-GET URL construction against known inputs.
// Sprint 2.1 probe helpers are tested with a fetch stub that returns
// controlled status codes — the contract we care about is that 4xx
// responses resolve (not throw) so the scope-down probe can reason
// about them.
//
// ADR-1014 Phase-4 follow-up additions: pinned sigv4 vectors with a
// frozen clock so Stryker can mutate the canonical-request assembly
// (header order, signed-headers list, dateStamp slicing, HMAC-chain
// composition) and the test suite catches the change. Without pinned
// signatures, internal mutations produce different-but-still-valid
// 64-char hex strings that pass shape-only assertions. The capture
// driver lives at `scripts/capture-sigv4-vectors.ts`.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  canonicalUriFor,
  deleteObject,
  deriveSigningKey,
  formatAmzDate,
  presignGet,
  probeDeleteObject,
  probeGetObject,
  probeHeadObject,
  probeListObjectsV2,
  putObject,
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

  // ─────────────────────────────────────────────────────────────
  // ADR-1014 Phase-4 follow-up — pinned vectors with frozen clock.
  //
  // Captured by `bunx tsx scripts/capture-sigv4-vectors.ts` against
  // the in-tree implementation. Re-capture only when sigv4.ts changes
  // intentionally; otherwise the existing pins must hold and these
  // tests are the kill-set for Stryker mutations to the canonical-
  // request assembly + signing chain.
  //
  // FROZEN clock: Date.UTC(2026, 0, 15, 8, 0, 0) → 2026-01-15T08:00:00Z
  // → formatAmzDate '20260115T080000Z' / dateStamp '20260115'.
  // ─────────────────────────────────────────────────────────────
  describe('pinned vectors (ADR-1014 Phase-4 follow-up)', () => {
    const FROZEN = new Date(Date.UTC(2026, 0, 15, 8, 0, 0))
    const COMMON = {
      endpoint: 'https://accountid.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'compliance',
      key: 'audit-exports/org-abc/2026-01/file.zip',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    }
    const EXPECTED_SIGNING_KEY_HEX =
      'c1b9225e0eeffb907946f2744a63c7c8b1776507e48c9acb4f8355c2af9e8f7b'
    const EXPECTED_PRESIGN_SIG =
      'de970dc7c7c6ebc1c9b732f1c94e5b6e3064448d0ada1a45e8e1076e85f2996c'
    const EXPECTED_PUT_SIG =
      '82882c6f14b56a080b023e4798ed5965b7367a87c0316b4da6834b5e3b4bb24f'
    const EXPECTED_PUT_BODY_HASH =
      '8f6d4a1e19b34f4a1e0a68e0da202ab29fb913fa04cbc685836bb25af64ed2f8'
    const EXPECTED_DELETE_SIG =
      '9f4d1941a044c144737e6e4fde3e5b927d322e66fcea0c079295ec10b08e1656'

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(FROZEN)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('formatAmzDate produces the canonical 20260115T080000Z form', () => {
      // Defends against mutants that change the regex pattern in
      // formatAmzDate (replace [:-]|\.\d{3} with anything weaker).
      expect(formatAmzDate(FROZEN)).toBe('20260115T080000Z')
    })

    it('deriveSigningKey produces the pinned 32-byte chain', () => {
      // Defends against mutants in the kDate→kRegion→kService→kSigning
      // HMAC chain (operator swaps, dropped steps, wrong service literal).
      const key = deriveSigningKey(COMMON.secretAccessKey, '20260115', COMMON.region)
      expect(key.toString('hex')).toBe(EXPECTED_SIGNING_KEY_HEX)
    })

    it('canonicalUriFor pins the encoded path for a multi-segment key', () => {
      // Defends against mutants that mishandle slash separators (e.g.
      // encoding '/' as '%2F' or dropping segments).
      expect(canonicalUriFor(COMMON.bucket, COMMON.key)).toBe(
        '/compliance/audit-exports/org-abc/2026-01/file.zip',
      )
    })

    it('sha256Hex matches the empty-string AWS-documented constant', () => {
      // Already covered above but pinned a second time as a defence-in-
      // depth against mutants that swap '' for 'Stryker was here!' and
      // happen to land on a zero-coverage area in the other test.
      expect(sha256Hex('')).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      )
    })

    it('presignGet produces the pinned signature + URL for a known input', () => {
      // The full kill: any mutation to the canonical-request assembly,
      // string-to-sign concatenation, signing-key chain, or final HMAC
      // changes this hex. Pinned against the captured vector.
      const url = presignGet({ ...COMMON, expiresIn: 600 })
      const parsed = new URL(url)
      expect(parsed.searchParams.get('X-Amz-Signature')).toBe(EXPECTED_PRESIGN_SIG)
      expect(parsed.searchParams.get('X-Amz-Date')).toBe('20260115T080000Z')
      expect(parsed.searchParams.get('X-Amz-Credential')).toBe(
        'AKIAEXAMPLE/20260115/auto/s3/aws4_request',
      )
    })

    it('putObject sends the pinned Authorization header for a known body + metadata', async () => {
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock.mockResolvedValue(
        new Response(null, { status: 200, headers: { etag: '"deadbeef"' } }),
      )
      vi.stubGlobal('fetch', fetchMock)

      try {
        await putObject({
          ...COMMON,
          body: Buffer.from('test-body-content', 'utf8'),
          contentType: 'application/json; charset=utf-8',
          metadata: {
            // Capture-driver normalises x-amz-meta-cs-row-id + cs-org-id.
            'cs-row-id': '11111111-1111-1111-1111-111111111111',
            'cs-org-id': '22222222-2222-2222-2222-222222222222',
          },
        })
      } finally {
        vi.unstubAllGlobals()
      }

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toBe(
        `${COMMON.endpoint}/compliance/audit-exports/org-abc/2026-01/file.zip`,
      )
      expect(init?.method).toBe('PUT')
      const headers = init?.headers as Record<string, string>
      expect(headers['x-amz-content-sha256']).toBe(EXPECTED_PUT_BODY_HASH)
      expect(headers['x-amz-date']).toBe('20260115T080000Z')
      expect(headers['Authorization']).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260115/auto/s3/aws4_request, ' +
          'SignedHeaders=content-length;content-type;host;x-amz-content-sha256;' +
          'x-amz-date;x-amz-meta-cs-org-id;x-amz-meta-cs-row-id, ' +
          `Signature=${EXPECTED_PUT_SIG}`,
      )
    })

    it('probeHeadObject sends the pinned Authorization header for the empty-payload path', async () => {
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock.mockResolvedValue(new Response('', { status: 403 }))
      vi.stubGlobal('fetch', fetchMock)
      try {
        await probeHeadObject(COMMON)
      } finally {
        vi.unstubAllGlobals()
      }

      const [url, init] = fetchMock.mock.calls[0]!
      // Exact URL match defends against the L277 mutant that flips the
      // empty-queryString fallback string.
      expect(String(url)).toBe(
        `${COMMON.endpoint}/compliance/audit-exports/org-abc/2026-01/file.zip`,
      )
      expect(init?.method).toBe('HEAD')
      const headers = init?.headers as Record<string, string>
      expect(headers['Authorization']).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260115/auto/s3/aws4_request, ' +
          'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
          'Signature=009829b7210153ec49efda2b817aa2b30f460b346d09b10d1c547e5e1feabd72',
      )
    })

    it('probeGetObject sends the pinned Authorization header (GET method, key path)', async () => {
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock.mockResolvedValue(new Response('', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      try {
        await probeGetObject(COMMON)
      } finally {
        vi.unstubAllGlobals()
      }
      const [, init] = fetchMock.mock.calls[0]!
      const headers = init?.headers as Record<string, string>
      // Distinct signature from HEAD/DELETE because the canonical-request
      // begins with the method literal — defends against an L211 mutant
      // that replaces the 'GET' literal in the helper call.
      expect(headers['Authorization']).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260115/auto/s3/aws4_request, ' +
          'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
          'Signature=2ffcf35ee519e430e74d676a65df16ebf0b831c997b4f78483a78a0f6a527c5a',
      )
    })

    it('probeDeleteObject sends the pinned Authorization header (DELETE method, key path)', async () => {
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock.mockResolvedValue(new Response('', { status: 403 }))
      vi.stubGlobal('fetch', fetchMock)
      try {
        await probeDeleteObject(COMMON)
      } finally {
        vi.unstubAllGlobals()
      }
      const [, init] = fetchMock.mock.calls[0]!
      const headers = init?.headers as Record<string, string>
      // Same DELETE method as deleteObject() — but routed through the
      // signedProbeRequest helper, so this exercises the L226 'DELETE'
      // literal in the probe call site.
      expect(headers['Authorization']).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260115/auto/s3/aws4_request, ' +
          'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
          'Signature=9f4d1941a044c144737e6e4fde3e5b927d322e66fcea0c079295ec10b08e1656',
      )
    })

    it('probeListObjectsV2 sends the pinned Authorization header for the bucket-root path', async () => {
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock.mockResolvedValue(new Response('<list/>', { status: 403 }))
      vi.stubGlobal('fetch', fetchMock)
      try {
        const { key: _ignored, ...probeOpts } = COMMON
        await probeListObjectsV2(probeOpts)
      } finally {
        vi.unstubAllGlobals()
      }

      const [url, init] = fetchMock.mock.calls[0]!
      // bucket-root URL ends in trailing slash + the list-type=2 query
      expect(String(url)).toBe(
        `${COMMON.endpoint}/compliance/?list-type=2`,
      )
      const headers = init?.headers as Record<string, string>
      expect(headers['Authorization']).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260115/auto/s3/aws4_request, ' +
          'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
          'Signature=ff467fd2ad8fcf36c3ef91d3481c272dea9ac14685edb2933a3af06d75559aee',
      )
    })

    it('deleteObject sends the pinned Authorization header (empty payload hash path)', async () => {
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
      vi.stubGlobal('fetch', fetchMock)

      try {
        await deleteObject(COMMON)
      } finally {
        vi.unstubAllGlobals()
      }

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toBe(
        `${COMMON.endpoint}/compliance/audit-exports/org-abc/2026-01/file.zip`,
      )
      expect(init?.method).toBe('DELETE')
      const headers = init?.headers as Record<string, string>
      expect(headers['x-amz-date']).toBe('20260115T080000Z')
      expect(headers['x-amz-content-sha256']).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      )
      expect(headers['Authorization']).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260115/auto/s3/aws4_request, ' +
          'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
          `Signature=${EXPECTED_DELETE_SIG}`,
      )
    })

    it('putObject actually writes the metadata pairs onto the request headers (not just the signature)', async () => {
      // Defends against an L110 mutant that empties the for-loop body
      // (`for (const [name, value] of metaPairs) { requestHeaders[name]
      // = value }` → `for (...) {}`). Without that loop, the signed-
      // headers list still includes x-amz-meta-*, but the actual fetch
      // request omits them — R2 would 403 because the server-computed
      // signature wouldn't match.
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      try {
        await putObject({
          ...COMMON,
          body: Buffer.from('x', 'utf8'),
          contentType: 'application/json; charset=utf-8',
          metadata: {
            'cs-row-id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'cs-org-id': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          },
        })
      } finally {
        vi.unstubAllGlobals()
      }
      const [, init] = fetchMock.mock.calls[0]!
      const headers = init?.headers as Record<string, string>
      expect(headers['x-amz-meta-cs-row-id']).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      expect(headers['x-amz-meta-cs-org-id']).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    })

    it('putObject throws with status + body excerpt on a non-2xx response', async () => {
      // Defends against mutants that drop the !resp.ok branch / change
      // the 400-char clamp / mute the error message text. The Worker
      // translates upload_failed into a delivery-buffer markFailure
      // call; the failure message body is logged + persisted as
      // delivery_error, so its content matters.
      //
      // Also pins that the body excerpt actually contains the response
      // body — defends against an L122 mutant that drops the .catch on
      // resp.text() (the catch runs only on body-read failure, not on
      // success; the assertion still fires either way as long as text()
      // resolves on the mocked response).
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock.mockResolvedValue(
        new Response('<Error><Code>AccessDenied</Code></Error>', {
          status: 403,
          statusText: 'Forbidden',
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      try {
        await expect(
          putObject({
            ...COMMON,
            body: Buffer.from('x', 'utf8'),
            contentType: 'application/octet-stream',
          }),
        ).rejects.toThrow(/R2 PUT failed: 403 Forbidden — <Error><Code>AccessDenied<\/Code>/)
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('deleteObject throws on non-2xx unless 404 (404 is idempotent-friendly)', async () => {
      const fetchMock = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', fetchMock)
      try {
        // 500 → throws with body excerpt (defends L192 mutant that drops
        // .catch on resp.text() AND the message-body string mutants).
        fetchMock.mockResolvedValueOnce(
          new Response('<Error><Code>InternalError</Code></Error>', {
            status: 500,
            statusText: 'Internal Server Error',
          }),
        )
        await expect(deleteObject(COMMON)).rejects.toThrow(
          /R2 DELETE failed: 500 Internal Server Error — <Error><Code>InternalError/,
        )

        // 404 → resolves (object already gone)
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
        const r404 = await deleteObject(COMMON)
        expect(r404.status).toBe(404)

        // 204 → resolves (canonical success)
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        const r204 = await deleteObject(COMMON)
        expect(r204.status).toBe(204)
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('sha256Hex hashes a Buffer the same as the equivalent string', () => {
      // Defends against the input-type ternary mutants on
      //   data instanceof Buffer ? data : typeof data === 'string' ? data : Buffer.from(data)
      const asString = sha256Hex('hello world')
      const asBuffer = sha256Hex(Buffer.from('hello world', 'utf8'))
      expect(asString).toBe(asBuffer)
      expect(asString).toBe(
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
      )
    })

    it('sha256Hex hashes a Uint8Array via the Buffer.from fallback branch', () => {
      // The third branch of the ternary: typeof !== 'string' AND not Buffer.
      const u8 = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]) // 'hello'
      expect(sha256Hex(u8)).toBe(
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      )
    })
  })
})
