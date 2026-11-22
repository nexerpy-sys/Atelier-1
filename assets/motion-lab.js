import { load } from './loader.js';

const clamp = (v, l, h) => Math.max(l, Math.min(h, v));
const bisect = (lo, hi, p) => {
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (p(mid)) lo = mid; else hi = mid;
  }
  return hi;
};

export function spring(m, c, k) {
  if (![m, c, k].every(Number.isFinite) || m <= 0 || c < 0 || k <= 0) {
    throw new RangeError('Require m > 0, c ≥ 0, k > 0.');
  }
  const w = Math.sqrt(k / m), a = c / (2 * m), z = a / w;
  if (!Number.isFinite(z) || !Number.isFinite(w) || w <= 0) {
    throw new RangeError('Spring parameters exceed numeric range.');
  }
  let state, overshoot = 0, peakTime = 0, settle = Infinity;
  if (z < 1) {
    const b = w * Math.sqrt((1 - z) * (1 + z));
    state = t => {
      const u = b * t, E = Math.exp(-a * t), sinc = Math.abs(u) < 1e-4 ? 1 - u * u / 6 : Math.sin(u) / u;
      return [E * (Math.cos(u) + a * t * sinc), E * w * w * t * sinc];
    };
    const half = Math.PI / b;
    peakTime = half;
    overshoot = 100 * Math.exp(-a * half);
    if (a > 0) {
      const n = Math.max(0, Math.ceil(Math.log(50) / (a * half)) - 1), lo = n * half;
      const zero = lo + (Math.PI / 2 + Math.atan2(a, b)) / b;
      if (Number.isFinite(zero)) settle = bisect(lo, zero, t => Math.abs(state(t)[0]) > 0.02);
    }
  } else {
    if (z === 1) {
      state = t => { const E = Math.exp(-w * t); return [(1 + w * t) * E, w * w * t * E]; };
    } else {
      const h = w * Math.sqrt(z - 1) * Math.sqrt(z + 1), fast = -(a + h), slow = -w * (w / (a + h)), gap = 2 * h;
      state = t => { const E = Math.exp(slow * t), q = -Math.expm1(-gap * t) / gap; return [E * (1 - slow * q), E * w * w * q]; };
    }
    let hi = 1 / w;
    while (Number.isFinite(hi) && state(hi)[0] > 0.02) hi *= 2;
    if (Number.isFinite(hi)) settle = bisect(0, hi, t => state(t)[0] > 0.02);
  }
  return {
    omega0: w, zeta: z, overshoot, peakTime, settle, state,
    value: t => 1 - state(t)[0],
    curvatureBound(t) { const [e, v] = state(t); return w * w * (1 + 2 * z) * Math.hypot(e, v / w); }
  };
}

export function springLinear(s, duration = s.settle) {
  if (!(duration > 0 && Number.isFinite(duration))) throw new RangeError('Select a finite preview duration.');
  const count = 2 ** 20, tolerance = 0.005, reserve = 5.01e-7;
  const at = i => s.value(duration * i / count);
  function interval(a, b) {
    const dt = duration * (b - a) / count;
    return { a, b, error: s.curvatureBound(duration * a / count) * dt * dt / 8 };
  }
  const segments = [interval(0, count)];
  while (true) {
    let worst = 0;
    for (let i = 1; i < segments.length; i++) if (segments[i].error > segments[worst].error) worst = i;
    const { a, b, error } = segments[worst];
    if (!Number.isFinite(error)) throw new RangeError('Sampling exceeds numeric range.');
    if (error + reserve <= tolerance) {
      const stops = [0, ...segments.map(x => x.b)];
      return {
        stops: stops.length,
        error: error + reserve,
        css: `linear(${stops.map(i => `${at(i).toFixed(6)} ${(100 * i / count).toFixed(18).replace(/0+$/, '').replace(/\.$/, '')}%`).join(', ')})`
      };
    }
    if (segments.length >= 127 || b - a < 2) {
      throw new RangeError('Cannot certify 0.005 error with 128 stops for this duration.');
    }
    const mid = (a + b) >> 1;
    segments.splice(worst, 1, interval(a, mid), interval(mid, b));
  }
}

