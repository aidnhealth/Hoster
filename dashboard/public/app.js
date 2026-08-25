const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(route, opts = {}) {
  const res = await fetch(route, { headers: { 'content-type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 9000 : 4500);
}

/* ---------------- state ---------------- */
// Which drawers the user has opened, so a background refresh can restore them
// instead of collapsing whatever they were reading.
const openLogs = new Set();
const openSettings = new Set();
let apps = [];
let busy = false;

/* ---------------- rendering ---------------- */
function routeRow(lbl, url, note, cls = '') {
  if (!url) return '';
  return `<div class="route ${cls}"><span class="lbl">${lbl}</span>
    <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
    ${note ? `<span class="note">${esc(note)}</span>` : ''}</div>`;
}

function cardHtml(a) {
  const settings = openSettings.has(a.slug) ? `
    <div class="drawer">
      <h4>Build settings — stored in Hoster, never written to your project</h4>
      <div class="row2">
        <div class="field">
          <label for="bc-${a.slug}">Build command</label>
          <input id="bc-${a.slug}" data-cfg="build_cmd" data-slug="${a.slug}"
                 value="${esc(a.build_cmd || '')}" placeholder="detected automatically">
          <span class="help">e.g. <code>npx vite build --mode prod</code></span>
        </div>
        <div class="field">
          <label for="od-${a.slug}">Output directory</label>
          <input id="od-${a.slug}" data-cfg="out_dir" data-slug="${a.slug}"
                 value="${esc(a.out_dir || '')}" placeholder="dist">
          <span class="help">Relative to the project root.</span>
        </div>
      </div>
      <div class="field">
        <label for="env-${a.slug}">Environment variables</label>
        <textarea id="env-${a.slug}" data-cfg="env" data-slug="${a.slug}"
          placeholder="KEY=value, one per line">${esc(envToText(a.env_json))}</textarea>
        <span class="help">Injected at build and run time. Stored locally, never committed.</span>
      </div>
      <button class="btn primary sm" data-act="save" data-slug="${a.slug}">Save settings</button>
    </div>` : '';

  const logs = openLogs.has(a.slug)
    ? `<div class="drawer"><h4>Logs</h4><pre class="logs" id="log-${a.slug}">loading…</pre></div>`
    : '';

  return `<div class="card">
    <div class="card-head">
      <span class="dot ${a.status}"></span>
      <span class="name-h">${esc(a.slug)}</span>
      ${a.kind ? `<span class="kind">${esc(a.kind)}</span>` : ''}
      <span class="status-txt">${esc(a.status)}</span>
      ${a.status === 'crashed'
        ? '<span class="status-txt" style="color:var(--err)">container keeps restarting — open Logs</span>'
        : ''}
    </div>
    <div class="routes">
      ${routeRow('this mac', a.local_url)}
      ${routeRow('your network', a.lan_url, 'any device on this Wi-Fi, no internet')}
      ${routeRow('internet', a.tunnel_url, '', 'public')}
      ${a.db_name ? `<div class="route"><span class="lbl">database</span><span class="val">${esc(a.db_name)}</span></div>` : ''}
      <div class="route"><span class="lbl">source</span><span class="val">${esc(a.source_path)}</span></div>
    </div>
    <div class="actions">
      <button class="btn" data-act="redeploy" data-slug="${a.slug}">Redeploy</button>
      <button class="btn" data-act="${a.status === 'live' ? 'stop' : 'start'}" data-slug="${a.slug}">
        ${a.status === 'live' ? 'Stop' : 'Start'}</button>
      <button class="btn" data-act="${a.tunnel_url ? 'unshare' : 'share'}" data-slug="${a.slug}">
        ${a.tunnel_url ? 'Unshare' : 'Share publicly'}</button>
      <button class="btn" data-act="logs" data-slug="${a.slug}">Logs</button>
      <button class="btn" data-act="settings" data-slug="${a.slug}">Settings</button>
      <div class="spacer"></div>
      <button class="btn danger" data-act="rm" data-slug="${a.slug}">Delete</button>
    </div>
    ${settings}${logs}
  </div>`;
}

const envToText = (json) => Object.entries(JSON.parse(json || '{}'))
  .map(([k, v]) => `${k}=${v}`).join('\n');

const textToEnv = (text) => Object.fromEntries(
  text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    .filter(([k]) => k),
);

function render() {
  $('#apps').innerHTML = apps.length
    ? apps.map(cardHtml).join('')
    : `<div class="empty"><h3>No apps yet</h3>
        <p>Choose a project folder above and deploy it. Hoster works out what it is.</p></div>`;
  openLogs.forEach(loadLogs);
}

async function loadLogs(slug) {
  const pre = $(`#log-${CSS.escape(slug)}`);
  if (!pre) return;
  try { pre.textContent = (await api(`/api/apps/${slug}/logs`)).logs || '(no output yet)'; }
  catch (e) { pre.textContent = `could not load logs: ${e.message}`; }
}

async function refresh() {
  try {
    apps = await api('/api/apps');
    render();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------- actions ---------------- */
$('#apps').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, slug } = btn.dataset;

  if (act === 'logs' || act === 'settings') {
    const set = act === 'logs' ? openLogs : openSettings;
    set.has(slug) ? set.delete(slug) : set.add(slug);
    render();
    return;
  }

  if (act === 'save') {
    const get = (k) => $(`[data-cfg="${k}"][data-slug="${slug}"]`)?.value ?? '';
    try {
      await api(`/api/apps/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify({
          build_cmd: get('build_cmd') || null,
          out_dir: get('out_dir') || null,
          env_json: JSON.stringify(textToEnv(get('env'))),
        }),
      });
      toast('Settings saved. Redeploy to apply them.', 'ok');
      await refresh();
    } catch (err) { toast(err.message, 'err'); }
    return;
  }

  if (act === 'rm' && !confirm(`Delete ${slug}, its container and its database?\n\nThis cannot be undone. Your source folder is not touched.`)) return;
  if (act === 'rm') { openLogs.delete(slug); openSettings.delete(slug); }

  const label = btn.textContent.trim();
  const progress = {
    redeploy: 'Building…',
    share: 'Checking app, then opening tunnel…',
    stop: 'Stopping…', start: 'Starting…', unshare: 'Closing…', rm: 'Deleting…',
  }[act];
  if (progress) btn.textContent = progress;
  btn.disabled = true;
  busy = true;

  const routes = {
    redeploy: ['POST', `/api/apps/${slug}/deploy`, '{}'],
    stop: ['POST', `/api/apps/${slug}/stop`],
    start: ['POST', `/api/apps/${slug}/start`],
    share: ['POST', `/api/apps/${slug}/public`, JSON.stringify({ enabled: true })],
    unshare: ['POST', `/api/apps/${slug}/public`, JSON.stringify({ enabled: false })],
    rm: ['DELETE', `/api/apps/${slug}`],
  };

  try {
    const [method, route, body] = routes[act];
    const out = await api(route, { method, body });
    if (act === 'share' && out.url) showShare(out.url);
    if (act === 'redeploy') toast(`${slug} redeployed`, 'ok');
    if (act === 'rm') toast(`${slug} removed`, 'ok');
  } catch (err) {
    toast(`${slug}: ${err.message}`, 'err');
    if (act === 'redeploy') { openLogs.add(slug); }
  } finally {
    btn.textContent = label;
    btn.disabled = false;
    busy = false;
    refresh();
  }
});

/* ---------------- deploy ---------------- */
$('#deployForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const src = f.path.value.trim();
  const slug = (f.slug.value.trim() || src.split('/').filter(Boolean).pop() || '')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!slug) return toast('Could not work out a name for this app', 'err');

  const b = $('#deployBtn');
  b.disabled = true; b.textContent = 'Building…'; busy = true;
  try {
    await api(`/api/apps/${slug}/deploy`, {
      method: 'POST', body: JSON.stringify({ sourcePath: src }),
    });
    toast(`${slug} deployed`, 'ok');
    f.reset();
  } catch (err) {
    toast(`${slug}: ${err.message}`, 'err');
    openLogs.add(slug); // show them why it failed
  } finally {
    b.disabled = false; b.textContent = 'Deploy'; busy = false;
    refresh();
  }
});

/* ---------------- folder picker ---------------- */
const picker = $('#pickerModal');
let cwd = null;

async function browse(path) {
  try {
    const d = await api(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`);
    cwd = d.path;
    $('#crumbs').textContent = d.path;
    $('#pickUp').disabled = !d.parent;
    $('#list').innerHTML = d.entries.length
      ? d.entries.map((e) => `<div class="item" tabindex="0" data-path="${esc(e.path)}">
          <span class="ico">▸</span><span>${esc(e.name)}</span>
          ${e.project ? '<span class="tag2">project</span>' : ''}</div>`).join('')
      : '<div class="item" style="cursor:default;color:var(--dim)">No sub-folders here</div>';
  } catch (e) { toast(e.message, 'err'); }
}

$('#browseBtn').addEventListener('click', () => {
  picker.showModal();
  browse($('[name=path]').value.trim() || null);
});
$('#list').addEventListener('click', (e) => {
  const item = e.target.closest('.item[data-path]');
  if (item) browse(item.dataset.path);
});
$('#list').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.path) browse(e.target.dataset.path);
});
$('#pickUp').addEventListener('click', async () => {
  const d = await api(`/api/browse?path=${encodeURIComponent(cwd)}`);
  if (d.parent) browse(d.parent);
});
$('#pickHere').addEventListener('click', () => {
  $('[name=path]').value = cwd;
  picker.close();
});
$('#pickCancel').addEventListener('click', () => picker.close());
picker.addEventListener('click', (e) => { if (e.target === picker) picker.close(); });

/* ---------------- share modal ---------------- */
const modal = $('#shareModal');
function showShare(url) {
  $('#shareUrl').textContent = url;
  $('#shareUrl').href = url;
  $('#copyBtn').textContent = 'Copy';
  modal.showModal();
  $('#closeBtn').focus();
}
$('#closeBtn').addEventListener('click', () => modal.close());
$('#openBtn').addEventListener('click', () => window.open($('#shareUrl').href, '_blank'));
$('#copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#shareUrl').textContent);
    $('#copyBtn').textContent = 'Copied';
  } catch {
    const r = document.createRange();
    r.selectNodeContents($('#shareUrl'));
    getSelection().removeAllRanges(); getSelection().addRange(r);
    $('#copyBtn').textContent = 'Press Cmd-C';
  }
});
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

/* ---------------- boot ---------------- */
$('#refreshBtn').addEventListener('click', refresh);

api('/api/info').then((i) => {
  $('#netinfo').innerHTML = `<span>*.${esc(i.domain)}</span>` +
    (i.lan ? `<span>·</span><span>this network <b>${esc(i.lan)}</b></span>` : '');
}).catch(() => {});

refresh();
setInterval(() => {
  // Never re-render under an open dialog, a focused field, or a running action.
  if (busy || modal.open || picker.open) return;
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  refresh();
}, 5000);
