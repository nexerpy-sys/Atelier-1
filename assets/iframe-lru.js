export function virtualiseMotionGraphics(feed, specs) {
  if (!feed) return { setTheme() {}, evictAll() {}, destroy() {} };
  const small = matchMedia('(max-width: 767px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const life = new AbortController(), signal = life.signal;
  const active = new Map(), near = new Set(), models = new Map();
  let currentTheme = '';
  // Cap active frames to prevent WebGL context eviction while staying smooth on scroll.
  const capacity = () => (small.matches ? 2 : 4);
  const focusCard = m => m.button.focus({ preventScroll: true });

  function distToCenter(slot) {
    const r = slot.getBoundingClientRect();
    return Math.abs((r.top + r.bottom) / 2 - innerHeight / 2);
  }

  function evict(slot) {
    const frame = active.get(slot);
    if (!frame) return;
    const m = models.get(slot), restore = document.activeElement === frame;
    active.delete(slot);
    if (m.trusted) {
      try {
        frame.contentWindow?.postMessage({ type: 'ak-dispose' }, '*');
        const doc = frame.contentDocument;
        doc?.querySelectorAll('canvas').forEach(canvas => {
          try {
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            gl?.getExtension('WEBGL_lose_context')?.loseContext();
          } catch {}
          canvas.width = 1;
          canvas.height = 1;
        });
      } catch { /* Navigation may have changed origin. */ }
    }
    frame.src = 'about:blank';
    requestAnimationFrame(() => frame.remove());
    m.button.hidden = false;
    if (restore) focusCard(m);
  }

  function evictAll() {
    for (const s of [...active.keys()]) evict(s);
    near.clear();
  }

  function touch(slot) {
    const frame = active.get(slot);
    if (frame) { active.delete(slot); active.set(slot, frame); }
  }

  function trim() {
    while (active.size > capacity()) {
      const slots = [...active.keys()];
      evict(slots.find(s => active.get(s) !== document.activeElement) ?? slots[0]);
    }
  }

  function mount(slot, user = false) {
    const m = models.get(slot);
    if (!m || document.hidden || !slot.isConnected) return;
    if (reduced.matches && !user) return;
    if (active.has(slot)) { touch(slot); return; }
    if (active.size >= capacity()) {
      const slots = [...active.keys()].filter(s => active.get(s) !== document.activeElement);
      const nonNear = slots.find(s => !near.has(s));
      const farthest = [...slots].sort((a, b) => distToCenter(b) - distToCenter(a))[0];
      const victim = nonNear ?? (farthest && (user || distToCenter(farthest) > distToCenter(slot) + 80) ? farthest : undefined);
      if (!victim) return;
      evict(victim);
    }
    const frame = document.createElement('iframe');
    frame.title = m.title;
    frame.className = 'ak-mg-frame';
    if (!m.trusted) frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'no-referrer';
    frame.addEventListener('load', () => {
      if (active.get(slot) !== frame) return;
      m.button.hidden = true;
      if (currentTheme) {
        try { frame.contentWindow?.postMessage({ type: 'ak-theme', theme: currentTheme }, '*'); } catch {}
      }
    }, { once: true });
    frame.src = m.url;
    active.set(slot, frame);
    slot.append(frame);
    if (user && document.activeElement === m.button) frame.focus({ preventScroll: true });
  }

  function fill() {
    if (reduced.matches) return;
    if (near.size === 0) {
      for (const s of [...active.keys()]) evict(s);
      return;
    }
    const ordered = [...near]
      .map(slot => [slot, distToCenter(slot)])
      .sort((a, b) => a[1] - b[1]);
    for (const [slot] of ordered) if (!active.has(slot)) mount(slot);
  }

  function setTheme(theme) {
    if (!theme) return;
    currentTheme = theme;
    for (const [slot, m] of models) {
      try {
        const u = new URL(m.url);
        u.searchParams.set('theme', theme);
        m.url = u.href;
      } catch { /* Ignore non-URL strings. */ }
      const frame = active.get(slot);
      if (frame?.contentWindow) {
        try { frame.contentWindow.postMessage({ type: 'ak-theme', theme }, '*'); } catch {}
      }
    }
  }

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) { near.add(e.target); touch(e.target); }
      else near.delete(e.target);
    }
    fill();
  }, { rootMargin: '320px 0px', threshold: 0 });

  for (const { slot, src, title, trustedLocal = false } of specs) {
    if (!slot || !feed.contains(slot)) continue;
    let url;
    try { url = new URL(src, document.baseURI); } catch { continue; }
    if (!src || !/^(?:https?|file):$/.test(url.protocol)) continue;
    const projectRoot = new URL('.', document.baseURI);
    const sameOrigin = url.protocol === 'file:'
      ? url.pathname.startsWith(projectRoot.pathname)
      : url.origin === projectRoot.origin && url.pathname.startsWith(projectRoot.pathname);
    const trusted = trustedLocal && sameOrigin;
    slot.classList.add('ak-mg-slot');
    if (slot.closest('.is-tall')) slot.classList.add('ak-mg-tall');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ak-mg-poster';
    button.setAttribute('aria-label', `Activate ${title}`);
    button.innerHTML = `<span class="ak-mg-dot" aria-hidden="true"></span><span>${title}</span>`;
    models.set(slot, { button, title, url: url.href, trusted });
    slot.append(button);
    io.observe(slot);
    button.addEventListener('click', () => mount(slot, true), { signal });
    slot.addEventListener('pointerenter', () => touch(slot), { passive: true, signal });
    slot.addEventListener('focusin', () => touch(slot), { signal });
    slot.addEventListener('focusout', () => queueMicrotask(() => { if (!signal.aborted) fill(); }), { signal });
  }

  small.addEventListener('change', () => { trim(); fill(); }, { signal });
  reduced.addEventListener('change', () => {
    if (reduced.matches) evictAll();
    else fill();
  }, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) evictAll();
    else fill();
  }, { signal });

  return {
    setTheme,
    evictAll,
    destroy() {
      life.abort();
      io.disconnect();
      evictAll();
      for (const [slot, { button }] of models) {
        button.remove();
        slot.classList.remove('ak-mg-slot', 'ak-mg-tall');
      }
      models.clear();
    }
  };
}