const bez = (t, p, q) => 3 * (1 - t) ** 2 * t * p + 3 * (1 - t) * t * t * q + t ** 3;
const deriv = (t, p, q) => 3 * ((1 - t) ** 2 * p + 2 * (1 - t) * t * (q - p) + t * t * (1 - q));

export function cubic(x1, y1, x2, y2) {
  x1 = clamp(x1, 0, 1); x2 = clamp(x2, 0, 1);
  y1 = clamp(y1, -2.5, 3); y2 = clamp(y2, -2.5, 3);
  return x => {
    if (x <= 0 || x >= 1) return clamp(x, 0, 1);
    let a = 0, b = 1, t = x;
    for (let i = 0; i < 40; i++) {
      const f = bez(t, x1, x2) - x;
      if (Math.abs(f) < 1e-14) break;
      if (f > 0) b = t; else a = t;
      const d = deriv(t, x1, x2), next = t - f / d;
      t = d > 1e-10 && next > a && next < b ? next : (a + b) / 2;
    }
    return bez(t, y1, y2);
  };
}

const SPRING_PRESETS = [
  { id: 'snappy', label: 'Snappy', m: 1, c: 22, k: 260 },
  { id: 'soft', label: 'Soft', m: 1, c: 20, k: 170 },
  { id: 'atelier', label: 'Calibrated', m: 1, c: 12, k: 180 },
  { id: 'heavy', label: 'Heavy', m: 2, c: 28, k: 120 },
  { id: 'critical', label: 'Critical', m: 1, c: 26.83, k: 180 }
];

const BEZIER_PRESETS = [
  { id: 'snap', label: 'Atelier Snap', pts: [[0.16, 1], [0.3, 1]] },
  { id: 'anticipate', label: 'Anticipate', pts: [[0.36, 0], [0.66, -0.56]] },
  { id: 'expo', label: 'Expo Out', pts: [[0.19, 1], [0.22, 1]] },
  { id: 'linear', label: 'Linear', pts: [[0.25, 0.25], [0.75, 0.75]] }
];

