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
  // Add page-enter class for the initial load animation then run layout apply
  document.body.classList.add('page-enter');
  apply();

  // Theme toggle injected into .top-nav; persists in localStorage
  document.addEventListener('DOMContentLoaded', () => {
    // Remove the enter class to play the load animation
    window.requestAnimationFrame(() => setTimeout(() => document.body.classList.remove('page-enter'), 20));

    // If a page opts out of theme toggling (data-disable-theme="true"), enforce light mode and skip injection
    if (document.body && document.body.getAttribute('data-disable-theme') === 'true') {
      // ensure global dark class is removed and industrial pages use light vars
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('industrial-dark');
      document.body.classList.add('industrial-light');
      localStorage.setItem('theme','light');
      return;
    }
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

    // Intercept internal navigation to play a subtle exit animation before navigating
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest && ev.target.closest('a');
      if (!a) return;
      if (a.target === '_blank') return; // let new tab/open external links
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
      // only handle same-origin or relative links
      try {
        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return;
      } catch (e) { return; }

      // allow opt-out via attribute
      if (a.hasAttribute('data-no-page-transition')) return;

      ev.preventDefault();
      document.body.classList.add('page-exit');
      // wait for the exit animation then navigate
      setTimeout(() => { location.href = href; }, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--page-transition-duration')) || 340);
    });
  });

})();