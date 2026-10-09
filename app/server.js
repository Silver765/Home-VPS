'use strict'
const express = require('express')
const http = require('http')
const net = require('net')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { WebSocketServer } = require('ws')
const { Client: SSHClient } = require('ssh2')

const PORT = Number(process.env.PORT || 3010)
const DATA_DIR = process.env.DATA_DIR || '/data'
const PASSWORD = process.env.APP_PASSWORD || ''
const SSH_HOST = process.env.SSH_HOST || 'vps'
const SSH_PORT = Number(process.env.SSH_PORT || 2222)
const SSH_USER = process.env.SSH_USER || 'vps'
const WEB_HOST = process.env.WEB_HOST || 'web'
const WEB_PORT = Number(process.env.WEB_PORT || 80)
const PUBLIC_SSH_PORT = process.env.PUBLIC_SSH_PORT || '2222'
const PUBLIC_WEB_PORT = process.env.PUBLIC_WEB_PORT || '8088'

if (!PASSWORD) {
  console.error('APP_PASSWORD is not set - refusing to start without a password.')
  process.exit(1)
}

const ROOTS = {
  sites: path.join(DATA_DIR, 'sites'),
  home: path.join(DATA_DIR, 'vps-home'),
}
const CADDYFILE = path.join(DATA_DIR, 'caddy', 'Caddyfile')

// ---------- auth ----------
const SECRET = crypto.createHash('sha256').update('home-vps:' + PASSWORD).digest()
const SESSION_MS = 12 * 60 * 60 * 1000
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url')
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
function makeToken() {
  const exp = String(Date.now() + SESSION_MS)
  return exp + '.' + sign(exp)
}
function validToken(t) {
  if (!t) return false
  const [exp, sig] = t.split('.')
  return !!sig && safeEq(sign(exp), sig) && Number(exp) > Date.now()
}
function cookieOf(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return ''
}
const authed = (req) => validToken(cookieOf(req, 'hv_session'))

const fails = new Map() // ip -> {n, until}
function throttled(ip) {
  const f = fails.get(ip)
  return !!f && f.n >= 5 && f.until > Date.now()
}
function noteFail(ip) {
  const f = fails.get(ip)
  if (f && f.until > Date.now()) { f.n++; f.until = Date.now() + 60_000 }
  else fails.set(ip, { n: 1, until: Date.now() + 60_000 })
}

// ---------- app ----------
const app = express()
app.disable('x-powered-by')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

app.post('/api/login', express.json({ limit: '4kb' }), (req, res) => {
  const ip = req.socket.remoteAddress
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts - wait a minute.' })
  if (!safeEq((req.body && req.body.password) || '', PASSWORD)) {
    noteFail(ip)
    return res.status(401).json({ error: 'Wrong password.' })
  }
  fails.delete(ip)
  res.setHeader('Set-Cookie', `hv_session=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`)
  res.json({ ok: true })
})
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'hv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
  res.json({ ok: true })
})
app.get('/api/session', (req, res) => res.json({ authed: authed(req) }))

// Everything else under /api needs a session; mutations also need the CSRF header.
app.use('/api', (req, res, next) => {
  if (!authed(req)) return res.status(401).json({ error: 'Not signed in.' })
  if (req.method !== 'GET' && req.headers['x-hv'] !== '1') return res.status(403).json({ error: 'Bad request.' })
  next()
})

// ---------- status ----------
let lastCpu = null
function cpuTimes() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number)
  const idle = line[3] + (line[4] || 0)
  return { idle, total: line.reduce((a, b) => a + b, 0) }
}
function cpuPercent() {
  try {
    const now = cpuTimes()
    const prev = lastCpu
    lastCpu = now
    if (!prev) return 0
    const dt = now.total - prev.total
    return dt > 0 ? (1 - (now.idle - prev.idle) / dt) * 100 : 0
  } catch {
    return Math.min(100, (os.loadavg()[0] / os.cpus().length) * 100)
  }
}
function memInfo() {
  try {
    const m = {}
    for (const l of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
      const [k, v] = l.split(':')
      if (v) m[k] = parseInt(v, 10) * 1024
    }
    const total = m.MemTotal
    const avail = m.MemAvailable !== undefined ? m.MemAvailable : m.MemFree
    return { total, used: total - avail }
  } catch {
    return { total: os.totalmem(), used: os.totalmem() - os.freemem() }
  }
}
function probe(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 800 })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('timeout', () => { s.destroy(); resolve(false) })
    s.once('error', () => resolve(false))
  })
}
app.get('/api/status', async (req, res) => {
  let disk = { total: 0, used: 0 }
  try {
    const s = await fsp.statfs(DATA_DIR)
    disk = { total: s.blocks * s.bsize, used: (s.blocks - s.bavail) * s.bsize }
  } catch {}
  const [ssh, web] = await Promise.all([probe(SSH_HOST, SSH_PORT), probe(WEB_HOST, WEB_PORT)])
  res.json({
    cpu: cpuPercent(),
    cores: os.cpus().length,
    mem: memInfo(),
    disk,
    uptime: os.uptime(),
    load: os.loadavg(),
    services: { ssh, web, dashboard: true },
  })
})
app.get('/api/connection', (req, res) => {
  const host = (req.headers.host || 'localhost').replace(/:\d+$/, '')
  res.json({
    host, sshUser: SSH_USER, sshPort: PUBLIC_SSH_PORT, webPort: PUBLIC_WEB_PORT,
    sshCommand: `ssh ${SSH_USER}@${host} -p ${PUBLIC_SSH_PORT}`,
    webUrl: `http://${host}:${PUBLIC_WEB_PORT}`,
    password: PASSWORD,
  })
})

