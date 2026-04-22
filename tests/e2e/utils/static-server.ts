import { createServer, type Server } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

// Minimal static server for the test-sites/ demo vertical pages. Avoids
// adding a bundler or `serve`/`http-server` dependency (Rule 15).
// Serves text files with a sane Content-Type, directory requests with an
// appended `index.html`, and a 404 otherwise. No directory listing.

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
}

export interface StaticServerHandle {
  url: string
  port: number
  stop: () => Promise<void>
}

export async function startStaticServer(
  rootDir: string,
  opts: { port?: number; host?: string } = {}
): Promise<StaticServerHandle> {
  const root = resolve(rootDir)
  const host = opts.host ?? '127.0.0.1'
  const desiredPort = opts.port ?? 0

  const server: Server = createServer((req, res) => {
    const rawUrl = req.url ?? '/'
    const pathnameRaw = decodeURIComponent(rawUrl.split('?')[0])
    let pathname = normalize(pathnameRaw).replace(/^(\.\.(\/|\\|$))+/, '')
    if (pathname.endsWith('/')) pathname += 'index.html'
    const filePath = join(root, pathname)
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    try {
      const stat = statSync(filePath)
      if (stat.isDirectory()) {
        res.writeHead(301, { Location: rawUrl.endsWith('/') ? rawUrl + 'index.html' : rawUrl + '/' })
        res.end()
        return
      }
      const body = readFileSync(filePath)
      const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
        // Allow Worker iframes / the banner script to fetch from this origin.
        'Access-Control-Allow-Origin': '*'
      })
      res.end(body)
    } catch {
      res.writeHead(404).end('Not found')
    }
  })

  const port: number = await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(desiredPort, host, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolveListen(addr.port)
      else rejectListen(new Error('unexpected listen address'))
    })
  })

  return {
    url: `http://${host}:${port}`,
    port,
    stop: () =>
      new Promise<void>((resolveStop) => {
        server.close(() => resolveStop())
      })
  }
}
