'use strict'
const $ = (s, r = document) => r.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const main = $('#main')

async function api(path, opts = {}) {
  const o = { credentials: 'same-origin', ...opts, headers: { 'x-hv': '1', ...(opts.headers || {}) } }
  if (opts.json !== undefined) {
    o.method = o.method || 'POST'
    o.headers['content-type'] = 'application/json'
    o.body = JSON.stringify(opts.json)
  }
  const r = await fetch(path, o)
  if (r.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Signed out') }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`)
  return data
}
function toast(msg, bad) {
  const t = $('#toast')
  t.textContent = msg
  t.className = 'toast' + (bad ? ' bad' : '')
  clearTimeout(toast.t)
  toast.t = setTimeout(() => t.classList.add('hidden'), 3500)
}
const fmtBytes = (n) => {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i]
}
const fmtUptime = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text) } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select()
    document.execCommand('copy'); t.remove()
  }
  toast('Copied')
}

// ---------- auth ----------
function showLogin() {
  stopTimers()
  $('#shell').classList.add('hidden')
  $('#login').classList.remove('hidden')
  $('#login-pw').focus()
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  $('#login-err').textContent = ''
  try {
    await api('/api/login', { json: { password: $('#login-pw').value } })
    $('#login-pw').value = ''
    start()
  } catch (err) { $('#login-err').textContent = err.message }
})
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); showLogin() })

// ---------- router ----------
let timers = []
let cleanup = null
function stopTimers() { timers.forEach(clearInterval); timers = []; if (cleanup) { cleanup(); cleanup = null } }
const routes = { overview, terminal, files, web, settings }
function route() {
  stopTimers()
  const name = (location.hash.replace(/^#\/?/, '') || 'overview')
  const key = routes[name] ? name : 'overview'
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key))
  routes[key]()
}
window.addEventListener('hashchange', () => { if (!$('#shell').classList.contains('hidden')) route() })
async function start() {
  $('#login').classList.add('hidden')
  $('#shell').classList.remove('hidden')
  route()
}

const bar = (label, pct, extra = '') => `
  <div class="bar"><div class="lab"><span>${esc(label)}</span><span class="text">${Math.round(pct)}%${extra}</span></div>
  <div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div></div>`
const badge = (up) => `<span class="badge ${up ? 'online' : 'offline'}">${up ? 'Online' : 'Offline'}</span>`

// ---------- overview ----------
async function overview() {
  main.innerHTML = `<h1>Overview</h1><p class="sub">Your VPS at a glance.</p>
    <div class="grid two">
      <div class="card" id="c-conn"><h2>Connect</h2><p class="desc">Use these to log in from anywhere on your network.</p><div class="muted">Loading…</div></div>
      <div class="card" id="c-sys"><h2>System</h2><p class="desc">Live resource usage of the host.</p><div class="muted">Loading…</div></div>
    </div>
    <div class="card gap"><h2>Services</h2><div id="c-svc" class="muted">Loading…</div></div>`
  try {
    const c = await api('/api/connection')
    $('#c-conn').innerHTML = `<h2>Connect</h2><p class="desc">Use these to log in from anywhere on your network.</p>
      <div class="muted" style="font-size:12px;margin-bottom:4px">SSH</div>
      <div class="copyline"><code>${esc(c.sshCommand)}</code><button class="btn sm" data-copy="${esc(c.sshCommand)}">Copy</button></div>
      <div class="muted" style="font-size:12px;margin-bottom:10px">Log in as user <span class="text">${esc(c.sshUser)}</span> with your dashboard password (set it in Settings).</div>
      <div class="muted" style="font-size:12px;margin-bottom:4px">Your website</div>
      <div class="copyline"><code>${esc(c.webUrl)}</code><a class="btn sm" href="${esc(c.webUrl)}" target="_blank" rel="noopener">Open</a><button class="btn sm" data-copy="${esc(c.webUrl)}">Copy</button></div>`
    document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)))
  } catch (e) { $('#c-conn').insertAdjacentHTML('beforeend', `<div class="err">${esc(e.message)}</div>`) }

  const tick = async () => {
    try {
      const s = await api('/api/status')
      $('#c-sys').innerHTML = `<h2>System</h2><p class="desc">Live resource usage of the host.</p>
        ${bar(`CPU (${s.cores} cores)`, s.cpu)}
        ${bar('Memory', (s.mem.used / s.mem.total) * 100, ` · ${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`)}
        ${bar('Disk', s.disk.total ? (s.disk.used / s.disk.total) * 100 : 0, ` · ${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)}`)}
        <div class="kv"><span>Uptime</span><b>${fmtUptime(s.uptime)}</b></div>
        <div class="kv"><span>Load average</span><b>${s.load.map((x) => x.toFixed(2)).join(' · ')}</b></div>`
      $('#c-svc').className = ''
      $('#c-svc').innerHTML = `<div class="grid three">
        <div class="kv"><span>SSH shell</span>${badge(s.services.ssh)}</div>
        <div class="kv"><span>Web server (Caddy)</span>${badge(s.services.web)}</div>
        <div class="kv"><span>Dashboard</span>${badge(s.services.dashboard)}</div></div>`
    } catch {}
  }
  await tick()
  timers.push(setInterval(tick, 3000))
}

