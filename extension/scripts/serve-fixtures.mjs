#!/usr/bin/env node
// Minimal static file server for the e2e fixtures directory
// (tests/fixtures/). The brief suggested installing `http-server` as a
// devDependency, but the fixture set is two files and Node's own `http`
// module is enough to serve them — this avoids a third-party dependency the
// task didn't otherwise need. Used only from playwright.config.ts's
// `webServer.command`.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'tests', 'fixtures')
const PORT = 5599

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const requested = url.pathname === '/' ? '/lecture.html' : url.pathname
  const resolved = normalize(join(ROOT, requested))

  // Refuse anything that would escape the fixtures directory (e.g. `..`).
  if (!(resolved + sep).startsWith(ROOT + sep) && resolved !== ROOT) {
    res.writeHead(403).end('Forbidden')
    return
  }

  readFile(resolved)
    .then((body) => {
      const type = MIME[extname(resolved)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': type }).end(body)
    })
    .catch(() => {
      res.writeHead(404).end('Not found')
    })
})

server.listen(PORT, () => {
  console.log(`[serve-fixtures] listening on http://127.0.0.1:${PORT}`)
})
