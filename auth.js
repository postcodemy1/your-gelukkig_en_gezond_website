// auth helpers (NL)
const API_BASE = window.API_BASE || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:3000' : '');

async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  const token = localStorage.getItem('authToken');
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const url = (path.startsWith('http') ? path : (API_BASE + path));
  try {
    const res = await fetch(url, opts);
    const txt = await res.text();
    let parsed;
    try { parsed = JSON.parse(txt); } catch(e) { parsed = txt; }
    if (!res.ok) {
      // If session expired or unauthorized, remove token and send user to home/menu before login
      if (res.status === 401) {
        try { localStorage.removeItem('authToken'); } catch(e) {}
        if (!/login\.html$/.test(location.pathname)) {
          window.location.replace('index.html');
        }
      }
      // return structured error so callers can show friendly messages
      return parsed && parsed.error ? parsed : { error: parsed || res.statusText || ('HTTP ' + res.status) };
    }
    return parsed;
  } catch (e) {
    return { error: 'Netwerkfout: ' + (e.message || e) };
  }
}

function showHandshakeErrorOverlay(status, message) {
  if (document.getElementById('global-handshake-error')) return;
  const el = document.createElement('div');
  el.id = 'global-handshake-error';
  el.style = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);color:#fff;z-index:99999;padding:1rem;';
  const title = status ? String(status) : '';
  const bodyMsg = message || (status === 404 ? "404 — The site couldn't be found." : 'Website is under maintenance, sorry for the inconvenience.');
  el.innerHTML = `<div style="text-align:center;max-width:900px;padding:2rem;border-radius:8px;background:rgba(17,17,17,0.95)">
      <div style="font-size:4rem;font-weight:700;margin-bottom:0.5rem">${escapeHtml(title)}</div>
      <div style="font-size:1.25rem;">${escapeHtml(bodyMsg)}</div>
    </div>`;
  document.body.appendChild(el);
}

function setSessionIndicator() {
  const el = document.getElementById('session-indicator');
  if (!el) return;
  showGlobalLoadingOverlay();
  (async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        hideGlobalLoadingOverlay();
        el.innerHTML = `<a href="login.html" id="login-link">Inloggen / Registreren</a>`;
        document.body.classList.remove('client', 'industrial');
        const q = document.getElementById('quick-links'); if (q) q.remove();
        return;
      }
      const API_BASE = window.API_BASE || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:3000' : '');
      const res = await fetch((API_BASE || '') + '/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok || !data || data.error) {
        hideGlobalLoadingOverlay();
        const msg = (data && data.error) ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : (res.statusText || 'Handshake failed');
        console.warn('[HANDSHAKE] failed', { status: res.status, message: msg });
        // Special handling for not-logged-in: send user back to the site home/menu
        if (res.status === 401) {
          try { localStorage.removeItem('authToken'); } catch(e) {}
          // If already on the login page, just show the normal login UI; otherwise redirect to home
          if (!/login\.html$/.test(location.pathname)) {
            // navigate to home menu before showing the login screen
            window.location.replace('index.html');
            return;
          }
          // if on login page, simply restore login link and return
          el.innerHTML = `<a href="login.html" id="login-link">Inloggen / Registreren</a>`;
          document.body.classList.remove('client', 'industrial');
          const q = document.getElementById('quick-links'); if (q) q.remove();
          return;
        }

        let displayMsg = '';
        if (res.status === 404) displayMsg = "404 — The site couldn't be found.";
        else if (res.status === 403) displayMsg = "403 — Permission denied.";
        else if (res.status >= 500 && res.status < 600) displayMsg = `${res.status} — Server error. Website is under maintenance, sorry for the inconvenience.`;
        else displayMsg = 'Website is under maintenance, sorry for the inconvenience.';
        showHandshakeErrorOverlay(res.status, displayMsg);
        return;
      }

      hideGlobalLoadingOverlay();
      // logged in
      el.innerHTML = `Ingelogd als <strong>${escapeHtml(data.name)}</strong>` +
        ` <button id="logout-btn" style="margin-left:0.6rem; padding:0.3rem 0.6rem; border-radius:8px;">Uitloggen</button>`;
      const btn = document.getElementById('logout-btn');
      btn.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); localStorage.removeItem('authToken'); setSessionIndicator(); window.location.href = 'login.html'; });
      // add role-specific links and theme
      document.body.classList.remove('client', 'industrial');
      if (data.role === 'admin' || data.role === 'worker') {
        document.body.classList.add('industrial');
      } else {
        document.body.classList.add('client');
      }
      // add quick links
      const wrap = document.querySelector('.wrap');
      if (wrap && !document.getElementById('quick-links')) {
        const a = document.createElement('div');
        a.id = 'quick-links';
        a.style.marginTop = '0.5rem';
        let inner = '';
        if (data.role === 'admin') inner += `<a class="nav-btn" href="ruang-admin/index.html">Adminpaneel</a> `;
        if (data.role === 'worker') inner += `<a class="nav-btn" href="worker.html">Werkruimte</a> `;
        if (data.role === 'client') inner += `<a class="nav-btn" href="appointments.html">Mijn afspraken</a> <a class="nav-btn" href="webshop.html">Webshop</a> `;
        a.innerHTML = inner;
        wrap.insertBefore(a, wrap.firstChild);
      }
    } catch (e) {
      hideGlobalLoadingOverlay();
      console.error('[HANDSHAKE] network error', e && e.message ? e.message : e);
      showHandshakeErrorOverlay(0, 'Network error while contacting the API. Website is under maintenance, sorry for the inconvenience.');
    }
  })();
}

