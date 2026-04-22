// ADR-1014 Sprint 2.1 — tiny dependency-free static server for the demo
// sites. Runs on Railway (or locally) with PORT from env. Serves index.html
// for bare directory requests.
//
// No npm deps (per repo Rule 15 / zero-deps preference).

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = __dirname
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '0.0.0.0'

const MIME = {
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

const server = http.createServer((req, res) => {
  const rawPath = decodeURIComponent((req.url || '/').split('?')[0])
  const safe = path.posix.normalize(rawPath).replace(/^(\.\.(\/|$))+/, '/')
  let target = path.join(ROOT, safe.endsWith('/') ? safe + 'index.html' : safe)
  try {
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      res.writeHead(301, { Location: rawPath.endsWith('/') ? rawPath + 'index.html' : rawPath + '/' })
      res.end()
      return
    }
    const body = fs.readFileSync(target)
    const mime = MIME[path.extname(target)] || 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
})

server.listen(PORT, HOST, () => {
  console.log(`consentshield test-sites listening on http://${HOST}:${PORT}`)
})
