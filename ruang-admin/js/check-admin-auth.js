// Check that the current user is authenticated as admin/worker
// If not, show a clear error (handshake) message and then redirect to login
(async function(){
  function escapeHtml(s) { return String(s).replace(/[&"'<>]/g, c => ({'&':'&amp;','"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;'}[c])); }
  function showHandshakeError(status, msg) {
    const existing = document.getElementById('handshake-error'); if (existing) return;
    const div = document.createElement('div');
    div.id = 'handshake-error';
    div.style = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);color:#fff;z-index:99999;padding:1rem;font-size:1.05rem;';
    const redirectNote = (status === 401) ? 'You will be redirected to the home menu.' : 'You will be redirected to the login page shortly.';
    const inner = `<div style="max-width:720px;background:#111;padding:1.5rem;border-radius:8px;line-height:1.35;">
      <strong>Handshake error (${status})</strong>
      <p style="margin-top:0.5rem">${escapeHtml(msg)}</p>
      <p style="margin-top:0.5rem;color:#ddd">${redirectNote}</p>
    </div>`;
    div.innerHTML = inner;
    document.body.appendChild(div);
    const target = (status === 401) ? '../index.html' : '../login.html';
    setTimeout(() => { localStorage.removeItem('authToken'); window.location.replace(target); }, 4000);
  }

  function showLoadingOverlay() {
    if (document.getElementById('admin-handshake-loading')) return;
    const d = document.createElement('div'); d.id = 'admin-handshake-loading';
    d.style = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);color:#fff;z-index:99998;';
    d.innerHTML = `<div style="text-align:center;padding:1rem;background:#111;border-radius:8px;min-width:240px;">
      <div style="font-size:1.1rem;font-weight:600;margin-bottom:0.5rem;">Checking authentication…</div>
      <div style="width:36px;height:36px;border:4px solid rgba(255,255,255,0.15);border-top-color:#fff;border-radius:50%;margin:0 auto;animation:spin 1s linear infinite"></div>
    </div>`;
    const style = document.createElement('style'); style.id='admin-handshake-loading-style'; style.innerHTML='@keyframes spin{to{transform:rotate(360deg)}}'; document.head.appendChild(style);
    document.body.appendChild(d);
  }
  function hideLoadingOverlay() { const e = document.getElementById('admin-handshake-loading'); if (e) e.remove(); const s=document.getElementById('admin-handshake-loading-style'); if(s) s.remove(); }

  try {
    showLoadingOverlay();
    // perform server handshake first; try a few candidate bases (same logic as main site)
    const token = localStorage.getItem('authToken');
    if (!token) { hideLoadingOverlay(); window.location.replace('../index.html'); return; }
    const candidates = [];
    if (window.API_BASE) candidates.push(window.API_BASE.replace(/\/$/, ''));
    candidates.push('');
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      candidates.push(`${location.protocol}//${location.hostname}:3000`);
      candidates.push(`${location.protocol}//${location.hostname}:3001`);
    }
    candidates.push('http://localhost:3000'); candidates.push('http://localhost:3001');

    let serverPacket = null; let usedBase = null;
    for (const base of candidates) {
      try {
        console.log('[ADMIN HANDSHAKE] trying base', base || '(relative)');
        const hsRes = await fetch((base || '') + '/api/handshake', { mode: 'cors' });
        if (!hsRes.ok) { console.warn('[ADMIN HANDSHAKE] server packet failed for', base, hsRes.status); continue; }
        serverPacket = await hsRes.json(); usedBase = base; break;
      } catch (e) { console.warn('[ADMIN HANDSHAKE] network error for base', base, e && e.message ? e.message : e); }
      await new Promise(r => setTimeout(r, 150));
    }

    if (!serverPacket) { hideLoadingOverlay(); showHandshakeError(0, 'Server handshake failed (all attempts)'); return; }
    console.log('[ADMIN HANDSHAKE] server packet received', serverPacket, 'base', usedBase);
    const clientPacket = { echoNonce: serverPacket.nonce, browser: navigator.userAgent || '', platform: navigator.platform || '', language: navigator.language || '' };
    const confirmRes = await fetch((usedBase || '') + '/api/handshake/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(clientPacket), mode: 'cors' });
    if (!confirmRes.ok) { hideLoadingOverlay(); const txt = await confirmRes.text(); console.warn('[ADMIN HANDSHAKE] confirm failed', confirmRes.status, txt); showHandshakeError(confirmRes.status || 0, 'Server handshake confirm failed'); return; }

    // Include stored auth token when calling the API so the server recognizes the session
    const res = await fetch((usedBase || '') + '/api/me', { headers: { 'Authorization': 'Bearer ' + token } });    let data;
    try { data = await res.json(); } catch(e) { data = null; }
    if (!res.ok || !data || data.error || (data.role !== 'admin' && data.role !== 'worker')) {
      hideLoadingOverlay();
      const msg = (data && data.error) ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : (res.statusText || 'Handshake failed');
      console.warn('[ADMIN HANDSHAKE] failed', { status: res.status, message: msg });
      showHandshakeError(res.status || 0, msg);
      return;
    }
    hideLoadingOverlay();
    // expose admin handshake success and dispatch an event
    window.ADMIN_HANDSHAKE_OK = true;
    try { window.dispatchEvent(new CustomEvent('admin:handshake:success', { detail: data })); } catch(e) {}
    console.log('[ADMIN HANDSHAKE] successful', { user: data.name || data.email, role: data.role });
    // authorized — continue loading admin UI
  } catch (e) {
    hideLoadingOverlay();
    window.ADMIN_HANDSHAKE_OK = false;
    try { window.dispatchEvent(new CustomEvent('admin:handshake:failed', { detail: { error: e && e.message ? e.message : e } })); } catch(e) {}
    console.error('[ADMIN HANDSHAKE] network error', e && e.message ? e.message : e);
    showHandshakeError(0, 'Network error while contacting the API.');
  }
})();
