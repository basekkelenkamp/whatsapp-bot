'use strict';

const http = require('http');
const QRCode = require('qrcode');

const { createLogger } = require('./logger');
const { listGroups } = require('./whatsapp/chats');

const log = createLogger('http');

/**
 * Serves two things on one port:
 *  - /health, polled by the Home Assistant Supervisor watchdog. When it stops
 *    answering 2xx the add-on is restarted for us.
 *  - /, the Ingress panel: current state, the QR code when pairing is needed,
 *    and buttons to reconnect or unlink.
 */
function createHealthServer({ service, registry, jobs, port }) {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

        try {
            if (route === 'GET /health') return sendHealth(res, service);
            if (route === 'GET /api/status') return sendJson(res, 200, service.getSnapshot());
            if (route === 'POST /api/restart') {
                service.restart('requested from the panel');
                return sendJson(res, 202, { ok: true });
            }
            if (route === 'POST /api/reset-session') {
                service.resetSession().catch((err) => log.error(`Session reset failed: ${err.message}`));
                return sendJson(res, 202, { ok: true });
            }
            if (route === 'GET /groups') return sendHtml(res, await renderGroups(service));
            if (route === 'GET /') return sendHtml(res, await renderPanel(service, registry, jobs));
            return sendJson(res, 404, { error: 'not found' });
        } catch (err) {
            log.error(`${route} failed: ${err.stack || err.message}`);
            return sendJson(res, 500, { error: err.message });
        }
    });

    server.listen(port, '0.0.0.0', () => log.info(`Health + panel listening on :${port}`));
    server.on('error', (err) => log.error(`HTTP server error: ${err.message}`));
    return server;
}

function sendHealth(res, service) {
    const snapshot = service.getSnapshot();
    // "Waiting for a QR scan" is unhealthy for a human but perfectly healthy for
    // the watchdog — restarting would only throw away the code being scanned.
    sendJson(res, snapshot.healthy ? 200 : 503, {
        status: snapshot.status,
        healthy: snapshot.healthy,
        lastHealthyAt: snapshot.lastHealthyAt,
        restarts: snapshot.restarts,
        lastError: snapshot.lastError,
    });
}

function sendJson(res, status, body) {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(payload);
}

function sendHtml(res, html) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .badge { display:inline-block; padding:2px 10px; border-radius:999px; color:#fff; font-size:13px; }
  .card { border:1px solid rgba(127,127,127,.35); border-radius:12px; padding:16px; margin:16px 0; max-width:720px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:4px 16px; margin:0; }
  dt { opacity:.65; } dd { margin:0; }
  button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid rgba(127,127,127,.5); background:transparent; cursor:pointer; }
  button.danger { color:#d93025; border-color:#d93025; }
  ul { margin:0; padding-left:18px; } li { font-variant-numeric:tabular-nums; }
  table { border-collapse:collapse; width:100%; }
  th, td { text-align:left; padding:4px 12px 4px 0; vertical-align:top; border-bottom:1px solid rgba(127,127,127,.2); }
  th { opacity:.65; font-weight:normal; }
  code { background:rgba(127,127,127,.15); padding:1px 5px; border-radius:4px; }
  img { max-width:100%; }
`;

function page(title, body, script = '') {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style></head><body>
${body}
${script}
</body></html>`;
}

const STATUS_COLOR = {
    ready: '#2e9e4f',
    qr: '#d98324',
    authenticated: '#2e9e4f',
    starting: '#6b7280',
    reconnecting: '#d93025',
    stopped: '#6b7280',
};

async function renderGroups(service) {
    const client = service.client;
    let body;

    if (service.status !== 'ready' || !client) {
        body = `<p>WhatsApp is <strong>${service.status}</strong>. Group ids appear once the bot is connected.</p>`;
    } else {
        try {
            const groups = await listGroups(client);
            body = groups.length === 0
                ? '<p>This account is not in any groups.</p>'
                : `<table><tr><th>Group</th><th>Chat id</th></tr>${groups
                    .map((g) => `<tr><td>${escapeHtml(g.name)}</td><td><code>${escapeHtml(g.id)}</code></td></tr>`)
                    .join('')}</table>`;
        } catch (err) {
            body = `<p>Could not list the groups: ${escapeHtml(err.message)}</p>`;
        }
    }

    return page('Groups', `
      <h1>Groups</h1>
      <p>Use either the name or the id as the <code>chat</code> in the add-on configuration.</p>
      <div class="card">${body}</div>
      <p><a href="./">← back</a></p>`);
}

