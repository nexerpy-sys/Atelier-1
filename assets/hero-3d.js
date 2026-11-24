// Atelier Kinetik v2.9.0 — Hero 3D Armillary Sphere (exact port from original index.html, driven by shared-clock.js)

const TAU = Math.PI * 2;
const SEG = 72;

const RINGS = [
  { R: 1, a: 1.32, b: -0.35, sp: 0.05, ticks: true },
  { R: 0.9, a: 0.42, b: 0.1, sp: 0.11 },
  { R: 0.76, a: 1.15, b: 0.6, sp: -0.17, flame: true },
  { R: 0.62, a: -0.75, b: 1.1, sp: 0.24 },
  { R: 0.48, a: 1.57, b: 0.25, sp: -0.33 }
];

// Exact Pantheon agent mineral colors (Prometheus, Athena, Daedalus, Hermes, Chronos)
const AGENT_COLORS = ['#FF3D00', '#F4F2EC', '#B89B6A', '#B4B9C4', '#7D8590'];

const GLOBE = Array.from({ length: 140 }, (_, i) => {
  const y = 1 - (i / 139) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * 2.39996;
  return [Math.cos(th) * r, y, Math.sin(th) * r];
});

export function mountHero(clock, wrap = document.querySelector('#hero-orb-wrap')) {
  const c = wrap?.querySelector('#armillary-canvas');
  if (!c) return () => {};
  const ctx = c.getContext('2d');
  if (!ctx) return () => {};

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const life = new AbortController(), signal = life.signal;
  let S = 0, visible = true, time = 0, resized = true;
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  const p = [0, 0, 0], p2 = [0, 0, 0];

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    S = c.clientWidth || wrap.clientWidth || 360;
    if (!S) return;
    c.width = c.height = Math.round(S * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resized = false;
  }

  function project(x, y, z, a, b, spin, out) {
    const y1 = y * Math.cos(a) - z * Math.sin(a), z1 = y * Math.sin(a) + z * Math.cos(a);
    const x1 = x * Math.cos(b) - y1 * Math.sin(b), y2 = x * Math.sin(b) + y1 * Math.cos(b);
    const x2 = x1 * Math.cos(spin) + z1 * Math.sin(spin), z2 = -x1 * Math.sin(spin) + z1 * Math.cos(spin);
    const ry = tilt.x * 0.7, rx = 0.3 + tilt.y * 0.5;
    const x3 = x2 * Math.cos(ry) + z2 * Math.sin(ry), z3 = -x2 * Math.sin(ry) + z2 * Math.cos(ry);
    const y3 = y2 * Math.cos(rx) - z3 * Math.sin(rx), z4 = y2 * Math.sin(rx) + z3 * Math.cos(rx);
    const k = 3.2 / (3.2 - z4);
    out[0] = S / 2 + x3 * k * S * 0.4;
    out[1] = S / 2 + y3 * k * S * 0.4;
    out[2] = z4;
  }

  function draw() {
    if (!S) return;
    ctx.clearRect(0, 0, S, S);

    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.22);
    g.addColorStop(0, 'rgba(255,61,0,.48)');
    g.addColorStop(1, 'rgba(255,61,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    ctx.fillStyle = '#F4F2EC';
    for (let i = 0; i < GLOBE.length; i++) {
      const d = GLOBE[i];
      project(d[0] * 0.26, d[1] * 0.26, d[2] * 0.26, 0, 0, time * 0.4, p);
      ctx.globalAlpha = p[2] > 0 ? 0.9 : 0.22;
      ctx.fillRect(p[0], p[1], 1.4, 1.4);
    }

    ctx.strokeStyle = '#F4F2EC';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    project(0, -1.18, 0, 0, 0, 0, p);
    project(0, 1.18, 0, 0, 0, 0, p2);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();

    for (let r = 0; r < RINGS.length; r++) {
      const ring = RINGS[r], spin = time * ring.sp;
      ctx.strokeStyle = ring.flame ? '#FF3D00' : '#F4F2EC';
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass ? (ring.flame ? 0.95 : 0.58) : 0.14;
        ctx.lineWidth = pass ? 1.1 : 1;
        ctx.beginPath();
        for (let i = 0; i < SEG; i++) {
          const t0 = (i / SEG) * TAU, t1 = ((i + 1) / SEG) * TAU;
          project(Math.cos(t0) * ring.R, 0, Math.sin(t0) * ring.R, ring.a, ring.b, spin, p);
          project(Math.cos(t1) * ring.R, 0, Math.sin(t1) * ring.R, ring.a, ring.b, spin, p2);
          if ((p[2] + p2[2] > 0) === !!pass) {
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(p2[0], p2[1]);
          }
          if (ring.ticks && pass && i % 2 === 0) {
            project(Math.cos(t0) * (ring.R + (i % 6 ? 0.025 : 0.06)), 0, Math.sin(t0) * (ring.R + (i % 6 ? 0.025 : 0.06)), ring.a, ring.b, spin, p2);
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(p2[0], p2[1]);
          }
        }
        ctx.stroke();
      }
      const col = AGENT_COLORS[r];
      const th = time * (0.5 + r * 0.13) * (r % 2 ? -1 : 1) + r;
      ctx.fillStyle = ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (let k = 0; k <= 10; k++) {
        const tt = th - (r % 2 ? -1 : 1) * k * 0.035;
        project(Math.cos(tt) * ring.R, 0, Math.sin(tt) * ring.R, ring.a, ring.b, spin, p2);
        if (k) ctx.lineTo(p2[0], p2[1]);
        else ctx.moveTo(p2[0], p2[1]);
      }
      ctx.stroke();
      project(Math.cos(th) * ring.R, 0, Math.sin(th) * ring.R, ring.a, ring.b, spin, p);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame(dt) {
    if (resized) size();
    if (!visible || document.hidden || !S) return;
    if (reduced.matches) return;
    time += Math.min(dt, 0.05);
    tilt.x += (tilt.tx - tilt.x) * 0.045;
    tilt.y += (tilt.ty - tilt.y) * 0.045;
    draw();
  }

  const ro = new ResizeObserver(() => { resized = true; size(); draw(); });
  ro.observe(c);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(c);

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    tilt.tx = e.clientX / Math.max(1, window.innerWidth) - 0.5;
    tilt.ty = e.clientY / Math.max(1, window.innerHeight) - 0.5;
  }, { passive: true, signal });
  document.addEventListener('pointerleave', () => { tilt.tx = 0; tilt.ty = 0; }, { signal });
  reduced.addEventListener('change', () => { draw(); }, { signal });

  wrap.classList.add('ak-hero-live');
  size();
  draw();
  const unsubscribe = clock.subscribe(frame);

  return () => {
    life.abort();
    ro.disconnect();
    io.disconnect();
    unsubscribe?.();
  };
}
