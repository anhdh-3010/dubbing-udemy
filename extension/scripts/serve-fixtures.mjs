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

// The extension only needs bytes that decode as audio and a duration header
// it can trust — nothing here has to sound like speech. A quiet 220 Hz tone
// is used rather than silence so anyone who plays the file can tell it
// arrived intact.
function wav(seconds, sampleRate = 24000) {
  const samples = Math.round(seconds * sampleRate)
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 8000), 44 + i * 2)
  }
  return buf
}

// How many times the stub has actually synthesised. The e2e run reads this
// to tell "the extension asked again" from "the extension used its cache" —
// a distinction invisible from the page, because both produce the same audio.
let synthCount = 0

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  // No CORS headers here, and no OPTIONS handler: every caller in the e2e
  // run is the extension's own service worker (background.ts), whose fetch
  // to a host covered by host_permissions is exempt from CORS entirely —
  // no preflight is ever sent, so a handler for one would never run. The
  // real server (server/app.py) restricts its CORS policy to
  // chrome-extension:// origins to stop an ordinary web page from reaching
  // the local TTS server directly; this stub has no such caller to defend
  // against.
  if (url.pathname === '/health') {
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ status: 'ok', model_loaded: true, stub: true }))
    return
  }

  if (url.pathname === '/stub/synth-count') {
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ count: synthCount }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      let input = ''
      try {
        input = JSON.parse(body).input ?? ''
      } catch {
        // A malformed body yields the shortest clip rather than a 500 —
        // this stub is not the thing under test.
      }
      // Proportional to the text so the scheduler's stretch maths has
      // something varied to work on, and clamped so the run stays quick.
      const seconds = Math.min(3, Math.max(0.2, input.length / 20))
      synthCount++
      const data = wav(seconds)
      res
        .writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': data.length,
          'X-Audio-Duration': seconds.toFixed(3),
        })
        .end(data)
    })
    return
  }

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