// ---------- files ----------
function rootOf(name) {
  const r = ROOTS[name]
  if (!r) throw Object.assign(new Error('Unknown location.'), { status: 400 })
  return r
}
async function resolveSafe(rootName, rel) {
  const root = rootOf(rootName)
  const full = path.resolve(root, '.' + path.sep + String(rel || ''))
  if (full !== root && !full.startsWith(root + path.sep)) throw Object.assign(new Error('Path outside root.'), { status: 400 })
  // symlink escape check: the deepest existing ancestor must still resolve inside the real root
  const realRoot = await fsp.realpath(root)
  let p = full
  for (;;) {
    try { p = await fsp.realpath(p); break } catch { p = path.dirname(p) }
  }
  if (p !== realRoot && !p.startsWith(realRoot + path.sep)) throw Object.assign(new Error('Path outside root.'), { status: 400 })
  return full
}
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (!res.headersSent) res.status(e.status || (e.code === 'ENOENT' ? 404 : 500)).json({ error: e.message })
})

app.get('/api/files', wrap(async (req, res) => {
  const dir = await resolveSafe(req.query.root, req.query.path)
  const out = []
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    try {
      const st = await fsp.stat(path.join(dir, e.name))
      out.push({ name: e.name, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs })
    } catch {}
  }
  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name))
  res.json({ entries: out })
}))
app.get('/api/files/read', wrap(async (req, res) => {
  const f = await resolveSafe(req.query.root, req.query.path)
  const st = await fsp.stat(f)
  if (st.size > 1024 * 1024) return res.status(413).json({ error: 'File is larger than 1 MB - download it instead.' })
  const buf = await fsp.readFile(f)
  if (buf.includes(0)) return res.status(415).json({ error: 'Binary file - download it instead.' })
  res.json({ content: buf.toString('utf8') })
}))
app.put('/api/files/write', express.json({ limit: '2mb' }), wrap(async (req, res) => {
  const f = await resolveSafe(req.query.root, req.query.path)
  await fsp.writeFile(f, String((req.body && req.body.content) || ''))
  res.json({ ok: true })
}))
app.put('/api/files/upload', wrap(async (req, res) => {
  const f = await resolveSafe(req.query.root, req.query.path)
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(f)
    req.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    req.on('error', reject)
  })
  res.json({ ok: true })
}))
app.post('/api/files/mkdir', express.json(), wrap(async (req, res) => {
  await fsp.mkdir(await resolveSafe(req.body.root, req.body.path), { recursive: true })
  res.json({ ok: true })
}))
app.post('/api/files/delete', express.json(), wrap(async (req, res) => {
  const f = await resolveSafe(req.body.root, req.body.path)
  if (f === rootOf(req.body.root)) return res.status(400).json({ error: 'Cannot delete the root folder.' })
  await fsp.rm(f, { recursive: true, force: true })
  res.json({ ok: true })
}))
app.get('/api/files/download', wrap(async (req, res) => {
  res.download(await resolveSafe(req.query.root, req.query.path))
}))

// ---------- caddyfile ----------
app.get('/api/caddyfile', wrap(async (req, res) => {
  res.json({ content: await fsp.readFile(CADDYFILE, 'utf8') })
}))
app.put('/api/caddyfile', express.json({ limit: '1mb' }), wrap(async (req, res) => {
  await fsp.writeFile(CADDYFILE, String((req.body && req.body.content) || '')) // in place: Caddy runs with --watch
  res.json({ ok: true })
}))

// ---------- static ----------
app.use('/vendor/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm')))
app.use('/vendor/addon-fit', express.static(path.join(__dirname, 'node_modules/@xterm/addon-fit')))
app.use(express.static(path.join(__dirname, 'public')))

// ---------- web terminal (bridges the browser to the VPS container's sshd) ----------
const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
server.on('upgrade', (req, socket, head) => {
  let originOk = true
  try { originOk = !req.headers.origin || new URL(req.headers.origin).host === req.headers.host } catch { originOk = false }
  if (req.url !== '/api/term' || !authed(req) || !originOk) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return socket.destroy()
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
})
wss.on('connection', (ws) => {
  const conn = new SSHClient()
  let stream = null
  const send = (s) => ws.readyState === 1 && ws.send(s)
  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, st) => {
      if (err) { send(`\r\n[ssh error: ${err.message}]\r\n`); return ws.close() }
      stream = st
      st.on('data', (d) => send(d.toString('utf8')))
      st.on('close', () => { send('\r\n[session closed]\r\n'); ws.close(); conn.end() })
    })
  })
  conn.on('error', (e) => { send(`\r\n[cannot reach the VPS container: ${e.message}]\r\n`); ws.close() })
  conn.connect({ host: SSH_HOST, port: SSH_PORT, username: SSH_USER, password: PASSWORD, readyTimeout: 8000 })
  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(raw.toString()) } catch { return }
    if (!stream) return
    if (m.t === 'd') stream.write(String(m.d))
    else if (m.t === 'r') stream.setWindow(Number(m.r) || 24, Number(m.c) || 80, 0, 0)
  })
  ws.on('close', () => { try { if (stream) stream.end() } catch {} conn.end() })
})

server.listen(PORT, '0.0.0.0', () => console.log(`Home VPS dashboard on :${PORT}`))