document.addEventListener('DOMContentLoaded', async () => {
  // Perform network handshake before showing the site
  const handshakeOk = await performHandshake();
  if (!handshakeOk) return; // handshake overlays will block UI and show error
  setSessionIndicator();

  // If on login page, wire up forms
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const submit = loginForm.querySelector('button[type="submit"]');
      const oldText = submit ? submit.textContent : null;
      if (submit) { submit.disabled = true; submit.textContent = 'Even...'; }
      showMessage('login-msg', 'Bezig met inloggen...');
      const form = new FormData(loginForm);
      const body = { email: form.get('email'), password: form.get('password') };
      const resp = await api('/api/login', { method: 'POST', body });
      console.log('[AUTH] login response', resp);
      if (resp && resp.token) {
        localStorage.setItem('authToken', resp.token);
        if (submit) { submit.disabled = false; submit.textContent = oldText; }
        // redirect based on role
        if (resp.user && resp.user.role === 'admin') window.location.href = 'ruang-admin/index.html';
        else if (resp.user && resp.user.role === 'worker') window.location.href = 'worker.html';
        else window.location.href = 'index.html';
      } else {
        if (submit) { submit.disabled = false; submit.textContent = oldText; }
        showMessage('login-msg', resp && resp.error ? (typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error)) : 'Inloggen mislukt');
      }
    });
  }
  if (regForm) {
    regForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const submit = regForm.querySelector('button[type="submit"]');
      const oldText = submit ? submit.textContent : null;
      if (submit) { submit.disabled = true; submit.textContent = 'Even...'; }
      showMessage('register-msg', 'Bezig met registreren...');
      const form = new FormData(regForm);
      const body = { name: form.get('name'), email: form.get('email'), password: form.get('password'), role: form.get('role') };
      const resp = await api('/api/register', { method: 'POST', body });
      console.log('[AUTH] register response', resp);
      if (resp && resp.id) {
        if (submit) { submit.disabled = false; submit.textContent = oldText; }
        showMessage('register-msg', 'Registratie gelukt. Je kunt nu inloggen.');
        // show login form and prefill email
        document.getElementById('register-form').style.display = 'none';
        const lf = document.querySelector('.login-form'); if (lf) lf.style.display = 'block';
        const emailField = document.getElementById('email'); if (emailField) emailField.value = form.get('email');
      } else {
        if (submit) { submit.disabled = false; submit.textContent = oldText; }
        showMessage('register-msg', resp && resp.error ? (typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error)) : 'Registratie mislukt');
      }
    });
  }
});

function showMessage(id, text) {
  const el = document.getElementById(id); if (el) el.textContent = text;
}

