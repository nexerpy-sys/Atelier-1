import { afterPaint, load, whenIdle } from './loader.js';

export function createClock() {
  const scrollState = { y: window.scrollY, progress: 0, velocity: 0, direction: 0 };
  const listeners = new Set();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 800px)');
  const life = new AbortController();
  let gsap, ST, Lenis, smooth, choreography, raf = 0, last, dirty = true;
  let disposed = false;

  // 1px fixed Vermilion top scroll-progress hairline (compositor scaleX only).
  let rail = document.getElementById('ak-scroll-rail');
  let createdRail = false;
  if (!rail && document.body) {
    rail = document.createElement('div');
    rail.id = 'ak-scroll-rail';
    rail.className = 'ak-scroll-rail';
    rail.setAttribute('aria-hidden', 'true');
    document.body.prepend(rail);
    createdRail = true;
  }

  const nativeScroll = () => { dirty = true; };
  const reset = () => { last = undefined; dirty = true; scrollState.velocity = scrollState.direction = 0; };
  addEventListener('scroll', nativeScroll, { passive: true, signal: life.signal });
  addEventListener('resize', nativeScroll, { passive: true, signal: life.signal });
  document.addEventListener('visibilitychange', reset, { signal: life.signal });

  function updateRail(y) {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const p = Math.max(0, Math.min(1, y / max));
    scrollState.progress = p;
    if (rail) rail.style.transform = `scaleX(${p.toFixed(4)})`;
  }

  function render(ms) {
    const elapsed = last === undefined ? 0 : Math.max(0, ms - last);
    last = ms;
    if (document.hidden) return;
    if (smooth) { smooth.raf(ms); dirty = true; }
    const y = dirty ? window.scrollY : scrollState.y;
    const moved = dirty;
    dirty = false;
    const delta = y - scrollState.y;
    scrollState.y = y;
    scrollState.velocity = elapsed && elapsed < 250 ? delta * 1000 / elapsed : 0;
    scrollState.direction = Math.sign(scrollState.velocity);
    if (moved) updateRail(y);
    ST?.update();
    for (const fn of listeners) fn(Math.min(elapsed, 64) / 1000, scrollState, elapsed);
  }

  const native = ms => { raf = requestAnimationFrame(native); render(ms); };
  const master = seconds => render(seconds * 1000);
  const html = document.documentElement;

  function configure() {
    if (!gsap) return;
    choreography?.revert();
    smooth?.destroy();
    smooth = choreography = null;
    html.classList.remove('ak-smooth');
    reset();
    if (reduced.matches || !desktop.matches || !Lenis) {
      ST.refresh();
      return;
    }
    html.classList.add('ak-smooth');
    smooth = new Lenis({ autoRaf: false, lerp: 0.16, syncTouch: false });
    choreography = gsap.context(() => {
      const animate = (selector, trigger, start, end, from, to) => {
        const target = document.querySelector(selector);
        if (target && trigger) {
          gsap.fromTo(target, from, {
            ...to,
            ease: 'none',
            scrollTrigger: { trigger, start, end, scrub: true, invalidateOnRefresh: true }
          });
        }
      };
      const el = s => document.querySelector(s);
      animate('#hero-head-wrap', el('#top'), 'top top', '+=220', { y: 0 }, { y: -14 });
      animate('#marquee-shift', el('#editorial-marquee'), 'top bottom', 'bottom top', { x: 18 }, { x: -18 });
      animate('#pantheon', el('#pantheon'), 'top 94%', 'top 64%', { opacity: 0.88 }, { opacity: 1 });
      animate('#monolith-img', el('#pantheon'), 'top 90%', 'top 40%', { y: 10 }, { y: -10 });
    });
    ST.refresh();
  }

  function scrollTo(target, opts = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el && typeof target !== 'number') return;
    if (smooth && !reduced.matches) {
      smooth.scrollTo(el ?? target, { offset: opts.offset ?? 0, immediate: !!opts.immediate });
    } else if (typeof target === 'number') {
      window.scrollTo({ top: target, behavior: reduced.matches || opts.immediate ? 'auto' : 'smooth' });
    } else {
      el.scrollIntoView({ behavior: reduced.matches || opts.immediate ? 'auto' : 'smooth', block: opts.block ?? 'start' });
    }
    dirty = true;
  }

  reduced.addEventListener('change', configure, { signal: life.signal });
  desktop.addEventListener('change', configure, { signal: life.signal });
  updateRail(window.scrollY);
  raf = requestAnimationFrame(native);

  const ready = (async () => {
    await afterPaint();
    await whenIdle();
    if (disposed) return false;
    try {
      // Load ScrollTrigger (which loads GSAP) and Lenis in parallel.
      const [s, lenis] = await Promise.all([load('scrollTrigger'), load('lenis')]);
      const g = await load('gsap');
      if (disposed) return false;
      g.registerPlugin(s);
      gsap = g; ST = s; Lenis = lenis;
      configure();
      gsap.ticker.lagSmoothing(0);
      cancelAnimationFrame(raf);
      reset();
      gsap.ticker.add(master);
      return true;
    } catch {
      choreography?.revert();
      smooth?.destroy();
      smooth = choreography = gsap = ST = Lenis = null;
      html.classList.remove('ak-smooth');
      return false;
    }
  })();

  return {
    ready,
    scrollState,
    scrollTo,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() {
      disposed = true;
      life.abort();
      cancelAnimationFrame(raf);
      gsap?.ticker.remove(master);
      choreography?.revert();
      smooth?.destroy();
      html.classList.remove('ak-smooth');
      if (createdRail) rail?.remove();
      listeners.clear();
    }
  };
}
