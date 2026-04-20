// ADR-0050 Sprint 3.2 — R2 helpers for dispute evidence bundles.
//
// Evidence ZIPs live at: disputes/{dispute_id}/evidence-{iso}.zip
// Returns a short-TTL presigned GET URL after upload.

import { createHash } from 'node:crypto'

import { putObject, presignGet } from '@/lib/storage/sigv4'

interface R2Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

function loadR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_INVOICES_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'R2 credentials missing: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_INVOICES_BUCKET',
    )
  }
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    bucket,
    accessKeyId,
    secretAccessKey,
  }
}

export function disputeEvidenceR2Key(disputeId: string): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `disputes/${disputeId}/evidence-${iso}.zip`
}

export interface UploadEvidenceBundleResult {
  r2Key: string
  sha256: string
  bytes: number
  presignedUrl: string
}

export async function uploadEvidenceBundle(
  disputeId: string,
  zipBuffer: Buffer,
  expiresIn = 900,
): Promise<UploadEvidenceBundleResult> {
  const cfg = loadR2Config()
  const key = disputeEvidenceR2Key(disputeId)
  const sha256 = createHash('sha256').update(zipBuffer).digest('hex')

  await putObject({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    body: zipBuffer,
    contentType: 'application/zip',
  })

  const presignedUrl = presignGet({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expiresIn,
  })

  return {
    r2Key: `${cfg.bucket}/${key}`,
    sha256,
    bytes: zipBuffer.length,
    presignedUrl,
  }
}
