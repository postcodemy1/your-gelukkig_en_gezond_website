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
      // return structured error so callers can show friendly messages
      return parsed && parsed.error ? parsed : { error: parsed || res.statusText || ('HTTP ' + res.status) };
    }
    return parsed;
  } catch (e) {
    return { error: 'Netwerkfout: ' + (e.message || e) };
  }
}

function setSessionIndicator() {
  const el = document.getElementById('session-indicator');
  if (!el) return;
  api('/api/me').then(data => {
    if (data && !data.error) {
      // logged in
      el.innerHTML = `Ingelogd als <strong>${escapeHtml(data.name)}</strong>` +
        ` <button id="logout-btn" style="margin-left:0.6rem; padding:0.3rem 0.6rem; border-radius:8px;">Uitloggen</button>`;
      const btn = document.getElementById('logout-btn');
      btn.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); localStorage.removeItem('authToken'); setSessionIndicator(); window.location.href = 'index.html'; });
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
        if (data.role === 'admin') inner += `<a class="nav-btn" href="admin.html">Adminpaneel</a> `;
        if (data.role === 'worker') inner += `<a class="nav-btn" href="worker.html">Werkruimte</a> `;
        if (data.role === 'client') inner += `<a class="nav-btn" href="appointments.html">Mijn afspraken</a> <a class="nav-btn" href="webshop.html">Webshop</a> `;
        a.innerHTML = inner;
        wrap.insertBefore(a, wrap.firstChild);
      }
    } else {
      el.innerHTML = `<a href="login.html" id="login-link">Inloggen / Registreren</a>`;
      document.body.classList.remove('client', 'industrial');
      const q = document.getElementById('quick-links'); if (q) q.remove();
    }
  }).catch(() => { el.innerHTML = `<a href="login.html">Inloggen / Registreren</a>`; });
}

document.addEventListener('DOMContentLoaded', () => {
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
        if (resp.user && resp.user.role === 'admin') window.location.href = 'admin.html';
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
