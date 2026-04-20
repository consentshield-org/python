/**
 * Downloads generator — runs as `bun scripts/generate-downloads.ts`
 * (wired into `prebuild` + exposed as `bun run downloads` for ad-hoc runs).
 *
 * Iterates the three canonical LegalDocuments and emits:
 *   public/downloads/{terms,privacy,dpa}.md
 *   public/downloads/{terms,privacy,dpa}.pdf
 *   public/downloads/{terms,privacy,dpa}.docx
 *
 * Files are build artefacts — they're gitignored. The Architecture Brief
 * trio (ConsentShield-Architecture-Brief.{pdf,docx,md}) is hand-authored
 * and stays committed.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { TERMS } from '../src/content/legal/terms'
import { PRIVACY } from '../src/content/legal/privacy'
import { DPA } from '../src/content/legal/dpa'
import { serializeToMarkdown } from '../src/content/legal/serialize-md'
import { serializeToPdf } from '../src/content/legal/serialize-pdf'
import { serializeToDocx } from '../src/content/legal/serialize-docx'
import type { LegalDocument } from '../src/content/legal/types'

const DOCS: LegalDocument[] = [TERMS, PRIVACY, DPA]

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(here, '..', 'public', 'downloads')

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  for (const doc of DOCS) {
    const base = path.join(OUT_DIR, doc.slug)

    const md = serializeToMarkdown(doc)
    await writeFile(`${base}.md`, md, 'utf8')

    const pdf = await serializeToPdf(doc)
    await writeFile(`${base}.pdf`, pdf)

    const docx = await serializeToDocx(doc)
    await writeFile(`${base}.docx`, docx)

    console.log(
      `  ✓ ${doc.slug.padEnd(8)}  md ${md.length.toString().padStart(6)}B  pdf ${pdf.length
        .toString()
        .padStart(7)}B  docx ${docx.length.toString().padStart(7)}B`,
    )
  }

  console.log(`\n  Wrote ${DOCS.length * 3} files to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error('downloads generator failed:', err)
  process.exit(1)
})