async function renderPanel(service, registry, jobs) {
    const s = service.getSnapshot();
    const qrImage = s.qr ? await QRCode.toDataURL(s.qr, { margin: 1, width: 320 }) : null;

    return page('WhatsApp Bot', `
<h1>WhatsApp Bot</h1>
<span class="badge" style="background:${STATUS_COLOR[s.status] || '#6b7280'}">${s.status}</span>

${qrImage ? `<div class="card"><strong>Scan to link this device</strong>
  <p>WhatsApp → Settings → Linked devices → Link a device.</p>
  <img src="${qrImage}" alt="QR code" width="320" height="320">
  <p><small>This code refreshes automatically; reload if it expires.</small></p></div>` : ''}

<div class="card"><dl>
  <dt>Account</dt><dd>${escapeHtml(s.connectedAs?.pushname || '—')}</dd>
  <dt>Connected since</dt><dd>${s.readyAt ? new Date(s.readyAt).toLocaleString() : '—'}</dd>
  <dt>Last healthy</dt><dd>${s.lastHealthyAt ? new Date(s.lastHealthyAt).toLocaleString() : '—'}</dd>
  <dt>Reconnects</dt><dd>${s.restarts}</dd>
  <dt>Last error</dt><dd>${escapeHtml(s.lastError || '—')}</dd>
</dl></div>

<div class="card"><strong>Commands</strong><ul>
${registry.list().map((c) => `<li><code>${registry.prefix}${escapeHtml(c.name)}</code> — ${escapeHtml(c.description || '')}</li>`).join('')}
</ul></div>

<div class="card"><strong>Recent events</strong><ul>
${s.events.map((e) => `<li>${e.at.slice(11, 19)} — ${escapeHtml(e.message)}</li>`).join('') || '<li>—</li>'}
</ul></div>

${renderJobs(jobs)}

<div class="card"><strong>Groups</strong>
  <p><a href="groups">Look up a group's chat id →</a></p></div>

<div class="card">
  <button onclick="post('api/restart', this)">Reconnect</button>
  <button class="danger" data-armed="0" onclick="unlink(this)">Unlink device</button>
  <p><small>Unlinking deletes the stored pairing and asks for a new QR scan.</small></p>
</div>

`, `<script>
  async function post(path, button) {
    button.disabled = true;
    await fetch(path, { method: 'POST' });
    setTimeout(() => location.reload(), 1500);
  }
  function unlink(button) {
    if (button.dataset.armed === '0') {
      button.dataset.armed = '1';
      button.textContent = 'Click again to confirm';
      setTimeout(() => { button.dataset.armed = '0'; button.textContent = 'Unlink device'; }, 5000);
      return;
    }
    post('api/reset-session', button);
  }
  setTimeout(() => location.reload(), 15000);
</script>`);
}

function renderJobs(jobs) {
    const all = jobs?.getStatus() || [];
    if (all.length === 0) return '';

    const rows = all.map((job) => {
        const state = job.lastError
            ? `<span style="color:#d93025">failing</span>`
            : job.enabled ? 'enabled' : 'disabled';
        const detail = job.lastError
            ? escapeHtml(job.lastError)
            : job.lastRun
                ? `last run ${new Date(job.lastRun).toLocaleTimeString()} — ${escapeHtml(JSON.stringify(job.lastResult))}`
                : 'not run yet';
        return `<tr><td><code>${escapeHtml(job.name)}</code></td><td>${state}</td><td>${detail}</td></tr>`;
    }).join('');

    return `<div class="card"><strong>Background jobs</strong>
      <table><tr><th>Job</th><th>State</th><th>Detail</th></tr>${rows}</table></div>`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ));
}

module.exports = { createHealthServer };