// ---------- terminal ----------
function terminal() {
  main.innerHTML = `<div class="row between"><div><h1>Terminal</h1><p class="sub">A shell inside your VPS. Install anything with <code>sudo apk add …</code> (sudo asks for the same password).</p></div>
    <button class="btn" id="t-re">Reconnect</button></div><div id="term-wrap"><div id="term"></div></div>`
  const term = new Terminal({
    cursorBlink: true, fontSize: 14, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    theme: { background: '#0d0e12', foreground: '#f3f4f6', cursor: '#c084fc', selectionBackground: 'rgba(192,132,252,.3)' },
  })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit)
  term.open($('#term'))
  let ws
  const sendSize = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows })) }
  const connect = () => {
    if (ws) { try { ws.close() } catch {} }
    term.reset()
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/term')
    ws.onopen = () => { fit.fit(); sendSize(); term.focus() }
    ws.onmessage = (e) => term.write(e.data)
    ws.onclose = () => term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n')
  }
  term.onData((d) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'd', d })) })
  term.onResize(sendSize)
  const onResize = () => fit.fit()
  window.addEventListener('resize', onResize)
  $('#t-re').onclick = connect
  fit.fit()
  connect()
  cleanup = () => { window.removeEventListener('resize', onResize); try { ws.close() } catch {}; term.dispose() }
}

