'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Property {
  id: string
  name: string
  url: string
  allowed_origins: string[]
}

export function PropertyEditor({ orgId, property }: { orgId: string; property: Property }) {
  const [name, setName] = useState(property.name)
  const [url, setUrl] = useState(property.url)
  const [origins, setOrigins] = useState(property.allowed_origins.join('\n'))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess(false)

    const allowed_origins = origins
      .split(/[,\n]/)
      .map((o) => o.trim())
      .filter(Boolean)

    const res = await fetch(`/api/orgs/${orgId}/properties/${property.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, allowed_origins }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Save failed')
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
    router.refresh()
  }

  return (
    <form onSubmit={handleSave} className="rounded border border-gray-200 p-4 space-y-4">
      <h2 className="font-medium">Property Settings</h2>

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
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="origins" className="block text-sm font-medium">
          Allowed Origins
        </label>
        <textarea
          id="origins"
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          rows={4}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
        <p className="mt-1 text-xs text-gray-500">
          One origin per line. Consent events from any other origin will be rejected.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">Saved.</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  )
}