export function mountCurves(root = document.querySelector('#curves-grid'), audio = null) {
  if (!root) return () => {};
  const params = new URLSearchParams(window.location.search);
  const initM = clamp(Number(params.get('m')) || 1, 0.05, 20);
  const initC = params.has('c') && Number.isFinite(Number(params.get('c'))) ? clamp(Number(params.get('c')), 0, 100) : 12;
  const initK = clamp(Number(params.get('k')) || 180, 1, 600);

  const panel = document.createElement('div');
  panel.className = 'ak-curves-grid';
  panel.innerHTML = `
    <div class="ak-curve-col">
      <div class="ak-curve-head">
        <div>
          <span class="ak-curve-kicker">01 · ANALYTICAL SPRING</span>
          <h3>Unit-Step Oscilloscope</h3>
        </div>
        <button type="button" class="ak-btn" data-spring-play>Replay</button>
      </div>
      <div class="ak-preset-row" data-spring-presets>
        ${SPRING_PRESETS.map(p => `<button type="button" class="ak-chip" data-sp="${p.id}">${p.label}</button>`).join('')}
      </div>
      <svg class="ak-osc-svg" data-spring-svg viewBox="0 0 360 190" aria-label="Analytical spring step response plot">
        <line x1="36" y1="162" x2="344" y2="162" stroke="var(--line-strong)" stroke-width="1"/>
        <line x1="36" y1="16" x2="36" y2="162" stroke="var(--line-strong)" stroke-width="1"/>
        <rect data-band x="36" y="61" width="308" height="4" fill="rgba(229,169,60,0.16)"/>
        <line data-target x1="36" y1="63" x2="344" y2="63" stroke="rgba(244,242,236,0.22)" stroke-dasharray="4 4"/>
        <line data-settle-line x1="344" y1="16" x2="344" y2="162" stroke="rgba(229,169,60,0.45)" stroke-dasharray="2 3"/>
        <path data-spring-path fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/>
        <circle data-peak r="3.5" fill="var(--flame)" hidden/>
        <circle data-spring-dot r="4.5" fill="var(--flame)"/>
        <text x="30" y="166" text-anchor="end" class="ak-svg-lbl">0</text>
        <text x="30" y="67" text-anchor="end" class="ak-svg-lbl">1.0</text>
        <text data-settle-lbl x="342" y="178" text-anchor="end" class="ak-svg-lbl">settle</text>
      </svg>
      <div class="ak-param-grid">
        <label><span>Mass (kg)</span><input data-s="m" type="number" min="0.05" max="20" step="0.05" value="${initM}"></label>
        <label><span>Damping (N·s/m)</span><input data-s="c" type="number" min="0" max="100" step="0.5" value="${initC}"></label>
        <label><span>Stiffness (N/m)</span><input data-s="k" type="number" min="1" max="600" step="5" value="${initK}"></label>
      </div>
      <p class="ak-telemetry" data-metrics role="status"></p>
      <div class="ak-export-box">
        <div class="ak-export-bar">
          <span>CSS linear() · error ≤ 0.005</span>
          <button type="button" class="ak-btn" data-copy-target="linear">Copy linear()</button>
        </div>
        <textarea readonly rows="2" data-linear aria-label="Certified CSS linear easing output"></textarea>
      </div>
    </div>

    <div class="ak-curve-col">
      <div class="ak-curve-head">
        <div>
          <span class="ak-curve-kicker">02 · CUBIC BÉZIER</span>
          <h3>Newton–Raphson Editor</h3>
        </div>
        <button type="button" class="ak-btn" data-bez-play>Replay</button>
      </div>
      <div class="ak-preset-row" data-bez-presets>
        ${BEZIER_PRESETS.map(p => `<button type="button" class="ak-chip" data-bp="${p.id}">${p.label}</button>`).join('')}
      </div>
      <svg class="ak-bez-svg" data-plot viewBox="0 0 300 240" aria-label="Cubic Bézier interactive controls">
        <path d="M42 184H258 M42 20V220" fill="none" stroke="var(--line-strong)"/>
        <line x1="42" y1="60" x2="258" y2="60" stroke="rgba(244,242,236,0.16)" stroke-dasharray="4 4"/>
        <line data-arm0 stroke="rgba(0,240,255,0.45)" stroke-width="1"/>
        <line data-arm1 stroke="rgba(0,240,255,0.45)" stroke-width="1"/>
        <path data-path fill="none" stroke="var(--gold)" stroke-width="2.2"/>
        <circle data-play r="4.5" fill="var(--flame)"/>
        <g data-h tabindex="0" role="slider" aria-orientation="horizontal" aria-label="First Bézier control"><rect x="-22" y="-22" width="44" height="44" fill="transparent"/><circle r="6" fill="var(--cyan)"/></g>
        <g data-h tabindex="0" role="slider" aria-orientation="horizontal" aria-label="Second Bézier control"><rect x="-22" y="-22" width="44" height="44" fill="transparent"/><circle r="6" fill="var(--cyan)"/></g>
      </svg>
      <p class="ak-hint">Drag handles or use arrow keys (Shift for 0.1 steps). Press Space to replay.</p>
      <div class="ak-export-box">
        <div class="ak-export-bar"><span>CSS cubic-bezier()</span><button type="button" class="ak-btn" data-copy-target="css">Copy CSS</button></div>
        <input readonly data-css aria-label="CSS cubic-bezier output">
      </div>
      <div class="ak-export-box">
        <div class="ak-export-bar"><span>GSAP CustomEase (optional plugin)</span><button type="button" class="ak-btn" data-copy-target="gsap">Copy GSAP</button></div>
        <input readonly data-gsap aria-label="GSAP CustomEase path output">
      </div>
    </div>`;
  root.replaceChildren(panel);

  const life = new AbortController(), signal = life.signal;
  const $ = s => panel.querySelector(s);
  const inputs = [...panel.querySelectorAll('[data-s]')];
  const handles = [...panel.querySelectorAll('[data-h]')];
  const svg = $('[data-plot]'), path = $('[data-path]'), dot = $('[data-play]');
  const arm0 = $('[data-arm0]'), arm1 = $('[data-arm1]');
  const springPath = $('[data-spring-path]'), springDot = $('[data-spring-dot]'), peakDot = $('[data-peak]');
  const bandRect = $('[data-band]'), targetLine = $('[data-target]'), settleLine = $('[data-settle-line]'), settleLbl = $('[data-settle-lbl]');

  const points = [[0.16, 1], [0.3, 1]];
  const X = x => 42 + 216 * x, Y = y => 184 - 124 * y;
  let bezAnim, springAnim, currentSpring = null, currentDur = 1;

  function drawSpringPlot(s, dur) {
    const x0 = 36, x1 = 344, y0 = 162, yTop = 22;
    const peakVal = Math.max(1.15, 1 + s.overshoot / 100 + 0.08);
    const sx = t => x0 + (t / dur) * (x1 - x0);
    const sy = v => y0 - (v / peakVal) * (y0 - yTop);
    const pts = [];
    const N = 140;
    for (let i = 0; i <= N; i++) {
      const t = (dur * i) / N;
      pts.push(`${i === 0 ? 'M' : 'L'}${sx(t).toFixed(1)} ${sy(s.value(t)).toFixed(1)}`);
    }
    springPath.setAttribute('d', pts.join(' '));
    const yTarget = sy(1);
    targetLine.setAttribute('y1', yTarget.toFixed(1));
    targetLine.setAttribute('y2', yTarget.toFixed(1));
    const yHi = sy(1.02), yLo = sy(0.98);
    bandRect.setAttribute('y', yHi.toFixed(1));
    bandRect.setAttribute('height', Math.max(2, yLo - yHi).toFixed(1));
    if (s.overshoot > 0.15 && s.peakTime > 0 && s.peakTime < dur) {
      peakDot.hidden = false;
      peakDot.setAttribute('cx', sx(s.peakTime).toFixed(1));
      peakDot.setAttribute('cy', sy(s.value(s.peakTime)).toFixed(1));
    } else {
      peakDot.hidden = true;
    }
    const sX = Number.isFinite(s.settle) ? sx(Math.min(dur, s.settle)) : x1;
    settleLine.setAttribute('x1', sX.toFixed(1));
    settleLine.setAttribute('x2', sX.toFixed(1));
    settleLbl.textContent = Number.isFinite(s.settle) ? `2% @ ${s.settle.toFixed(2)}s` : `${dur.toFixed(1)}s window`;
    springDot.style.transform = `translate(${sx(dur).toFixed(1)}px,${sy(s.value(dur)).toFixed(1)}px)`;
  }

  function replaySpring() {
    if (!currentSpring) return;
    springAnim?.cancel();
    const s = currentSpring, dur = currentDur;
    const x0 = 36, x1 = 344, y0 = 162, yTop = 22;
    const peakVal = Math.max(1.15, 1 + s.overshoot / 100 + 0.08);
    const sx = t => x0 + (t / dur) * (x1 - x0);
    const sy = v => y0 - (v / peakVal) * (y0 - yTop);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      springDot.style.transform = `translate(${sx(dur).toFixed(1)}px,${sy(s.value(dur)).toFixed(1)}px)`;
      return;
    }
    const frames = Array.from({ length: 91 }, (_, i) => {
      const t = (dur * i) / 90;
      return { transform: `translate(${sx(t).toFixed(1)}px,${sy(s.value(t)).toFixed(1)}px)` };
    });
    springAnim = springDot.animate(frames, { duration: Math.max(300, Math.min(2400, dur * 1000)), easing: 'linear' });
  }

  function report(syncUrl = false) {
    const metrics = $('[data-metrics]'), out = $('[data-linear]');
    out.value = '';
    try {
      if (inputs.some(el => !el.validity.valid || !Number.isFinite(el.valueAsNumber))) {
        throw new Error('Enter values within the displayed ranges.');
      }
      const [m, c, k] = inputs.map(el => el.valueAsNumber);
      const s = spring(m, c, k);
      const dur = Number.isFinite(s.settle) ? Math.max(0.25, s.settle * 1.08) : 1.2;
      currentSpring = s; currentDur = dur;
      drawSpringPlot(s, dur);
      const regime = s.zeta < 0.995 ? 'under-damped' : s.zeta <= 1.005 ? 'critical' : 'over-damped';
      metrics.textContent = `ω₀ ${s.omega0.toFixed(2)} rad/s · ζ ${s.zeta.toFixed(2)} (${regime}) · overshoot ${s.overshoot.toFixed(1)}% · 2% settle ${Number.isFinite(s.settle) ? s.settle.toFixed(3) + ' s' : '∞'}`;
      try {
        const sample = springLinear(s, Number.isFinite(s.settle) ? s.settle : 1);
        out.value = sample.css;
        metrics.textContent += ` · ${sample.stops} stops`;
      } catch (e) { metrics.textContent += ` · ${e.message}`; }
      if (syncUrl && /^https?:$/.test(location.protocol)) {
        const u = new URL(location.href);
        u.searchParams.set('m', String(m));
        u.searchParams.set('c', String(c));
        u.searchParams.set('k', String(k));
        try { history.replaceState(null, '', u); } catch {}
      }
    } catch (e) { metrics.textContent = e.message; }
  }

  function draw() {
    const [[a, b], [c, d]] = points;
    path.setAttribute('d', `M${X(0)} ${Y(0)} C${X(a)} ${Y(b)} ${X(c)} ${Y(d)} ${X(1)} ${Y(1)}`);
    arm0.setAttribute('x1', X(0)); arm0.setAttribute('y1', Y(0));
    arm0.setAttribute('x2', X(a)); arm0.setAttribute('y2', Y(b));
    arm1.setAttribute('x1', X(1)); arm1.setAttribute('y1', Y(1));
    arm1.setAttribute('x2', X(c)); arm1.setAttribute('y2', Y(d));
    handles.forEach((h, i) => {
      const [x, y] = points[i];
      h.setAttribute('transform', `translate(${X(x)} ${Y(y)})`);
      h.setAttribute('aria-valuemin', '0');
      h.setAttribute('aria-valuemax', '1');
      h.setAttribute('aria-valuenow', String(x));
      h.setAttribute('aria-valuetext', `x ${x.toFixed(2)}, y ${y.toFixed(2)}`);
    });
    const f = n => Number(n.toFixed(4));
    $('[data-css]').value = `cubic-bezier(${[a, b, c, d].map(f).join(', ')})`;
    $('[data-gsap]').value = `CustomEase.create("atelierLaw", "M0,0 C${f(a)},${f(b)} ${f(c)},${f(d)} 1,1")`;
  }

  function replay() {
    bezAnim?.cancel();
    dot.style.transform = `translate(${X(1)}px,${Y(1)}px)`;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ease = cubic(...points.flat());
    const frames = Array.from({ length: 101 }, (_, i) => ({ transform: `translate(${X(i / 100)}px,${Y(ease(i / 100))}px)` }));
    bezAnim = dot.animate(frames, { duration: 850, easing: 'linear' });
  }

  handles.forEach((h, i) => {
    const set = (x, y) => { points[i] = [clamp(x, 0, 1), clamp(y, -1.2, 1.8)]; draw(); };
    let pointer = null;
    h.addEventListener('pointerdown', e => {
      if (pointer !== null || e.button !== 0) return;
      pointer = e.pointerId; h.setPointerCapture(pointer); h.focus();
    }, { signal });
    h.addEventListener('pointermove', e => {
      if (pointer !== e.pointerId) return;
      const m = svg.getScreenCTM(); if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      set((p.x - 42) / 216, (184 - p.y) / 124);
    }, { signal });
    h.addEventListener('lostpointercapture', () => { pointer = null; }, { signal });
    h.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.1 : 0.01, [x, y] = points[i];
      switch (e.key) {
        case 'ArrowLeft': set(x - step, y); break;
        case 'ArrowRight': set(x + step, y); break;
        case 'ArrowUp': set(x, y + step); break;
        case 'ArrowDown': set(x, y - step); break;
        case ' ': if (!e.repeat) replay(); break;
        default: return;
      }
      e.preventDefault();
    }, { signal });
  });

  $('[data-spring-presets]').addEventListener('click', e => {
    const btn = e.target.closest('[data-sp]');
    const preset = SPRING_PRESETS.find(p => p.id === btn?.dataset.sp);
    if (!preset) return;
    inputs[0].value = String(preset.m);
    inputs[1].value = String(preset.c);
    inputs[2].value = String(preset.k);
    report(true);
    replaySpring();
  }, { signal });

  $('[data-bez-presets]').addEventListener('click', e => {
    const btn = e.target.closest('[data-bp]');
    const preset = BEZIER_PRESETS.find(p => p.id === btn?.dataset.bp);
    if (!preset) return;
    points[0] = [...preset.pts[0]];
    points[1] = [...preset.pts[1]];
    draw();
    replay();
  }, { signal });

  $('[data-spring-play]').addEventListener('click', replaySpring, { signal });
  $('[data-bez-play]').addEventListener('click', replay, { signal });

  panel.addEventListener('click', async e => {
    const btn = e.target.closest('[data-copy-target]');
    if (!btn) return;
    const key = btn.dataset.copyTarget;
    const field = $(`[data-${key}]`);
    if (!field?.value) return;
    try {
      await navigator.clipboard.writeText(field.value);
      audio?.play('snap');
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { if (!signal.aborted) btn.textContent = prev; }, 1400);
    } catch { /* Clipboard denied. */ }
  }, { signal });

  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { bezAnim?.cancel(); springAnim?.cancel(); }, { signal });
  panel.addEventListener('input', e => { if (e.target.matches('[data-s]')) report(true); }, { signal });
  dot.style.transform = `translate(${X(0)}px,${Y(0)}px)`;
  draw(); report(false);
  return () => { life.abort(); bezAnim?.cancel(); springAnim?.cancel(); panel.remove(); };
}

