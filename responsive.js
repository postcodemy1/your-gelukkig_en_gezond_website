(function(){
  // Detect viewport & display resolution and add helpful classes to <html>
  function apply() {
    const isMobile = window.matchMedia('(max-width:720px)').matches;
    const isTablet = window.matchMedia('(max-width:920px)').matches && !isMobile;
    const highDpi = (window.devicePixelRatio || 1) > 1.5;

    document.documentElement.classList.toggle('mobile', isMobile);
    document.documentElement.classList.toggle('tablet', isTablet);
    document.documentElement.classList.toggle('high-dpi', highDpi);

    // expose values for debugging or CSS hooks
    document.documentElement.dataset.vw = window.innerWidth;
    document.documentElement.dataset.dpr = window.devicePixelRatio || 1;

    // adjust a site-wide scale variable used by CSS
    const scale = isMobile ? 0.96 : (isTablet ? 0.99 : 1);
    document.documentElement.style.setProperty('--site-scale', scale);
  }

  // media query listeners
  const mmMobile = window.matchMedia('(max-width:720px)');
  const mmDpi = window.matchMedia('(min-resolution: 1.5dppx)');

  if (mmMobile.addEventListener) mmMobile.addEventListener('change', apply); else mmMobile.addListener(apply);
  if (mmDpi.addEventListener) mmDpi.addEventListener('change', apply); else mmDpi.addListener(apply);

  // resize debounce
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(apply, 120);
  });
  window.addEventListener('orientationchange', apply);
  document.addEventListener('DOMContentLoaded', apply);

  // run now
  apply();

  // Theme toggle injected into .top-nav; persists in localStorage
  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('.top-nav');
    if (!nav) return;
    if (document.getElementById('theme-toggle')) return; // already injected

    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.className = 'theme-toggle';

    function setTheme(name) {
      document.documentElement.classList.toggle('dark', name === 'dark');
      btn.textContent = name === 'dark' ? '☀️ Light' : '🌙 Dark';
      btn.setAttribute('aria-pressed', name === 'dark');
      localStorage.setItem('theme', name);

      // Special handling for industrial pages: keep layout but switch color variables
      if (document.body.classList.contains('industrial')) {
        document.body.classList.toggle('industrial-light', name === 'light');
        document.body.classList.toggle('industrial-dark', name === 'dark');
      }
    }

    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial = saved || (prefersDark ? 'dark' : 'light');
    setTheme(initial);

    btn.addEventListener('click', () => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'));

    nav.appendChild(btn);
  });

})();