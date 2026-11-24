import { createClock } from './shared-clock.js';
import { mountHero } from './hero-3d.js';
import { virtualiseMotionGraphics } from './iframe-lru.js';
import { mountAudio } from './audio-engine.js';
import { mountCurves, mountMatter } from './motion-lab.js';
import { mountInspector } from './inspector.js';

export function mountKinetik({ normalise, jump, frameSwarm, registry = './registry.json' } = {}) {
  if (typeof normalise !== 'function' || typeof jump !== 'function') {
    throw new TypeError('Explorer registry and card adapters are required.');
  }
  const clock = createClock(), audio = mountAudio(), hero = mountHero(clock);
  const curves = mountCurves(undefined, audio), matter = mountMatter(clock, audio);
  const inspector = mountInspector({ registry, normalise, jump, openButton: document.querySelector('#nav-search-btn'), audio });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), life = new AbortController();
  const feed = document.querySelector('#xr-mg-feed'), zone = document.querySelector('#build-zone');
  const swarmOff = typeof frameSwarm === 'function'
    ? clock.subscribe((dt, scroll) => { if (!reduced.matches) frameSwarm(dt, scroll); })
    : null;
  let pool = null;

  zone?.addEventListener('ak:state', e => { if (e.detail === 'built') audio.play('plate'); }, { signal: life.signal });

  // Interactive 3D pointer tilt + specular glare for the Powered by Netlify card.
  const nfCard = document.querySelector('#ak-netlify-card');
  if (nfCard && !reduced.matches) {
    nfCard.addEventListener('pointermove', e => {
      const r = nfCard.getBoundingClientRect();
      const px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      const rx = (0.5 - py) * 18;
      const ry = (px - 0.5) * 22;
      nfCard.classList.add('is-tilting');
      nfCard.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      nfCard.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      nfCard.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      nfCard.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    }, { signal: life.signal });
    nfCard.addEventListener('pointerleave', () => {
      nfCard.classList.remove('is-tilting');
      nfCard.style.removeProperty('--rx');
      nfCard.style.removeProperty('--ry');
    }, { signal: life.signal });
  }

  document.querySelector('#chronos-stage')?.addEventListener('ak:step', () => audio.play('tick'), { signal: life.signal });

  // Register GitHub Pages project-subpath-safe relative service worker on http/https origins.
  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }, { once: true, signal: life.signal });
  }

  return {
    clock,
    audio,
    scrollTo(target, opts) { clock.scrollTo(target, opts); },
    openPalette: inspector.openPalette,
    openSource: inspector.openSource,
    mountMotionGraphics(specs) { pool?.destroy(); pool = virtualiseMotionGraphics(feed, specs); },
    setMotionTheme(theme) { pool?.setTheme(theme); },
    evictMotionGraphics() { pool?.evictAll?.(); },
    destroy() {
      life.abort(); swarmOff?.(); pool?.destroy(); inspector.destroy();
      matter(); curves(); hero(); audio.destroy(); clock.destroy();
    }
  };
}
