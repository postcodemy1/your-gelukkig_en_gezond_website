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
})();