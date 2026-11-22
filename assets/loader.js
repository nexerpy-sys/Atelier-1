const base = 'https://cdn.jsdelivr.net/npm/';
const pins = {
  gsap: ['gsap@3.12.5/dist/gsap.min.js', 'g4NTh/Iv5PPU4xPyhEWqPcwtNXOvdaDI8LLnyYfyNZOjKJeYQyjzQ9X5275eBjpt', () => window.gsap],
  scrollTrigger: ['gsap@3.12.5/dist/ScrollTrigger.min.js', 'Z3REaz79l2IaAZqJsSABtTbhjgOUYyV3p90XNnAPCSHg3EMTz1fouunq9WZRtj3d', () => window.ScrollTrigger],
  lenis: ['lenis@1.1.18/dist/lenis.min.js', 'tKsJDT6PlUI0pSBt9/sBKJluKgA19/a6mBrDsZaXotLB4ZYfMGM6xt6/WgGpYhTm', () => window.Lenis],
  matter: ['matter-js@0.20.0/build/matter.min.js', 'ZRKYEXtLBVeqs9z1WxyeKutCqnkqolS/r1EUWuoUpG4ZKbnRAIXnHhHdnNuiB6CL', () => window.Matter],
  tone: ['tone@14.8.49/build/Tone.js', 'c6Uo4N9c3SOEigMVzP6IshUG1wQ5uMp3xeoQFiHWAQ86joWdgyajkvopySyKy/Z6', () => window.Tone],
  prism: ['prismjs@1.29.0/prism.min.js', 'BGaNxfftg+9+TtC098wxawPFVEUpKYvaiCgbB0iqAMjK/4jDdmUY+oGxrPNvnXEf', () => window.Prism?.languages?.javascript && window.Prism],
  c: ['prismjs@1.29.0/components/prism-c.min.js', null, () => window.Prism?.languages?.c && window.Prism],
  glsl: ['prismjs@1.29.0/components/prism-glsl.min.js', 'pVTxhwiBtNI5Ft7QtXG/tusDcSM4EdV8GKzHytqK5M+rMWbpPRCvDGqjoF70fa21', () => window.Prism?.languages?.glsl && window.Prism]
};

const flights = new Map();
const unavailable = (key, reason) => new Error(`${key} unavailable: ${reason}`);

// Single-flight deduplication while in-flight or resolved; evicts rejected entries so explicit user retries recover.
function once(key, fn) {
  if (!flights.has(key)) {
    const p = Promise.resolve().then(fn).catch(err => {
      if (flights.get(key) === p) flights.delete(key);
      throw err;
    });
    flights.set(key, p);
  }
  return flights.get(key);
}

function classic(key) {
  const [, , get] = pins[key];
  const existing = get();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const [path, hash] = pins[key];
    const script = document.createElement('script');
    if (key === 'prism') script.setAttribute('data-manual', '');
    if (hash) script.integrity = `sha384-${hash}`;
    script.crossOrigin = 'anonymous';
    script.src = base + path;
    let done = false;
    const finish = (reason, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (reason) {
        script.remove();
        reject(unavailable(key, reason));
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(() => finish('3 s timeout'), 3000);
    script.onload = () => {
      const value = get();
      finish(value ? null : 'missing export', value);
    };
    script.onerror = () => finish('blocked, failed, or integrity mismatch');
    document.head.append(script);
  });
}

export function load(key) {
  return once(key, async () => {
    if (key === 'three') {
      let timer;
      try {
        return await Promise.race([
          import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(unavailable(key, '3 s timeout')), 3000);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!Object.hasOwn(pins, key)) throw unavailable(key, 'unknown dependency');
    // Lenis is independent of GSAP and can load in parallel; ScrollTrigger depends on GSAP; GLSL depends on C -> Prism.
    if (key === 'scrollTrigger') await load('gsap');
    if (key === 'c') await load('prism');
    if (key === 'glsl') await load('c');
    return classic(key);
  });
}

export const afterPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
export const whenIdle = () => new Promise(resolve => {
  if (window.requestIdleCallback) window.requestIdleCallback(resolve, { timeout: 700 });
  else setTimeout(resolve, 0);
});
