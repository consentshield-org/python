'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CreatePropertyForm({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [origins, setOrigins] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const allowed_origins = origins
      .split(/[,\n]/)
      .map((o) => o.trim())
      .filter(Boolean)

    const res = await fetch(`/api/orgs/${orgId}/properties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, allowed_origins }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Failed to create property')
      setLoading(false)
      return
    }

    setName('')
    setUrl('')
    setOrigins('')
    setOpen(false)
    setLoading(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        + Add Web Property
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded border border-gray-200 p-4 space-y-4">
      <h2 className="font-medium">New Web Property</h2>

      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Main product"
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="url" className="block text-sm font-medium">
          URL
        </label>
        <input
          id="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="https://app.example.com"
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="origins" className="block text-sm font-medium">
          Allowed Origins (one per line, or comma-separated)
        </label>
        <textarea
          id="origins"
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          rows={3}
          placeholder={`https://app.example.com\nhttps://www.example.com`}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
        <p className="mt-1 text-xs text-gray-500">
          Consent events from these origins will be accepted. Leave empty to accept all (not
          recommended for production).
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Property'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