function escapeHtml(s) { return String(s).replace(/[&"'<>]/g, c => ({'&':'&amp;','"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;'}[c])); }

function showGlobalLoadingOverlay() {
  if (document.getElementById('global-handshake-overlay')) return;
  const d = document.createElement('div'); d.id = 'global-handshake-overlay';
  d.style = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:99998;';
  d.innerHTML = `<div style="text-align:center;color:#fff;padding:1rem;background:rgba(17,17,17,0.9);border-radius:8px;min-width:220px;">
    <div style="font-weight:600;margin-bottom:0.5rem">Even controleren…</div>
    <div style="width:32px;height:32px;border:4px solid rgba(255,255,255,0.15);border-top-color:#fff;border-radius:50%;margin:0 auto;animation:spin 1s linear infinite"></div>
  </div>`;
  const style = document.createElement('style'); style.id='global-handshake-overlay-style'; style.innerHTML='@keyframes spin{to{transform:rotate(360deg)}}'; document.head.appendChild(style);
  document.body.appendChild(d);
}
function hideGlobalLoadingOverlay() { const e = document.getElementById('global-handshake-overlay'); if (e) e.remove(); const s=document.getElementById('global-handshake-overlay-style'); if (s) s.remove(); }

// Perform handshake packet exchange with server
async function tryHandshakeWithBase(base) {
  try {
    console.log('[HANDSHAKE] trying base', base || '(relative)');
    const res = await fetch((base || '') + '/api/handshake', { mode: 'cors' });
    if (!res.ok) {
      console.warn('[HANDSHAKE] server packet request failed for', base, res.status);
      return { ok: false, status: res.status };
    }
    const serverPacket = await res.json();
    console.log('[HANDSHAKE] received server packet', serverPacket);
    const clientPacket = {
      echoNonce: serverPacket.nonce,
      serverVersion: serverPacket.serverVersion,
      clientTimestamp: Date.now(),
      browser: navigator.userAgent || '',
      platform: navigator.platform || '',
      language: navigator.language || '',
      vendor: navigator.vendor || ''
    };
    console.log('[HANDSHAKE] sending client packet to', base, { echoNonce: clientPacket.echoNonce, browser: clientPacket.browser });
    const confirmRes = await fetch((base || '') + '/api/handshake/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clientPacket), mode: 'cors' });
    if (!confirmRes.ok) {
      const txt = await confirmRes.text().catch(()=>'(no body)');
      console.warn('[HANDSHAKE] confirm failed for', base, confirmRes.status, txt);
      return { ok: false, status: confirmRes.status };
    }
    const conf = await confirmRes.json();
    console.log('[HANDSHAKE] confirm response', conf);
    return { ok: true, serverPacket };
  } catch (e) {
    console.warn('[HANDSHAKE] network error for base', base, e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : e };
  }
}

async function performHandshake() {
  showGlobalLoadingOverlay();
  const candidates = [];
  if (window.API_BASE) candidates.push(window.API_BASE.replace(/\/$/, ''));
  // try relative first (same origin)
  candidates.push('');
  // try current host with common dev ports
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    candidates.push(`${location.protocol}//${location.hostname}:3000`);
    candidates.push(`${location.protocol}//${location.hostname}:3001`);
  }
  // also try http://localhost:3000 and 3001 explicitly (covers when served from 127.0.0.1:5500)
  candidates.push('http://localhost:3000');
  candidates.push('http://localhost:3001');

  for (const base of candidates) {
    const r = await tryHandshakeWithBase(base);
    if (r.ok) {
      hideGlobalLoadingOverlay();
      window.HANDSHAKE_OK = true;
      try { window.dispatchEvent(new CustomEvent('handshake:success', { detail: r.serverPacket })); } catch(e) {}
      console.log('[HANDSHAKE] completed successfully with base', base || '(relative)');
      return true;
    }
    // small delay so logs appear paced
    await new Promise(res => setTimeout(res, 150));
  }

  hideGlobalLoadingOverlay();
  window.HANDSHAKE_OK = false;
  try { window.dispatchEvent(new CustomEvent('handshake:failed', { detail: { error: 'all attempts failed' } })); } catch(e) {}
  showHandshakeErrorOverlay(0, 'Unable to contact API server. Website is under maintenance, sorry for the inconvenience.');
  return false;
}

// Theme handling (light/dark) — persists in localStorage
function applyTheme(theme) {
  document.body.classList.remove('light-theme','dark-theme');
  document.body.classList.add(theme + '-theme');
  localStorage.setItem('theme', theme);
  const btn = document.getElementById('theme-toggle'); if (btn) btn.setAttribute('aria-pressed', theme === 'light');
}

function initTheme() {
  const stored = localStorage.getItem('theme');
  if (stored) { applyTheme(stored); return; }
  // prefer system if not set
  const preferDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(preferDark ? 'dark' : 'light');
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const tbtn = document.getElementById('theme-toggle');
  if (tbtn) {
    tbtn.addEventListener('click', (ev) => {
      const isLight = document.body.classList.contains('light-theme');
      applyTheme(isLight ? 'dark' : 'light');
    });
  }
});