// ---------- files ----------
const fstate = { root: 'sites', path: '' }
async function files() {
  const { root, path } = fstate
  main.innerHTML = `<h1>Files</h1><p class="sub">Manage your website files and your VPS home folder.</p>
    <div class="tabs"><button data-r="sites" class="${root === 'sites' ? 'on' : ''}">Website files</button>
    <button data-r="home" class="${root === 'home' ? 'on' : ''}">VPS home (~)</button></div>
    <div class="row between wrap"><div class="crumbs" id="crumbs"></div>
    <div class="row"><button class="btn sm" id="f-new">New file</button><button class="btn sm" id="f-dir">New folder</button>
    <button class="btn sm primary" id="f-up">Upload</button><input type="file" id="f-in" multiple hidden></div></div>
    <div class="card" style="padding:0"><table><thead><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody id="rows"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody></table></div>`
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { fstate.root = b.dataset.r; fstate.path = ''; files() }))
  const parts = path.split('/').filter(Boolean)
  $('#crumbs').innerHTML = `<a data-p="">${root === 'sites' ? 'sites' : '~'}</a>` + parts.map((p, i) => ` / <a data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</a>`).join('')
  document.querySelectorAll('#crumbs a').forEach((a) => (a.onclick = () => { fstate.path = a.dataset.p; files() }))
  const join = (n) => (path ? path + '/' : '') + n
  const q = (p) => `root=${root}&path=${encodeURIComponent(p)}`

  try {
    const { entries } = await api(`/api/files?${q(path)}`)
    $('#rows').innerHTML = entries.length ? entries.map((e) => `
      <tr class="entry"><td>${e.dir ? '📁' : '📄'} <a data-open="${esc(e.name)}" data-dir="${e.dir ? 1 : 0}">${esc(e.name)}</a></td>
      <td class="m">${e.dir ? '—' : fmtBytes(e.size)}</td><td class="m">${new Date(e.mtime).toLocaleString()}</td>
      <td class="act">${e.dir ? '' : `<a class="btn sm" href="/api/files/download?${q(join(e.name))}">Download</a> `}
      <button class="btn sm danger" data-del="${esc(e.name)}">Delete</button></td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">Empty folder.</td></tr>'
    document.querySelectorAll('[data-open]').forEach((a) => (a.onclick = () => {
      if (a.dataset.dir === '1') { fstate.path = join(a.dataset.open); files() } else editFile(root, join(a.dataset.open))
    }))
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm(`Delete "${b.dataset.del}"? This cannot be undone.`)) return
      try { await api('/api/files/delete', { json: { root, path: join(b.dataset.del) } }); files() } catch (e) { toast(e.message, true) }
    }))
  } catch (e) { $('#rows').innerHTML = `<tr><td colspan="4" class="err">${esc(e.message)}</td></tr>` }

  $('#f-up').onclick = () => $('#f-in').click()
  $('#f-in').onchange = async (e) => {
    for (const f of e.target.files) {
      try { await api(`/api/files/upload?${q(join(f.name))}`, { method: 'PUT', body: f }); toast(`Uploaded ${f.name}`) } catch (er) { toast(er.message, true) }
    }
    files()
  }
  $('#f-dir').onclick = async () => {
    const n = prompt('Folder name'); if (!n) return
    try { await api('/api/files/mkdir', { json: { root, path: join(n) } }); files() } catch (e) { toast(e.message, true) }
  }
  $('#f-new').onclick = async () => {
    const n = prompt('File name (e.g. index.html)'); if (!n) return
    try { await api(`/api/files/write?${q(join(n))}`, { method: 'PUT', json: { content: '' } }); editFile(root, join(n)) } catch (e) { toast(e.message, true) }
  }
}
async function editFile(root, p) {
  let content
  try { content = (await api(`/api/files/read?root=${root}&path=${encodeURIComponent(p)}`)).content } catch (e) { return toast(e.message, true) }
  const m = $('#modal')
  m.innerHTML = `<div class="card"><div class="row between"><h2 class="mono">${esc(p)}</h2><button class="btn sm" id="m-x">Close</button></div>
    <textarea id="m-t" spellcheck="false"></textarea><div class="row gap" style="justify-content:flex-end"><button class="btn primary" id="m-s">Save</button></div></div>`
  m.classList.remove('hidden')
  $('#m-t').value = content
  const close = () => { m.classList.add('hidden'); files() }
  $('#m-x').onclick = close
  $('#m-s').onclick = async () => {
    try { await api(`/api/files/write?root=${root}&path=${encodeURIComponent(p)}`, { method: 'PUT', json: { content: $('#m-t').value } }); toast('Saved'); close() } catch (e) { toast(e.message, true) }
  }
}

// ---------- web server ----------
async function web() {
  main.innerHTML = `<h1>Web Server</h1><p class="sub">Caddy serves everything in your <b class="text">sites</b> folder. Edit the Caddyfile to add domains or reverse-proxy other apps.</p>
    <div class="grid two">
      <div class="card"><h2>Your sites</h2><p class="desc">Top level of the website folder.</p><div id="sites" class="muted">Loading…</div></div>
      <div class="card"><div class="row between"><h2>Caddyfile</h2><button class="btn sm primary" id="cf-save">Save &amp; reload</button></div>
        <p class="desc">Caddy reloads automatically when this is saved. An invalid config is ignored and the old one keeps running.</p>
        <textarea id="cf" rows="16" spellcheck="false"></textarea></div>
    </div>`
  try {
    const c = await api('/api/connection')
    const { entries } = await api('/api/files?root=sites&path=')
    $('#sites').className = ''
    $('#sites').innerHTML = (entries.length ? entries.map((e) => `<div class="kv"><span class="text">${e.dir ? '📁' : '📄'} ${esc(e.name)}</span><span class="muted">${e.dir ? '' : fmtBytes(e.size)}</span></div>`).join('') : '<span class="muted">No files yet.</span>') +
      `<div class="row gap"><a class="btn sm primary" href="${esc(c.webUrl)}" target="_blank" rel="noopener">Open site</a><a class="btn sm" href="#/files">Manage files</a></div>`
  } catch (e) { $('#sites').textContent = e.message }
  try { $('#cf').value = (await api('/api/caddyfile')).content } catch (e) { toast(e.message, true) }
  $('#cf-save').onclick = async () => {
    try { await api('/api/caddyfile', { method: 'PUT', json: { content: $('#cf').value } }); toast('Saved - Caddy is reloading') } catch (e) { toast(e.message, true) }
  }
}

// ---------- settings ----------
function settings() {
  main.innerHTML = `<h1>Settings</h1><p class="sub">Account security for the dashboard and the SSH shell.</p>
    <div class="card" style="max-width:460px"><h2>Change password</h2>
    <p class="desc">One password is used for the dashboard login <b class="text">and</b> SSH (user <code>vps</code>). The default is <code>admin</code> - change it, especially if you expose anything to the internet.</p>
    <form id="pw-form" style="display:flex;flex-direction:column;gap:10px">
      <input id="pw-cur" type="password" placeholder="Current password" autocomplete="current-password" />
      <input id="pw-new" type="password" placeholder="New password (4+ characters)" autocomplete="new-password" />
      <input id="pw-new2" type="password" placeholder="Repeat new password" autocomplete="new-password" />
      <div id="pw-err" class="err"></div>
      <button class="btn primary" type="submit">Change password</button></form></div>`
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    $('#pw-err').textContent = ''
    if ($('#pw-new').value !== $('#pw-new2').value) return ($('#pw-err').textContent = "New passwords don't match.")
    try {
      await api('/api/password', { json: { current: $('#pw-cur').value, next: $('#pw-new').value } })
      toast('Password changed (dashboard and SSH)')
      $('#pw-form').reset()
    } catch (err) { $('#pw-err').textContent = err.message }
  })
}

// ---------- boot ----------
api('/api/session').then((s) => (s.authed ? start() : showLogin())).catch(showLogin)
