'use client'

import { useState } from 'react'

export function SnippetBlock({
  cdnUrl,
  orgId,
  propertyId,
}: {
  cdnUrl: string
  orgId: string
  propertyId: string
}) {
  const [copied, setCopied] = useState(false)
  const snippet = `<script async src="${cdnUrl}/v1/banner.js?org=${orgId}&prop=${propertyId}"></script>`

  async function handleCopy() {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative">
      <pre className="rounded bg-gray-900 p-4 text-xs text-gray-100 overflow-x-auto">
        <code>{snippet}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 rounded bg-gray-700 px-2 py-1 text-xs text-white hover:bg-gray-600"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}