const W = 720, H = 360, STEP = 1000 / 60, STRIDE = 5, SPARKS = 24;
const presets = {
  'Obsidian / firm': { density: 0.003, restitution: 0.38, friction: 0.36, frictionAir: 0.014 },
  'Polymer / lively': { density: 0.0017, restitution: 0.76, friction: 0.24, frictionAir: 0.012 },
  'Rubber / damped': { density: 0.0022, restitution: 0.18, friction: 0.68, frictionAir: 0.065 }
};

export function mountMatter(clock, audio) {
  const section = document.querySelector('#easings'), stage = document.querySelector('#matter-stage'),
    canvas = stage?.querySelector('#matter-canvas') || document.querySelector('#matter-canvas');
  if (!section || !stage || !canvas) return () => {};
  const life = new AbortController(), signal = life.signal, reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const drop = document.querySelector('#matter-drop-btn'), grav = document.querySelector('#matter-grav-btn'), reset = document.querySelector('#matter-reset-btn');
  const bar = document.createElement('div');
  bar.className = 'ak-matter-tools';
  bar.innerHTML = '<label>Material <select></select></label><button type="button" class="ak-btn" aria-pressed="false">Drag plates</button><p role="status">Physics loads when this section is nearby.</p>';
  stage.after(bar);
  const drag = bar.querySelector('button'), select = bar.querySelector('select'), status = bar.querySelector('p');
  for (const name of Object.keys(presets)) select.add(new Option(name, name));

  let M, engine, off, visible = false, mode = false, pointer = null, joint, acc = 0, at = 0, sign = 1, paint = true, disposed = false;
  const spark = new Float32Array(SPARKS * STRIDE), plates = [], before = new Map();
  const controls = [drop, grav, reset, drag, select].filter(Boolean);
  const original = controls.map(x => x.disabled);
  for (const b of controls) b.disabled = true;
  const ctx = canvas.getContext('2d');

  function syncGravLabel() {
    if (!grav) return;
    grav.setAttribute('aria-pressed', String(sign < 0));
    grav.textContent = sign < 0 ? 'Gravity: Inverted' : 'Gravity: On';
  }

  function wakeAll() {
    if (!M) return;
    for (const b of plates) M.Sleeping.set(b, false);
  }

  function size() {
    const d = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * d));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * d));
    paint = true;
  }
  const ro = new ResizeObserver(size); ro.observe(canvas);

  function place() {
    if (plates.length >= 12) return;
    wakeAll();
    const n = plates.length, w = 112 + (n % 3) * 12, h = 30 + (n % 4) * 3;
    const b = M.Bodies.rectangle(110 + ((n * 137) % 490), sign > 0 ? 78 : 265, w, h, {
      ...presets[select.value], chamfer: { radius: 6 }, angle: (n % 3 - 1) * 0.22
    });
    plates.push(b); M.Composite.add(engine.world, b); paint = true;
  }
  function exit() { mode = false; drag.setAttribute('aria-pressed', 'false'); canvas.classList.remove('ak-drag-mode'); end(); }
  function end() {
    const id = pointer; pointer = null;
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    if (joint) { M.Composite.remove(engine.world, joint); joint = null; }
  }
  function clean() {
    exit();
    for (const b of plates) M.Composite.remove(engine.world, b);
    plates.length = 0; spark.fill(0); acc = 0; sign = 1; engine.gravity.y = 1;
    syncGravLabel();
    for (let i = 0; i < 4; i++) place();
  }
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / Math.max(1, r.width), y: (e.clientY - r.top) * H / Math.max(1, r.height) };
  }

  function collision({ pairs }) {
    for (const { bodyA, bodyB, collision: c } of pairs) {
      const a = before.get(bodyA) ?? bodyA.velocity, b = before.get(bodyB) ?? bodyB.velocity;
      const vn = Math.abs((b.x - a.x) * c.normal.x + (b.y - a.y) * c.normal.y);
      if (vn <= 0.35) continue;
      audio?.play('collision', { normalSpeed: vn });
      const pt = c.supports?.[0] ?? bodyA.position, count = Math.min(4, Math.ceil(vn / 2));
      for (let n = 0; n < count; n++) {
        const i = (at++ % SPARKS) * STRIDE, ang = Math.atan2(c.normal.y, c.normal.x) + (Math.random() - 0.5) * 1.4, spd = 1 + Math.random() * 2.5;
        spark[i] = pt.x; spark[i + 1] = pt.y; spark[i + 2] = Math.cos(ang) * spd; spark[i + 3] = Math.sin(ang) * spd; spark[i + 4] = 1;
      }
    }
  }

  function draw() {
    if (!ctx || !canvas.width || !canvas.height) return;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.fillStyle = '#0d0d12'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(244,242,236,0.12)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    for (const b of plates) {
      ctx.beginPath();
      b.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
      ctx.closePath();
      ctx.fillStyle = b.isSleeping ? '#121219' : '#181822'; ctx.fill();
      ctx.strokeStyle = b.isSleeping ? 'rgba(244,242,236,0.22)' : 'rgba(229,169,60,0.48)'; ctx.stroke();
    }
    ctx.fillStyle = '#ff3d00';
    for (let i = 0; i < spark.length; i += STRIDE) {
      if (spark[i + 4] <= 0) continue;
      ctx.globalAlpha = spark[i + 4];
      ctx.fillRect(spark[i] - 1.5, spark[i + 1] - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    paint = false;
  }

  function tick(dt) {
    if (!engine || !visible || document.hidden) { acc = 0; return; }
    if (!reduced.matches) {
      acc = Math.min(acc + dt * 1000, STEP * 4);
      let steps = 0;
      while (acc >= STEP && steps < 4) {
        before.clear();
        for (const b of plates) before.set(b, { x: b.velocity.x, y: b.velocity.y });
        M.Engine.update(engine, STEP);
        acc -= STEP; steps++; paint = true;
      }
      for (let i = 0; i < spark.length; i += STRIDE) {
        if (spark[i + 4] <= 0) continue;
        spark[i] += spark[i + 2]; spark[i + 1] += spark[i + 3];
        spark[i + 4] = Math.max(0, spark[i + 4] - dt * 3.5);
        paint = true;
      }
    }
    if (paint) draw();
  }

  let loading = false;
  async function init() {
    if (loading || engine || disposed) return;
    loading = true;
    status.textContent = 'Loading physics…';
    try {
      M = await load('matter');
      if (disposed) return;
      engine = M.Engine.create({ enableSleeping: true });
      const wall = (x, y, w, h) => M.Bodies.rectangle(x, y, w, h, { isStatic: true });
      M.Composite.add(engine.world, [wall(W / 2, H + 30, W + 120, 60), wall(W / 2, -30, W + 120, 60), wall(-30, H / 2, 60, H + 120), wall(W + 30, H / 2, 60, H + 120)]);
      M.Events.on(engine, 'collisionStart', collision);
      size(); clean();
      for (const b of controls) b.disabled = false;
      status.textContent = reduced.matches ? 'Reduced motion active; physics paused.' : 'Drag mode off (scroll stays free).';
      off = clock.subscribe(tick);
      draw();
    } catch { status.textContent = 'Physics unavailable.'; }
  }

  drop?.addEventListener('click', () => { if (engine) { place(); draw(); } }, { signal });
  grav?.addEventListener('click', () => {
    if (!engine) return;
    wakeAll();
    sign = -sign; engine.gravity.y = sign;
    syncGravLabel();
  }, { signal });
  reset?.addEventListener('click', () => { if (engine) { clean(); draw(); } }, { signal });
  select.addEventListener('change', () => {
    if (!engine) return;
    wakeAll();
    const spec = presets[select.value];
    for (const b of plates) Object.assign(b, spec);
  }, { signal });
  drag.addEventListener('click', () => {
    mode = !mode; drag.setAttribute('aria-pressed', String(mode)); canvas.classList.toggle('ak-drag-mode', mode);
    if (!mode) end();
    status.textContent = mode ? 'Drag mode on. Press Escape to release.' : 'Drag mode off (scroll stays free).';
  }, { signal });
  canvas.addEventListener('pointerdown', e => {
    if (!mode || !engine || pointer !== null || e.button !== 0) return;
    const p = point(e), [hit] = M.Query.point(plates, p); if (!hit) return;
    wakeAll();
    pointer = e.pointerId; canvas.setPointerCapture(pointer);
    joint = M.Constraint.create({ pointA: p, bodyB: hit, pointB: { x: p.x - hit.position.x, y: p.y - hit.position.y }, stiffness: 0.25, damping: 0.1 });
    M.Composite.add(engine.world, joint);
  }, { signal });
  canvas.addEventListener('pointermove', e => { if (pointer === e.pointerId && joint) joint.pointA = point(e); }, { signal });
  canvas.addEventListener('pointerup', end, { signal });
  canvas.addEventListener('pointercancel', end, { signal });
  canvas.addEventListener('lostpointercapture', end, { signal });
  window.addEventListener('blur', exit, { signal });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && mode) exit(); }, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { acc = 0; exit(); } }, { signal });

  const prep = new IntersectionObserver(([e]) => { if (e.isIntersecting) { prep.disconnect(); init(); } }, { rootMargin: '480px 0px' });
  prep.observe(section);
  const vis = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (!visible) { acc = 0; exit(); } });
  vis.observe(stage);

  return () => {
    disposed = true; life.abort(); prep.disconnect(); vis.disconnect(); ro.disconnect(); off?.(); exit();
    if (engine) {
      M.Events.off(engine, 'collisionStart', collision);
      M.Composite.clear(engine.world, false, true);
      M.Engine.clear(engine);
    }
    controls.forEach((b, i) => { b.disabled = original[i]; });
    bar.remove();
  };
}
