// Check that the current user is authenticated as admin/worker
// If not, redirect to the site's standard login page
(async function(){
  try {
    // Include stored auth token when calling the API so the server recognizes the session
    const token = localStorage.getItem('authToken');
    if (!token) { window.location.replace('../login.html'); return; }
    const res = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); } catch(e) { data = txt; }
    if (!res.ok || !data || data.error || (data.role !== 'admin' && data.role !== 'worker')) {
      // token invalid or insufficient role — clear token and redirect to site login
      localStorage.removeItem('authToken');
      window.location.replace('../login.html');
    }
  } catch (e) {
    window.location.replace('../login.html');
  }
})();
