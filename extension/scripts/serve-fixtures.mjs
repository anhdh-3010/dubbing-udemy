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
const HOST = '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

// player-bridge.ts only reads a lecture id out of a URL matching
// /\/learn\/lecture\/(\d+)/ — serving the fixture only at /lecture.html would
// leave that id-tracking machinery (attachedLectureId, lectureChanged) never
// exercised by the e2e run. Any /learn/lecture/<digits> path gets the same
// fixture page.
const LECTURE_ROUTE = /^\/learn\/lecture\/\d+\/?$/

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const requested =
    url.pathname === '/' || LECTURE_ROUTE.test(url.pathname) ? '/lecture.html' : url.pathname
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

// Bind explicitly: server.listen(PORT, cb) with no host binds all
// interfaces, making the fixtures LAN-reachable for the run's duration even
// though the log line below claims 127.0.0.1.
server.listen(PORT, HOST, () => {
  console.log(`[serve-fixtures] listening on http://${HOST}:${PORT}`)
})
