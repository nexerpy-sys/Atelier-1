import { afterPaint, load } from './loader.js';

export function gaugeGeometry(T) {
  const pos = [], idx = [], seam = [], gold = [], uv = [];
  function face(points, s = 0, g = 0) {
    const start = pos.length / 3;
    for (const [x, y, z] of points) {
      pos.push(x, y, z);
      seam.push(s);
      gold.push(g);
      uv.push(x / 2.8 + 0.5, y / 2.3 + 0.5);
    }
    for (let i = 1; i < points.length - 1; i++) idx.push(start, start + i, start + i + 1);
  }
  function plate({ x: w, y: h, z: d, cy, b, s = 0, marks = [] }) {
    const ring = (a, e, z) => {
      const c = Math.min(b * 1.12, e * 0.5);
      return [[-a + c, -e], [a - c, -e], [a, -e + c], [a, e - c], [a - c, e], [-a + c, e], [-a, e - c], [-a, -e + c]]
        .map(([x, y]) => [x, y + cy, z]);
    };
    const rings = [ring(w - b, h - b, -d), ring(w, h, -d + b), ring(w, h, d - b), ring(w - b, h - b, d)];
    face([...rings[0]].reverse(), s);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 8; i++) {
        const n = (i + 1) % 8;
        face([rings[j][i], rings[j][n], rings[j + 1][n], rings[j + 1][i]], s);
      }
    }
    const front = rings[3];
    if (!marks.length) { face(front, s); return; }
    const L = front[0][0], R = front[1][0], B = front[0][1], U = front[4][1];
    face([front[1], front[2], front[3], front[4]], s);
    face([front[5], front[6], front[7], front[0]], s);
    const cutY = [B, U, ...marks.flatMap(m => [m[2], m[3]])].sort((a, b) => a - b);
    const rect = (l, r, b0, t, z, g = 0) => face([[l, b0, z], [r, b0, z], [r, t, z], [l, t, z]], s, g);
    for (let i = 1; i < cutY.length; i++) {
      const b0 = cutY[i - 1], t = cutY[i];
      const mark = marks.find(m => m[2] === b0 && m[3] === t);
      if (!mark) { rect(L, R, b0, t, d); continue; }
      const [l, r] = mark, q = d - 0.011;
      rect(L, l, b0, t, d);
      rect(r, R, b0, t, d);
      rect(l, r, b0, t, q, 1);
      face([[l, b0, d], [r, b0, d], [r, b0, q], [l, b0, q]], s);
      face([[r, t, d], [l, t, d], [l, t, q], [r, t, q]], s);
      face([[l, t, d], [l, b0, d], [l, b0, q], [l, t, q]], s);
      face([[r, b0, d], [r, t, d], [r, t, q], [r, b0, q]], s);
    }
  }
  plate({ x: 1.19, y: 0.28, z: 0.37, cy: -0.61, b: 0.05, marks: [[-1.01, -0.79, -0.73, -0.711], [-1.01, -0.90, -0.665, -0.648]] });
  plate({ x: 1.24, y: 0.23, z: 0.41, cy: -0.062, b: 0.045, marks: [[0.70, 1.03, -0.18, -0.162], [0.86, 1.03, -0.119, -0.102], [0.92, 1.03, -0.058, -0.041]] });
  plate({ x: 1.09, y: 0.040, z: 0.305, cy: 0.207, b: 0.013, s: 1 });
  plate({ x: 1.27, y: 0.28, z: 0.44, cy: 0.527, b: 0.054, marks: [[-0.98, -0.72, 0.424, 0.446], [-0.98, -0.83, 0.490, 0.508], [-0.98, -0.89, 0.555, 0.573]] });
  const g = new T.BufferGeometry();
  for (const [name, data, size] of [['position', pos, 3], ['aSeam', seam, 1], ['aGold', gold, 1], ['uv', uv, 2]]) {
    g.setAttribute(name, new T.Float32BufferAttribute(data, size));
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export const vertexShader = /* glsl */`
attribute float aSeam;
attribute float aGold;
varying float vSeam, vGold;
varying vec3 vLocal, vNormalView, vEye;
void main() {
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  vLocal = position;
  vNormalView = normalMatrix * normal;
  vEye = -p.xyz;
  vSeam = aSeam;
  vGold = aGold;
  gl_Position = projectionMatrix * p;
}`;

export const fragmentShader = /* glsl */`
uniform vec3 uStone, uEdge, uGold, uFlame;
uniform float uPulse;
varying float vSeam, vGold;
varying vec3 vLocal, vNormalView, vEye;
float aa(float x) {
  #ifdef AK_FIXED_AA
    return 0.008;
  #else
    return max(fwidth(x), 0.003);
  #endif
}
void main() {
  vec3 N = normalize(vNormalView), V = normalize(vEye);
  vec3 R = reflect(-V, N);
  float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  float lit = max(dot(N, normalize(vec3(-0.45, 0.85, 0.57))), 0.0);
  float delta = abs(R.x + 0.35 * R.y - 0.16);
  float strip = exp(-delta * delta * 17.0) * (0.28 + 0.72 * smoothstep(-0.7, 0.75, R.y));
  vec3 col = uStone * (0.78 + 1.32 * lit) + uEdge * (0.54 * fresnel + 0.72 * strip);
  float d = abs(vLocal.y - 0.621);
  float a = aa(vLocal.y);
  float hair = (1.0 - smoothstep(0.003, 0.003 + a, d))
    * smoothstep(-0.90, -0.86, vLocal.x)
    * (1.0 - smoothstep(0.62, 0.66, vLocal.x))
    * step(0.438, vLocal.z);
  col = mix(col, uGold * (0.25 + 0.75 * lit), max(vGold, 0.35 * hair));
  float seamBoost = 0.24 + 0.62 * lit + 0.42 * uPulse;
  col = mix(col, uFlame * seamBoost + uEdge * fresnel * 0.18, vSeam);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor.rgb = clamp(gl_FragColor.rgb + (noise - 0.5) / 255.0, 0.0, 1.0);
}`;

// Concept A Desktop Alternate — Bounded Single-Pass Raymarched SDF Obsidian Monolith (AABB bound, 64 steps).
export const sdfVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const sdfFragmentShader = /* glsl */`
uniform vec2 uRes;
uniform vec2 uRot;
uniform float uPulse;
uniform vec3 uStone, uEdge, uGold, uFlame;
varying vec2 vUv;

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float mapMonolith(vec3 p) {
  float slab = sdRoundBox(p, vec3(0.76, 0.96, 0.30), 0.055);
  float groove = max(abs(p.y - 0.16) - 0.022, -(abs(p.z) - 0.25));
  return max(slab, -groove);
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(0.0012, -0.0012);
  return normalize(
    e.xyy * mapMonolith(p + e.xyy) +
    e.yyx * mapMonolith(p + e.yyx) +
    e.yxy * mapMonolith(p + e.yxy) +
    e.xxx * mapMonolith(p + e.xxx)
  );
}

vec2 intersectAABB(vec3 ro, vec3 rd, vec3 rad) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-rad - ro) * inv;
  vec3 t1 = (rad - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / max(1.0, min(uRes.x, uRes.y));
  vec3 ro = vec3(0.0, 0.0, 3.35);
  vec3 rd = normalize(vec3(p * 0.92, -1.35));

  mat2 ry = rot2(uRot.y), rx = rot2(uRot.x);
  ro.yz = rx * ro.yz; rd.yz = rx * rd.yz;
  ro.xz = ry * ro.xz; rd.xz = ry * rd.xz;

  vec2 hit = intersectAABB(ro, rd, vec3(0.95, 1.15, 0.50));
  if (hit.y < 0.0 || hit.x > hit.y) { gl_FragColor = vec4(0.0); return; }

  float t = max(0.0, hit.x);
  bool found = false;
  for (int i = 0; i < 64; i++) {
    float d = mapMonolith(ro + rd * t);
    if (d < 0.0015) { found = true; break; }
    t += d;
    if (t > hit.y) break;
  }
  if (!found) { gl_FragColor = vec4(0.0); return; }

  vec3 pos = ro + rd * t;
  vec3 N = calcNormal(pos);
  vec3 V = -rd;
  vec3 R = reflect(rd, N);
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - NoV, 4.5);
  float lit = max(dot(N, normalize(vec3(-0.45, 0.85, 0.57))), 0.0);
  float strip = exp(-pow(R.x + 0.32 * R.y - 0.14, 2.0) * 16.0);

  // Subtle subpixel edge dispersion approximation without multi-march cost.
  vec3 disp = vec3(
    pow(1.0 - NoV, 5.2) * 0.12,
    pow(1.0 - NoV, 4.6) * 0.08,
    pow(1.0 - NoV, 4.0) * 0.16
  );

  vec3 col = uStone * (0.72 + 1.25 * lit) + uEdge * (0.58 * fresnel + 0.65 * strip) + disp * uEdge;

  float seamMask = smoothstep(0.032, 0.012, abs(pos.y - 0.16)) * step(0.18, abs(pos.z));
  col = mix(col, uFlame * (0.35 + 0.65 * lit + 0.45 * uPulse), seamMask * 0.92);

  float tickY = abs(fract((pos.y + 0.52) * 14.0) - 0.5);
  float goldTick = (1.0 - smoothstep(0.02, 0.06, tickY))
    * step(0.42, pos.x) * step(pos.x, 0.64)
    * step(0.28, pos.z) * step(abs(pos.y - 0.16), 0.55);
  col = mix(col, uGold * (0.35 + 0.65 * lit), goldTick * 0.65);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor.rgb = clamp(gl_FragColor.rgb + (noise - 0.5) / 255.0, 0.0, 1.0);
}`;

export function mountHero(clock, wrap = document.querySelector('#hero-orb-wrap')) {
  const canvas = wrap?.querySelector('#armillary-canvas');
  if (!canvas) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 800px)');
  const life = new AbortController(), signal = life.signal;
  let T, renderer, scene, camera, mesh, sdfScene, sdfCamera, sdfMesh, unsubscribe;
  let disposed = false, lost = false, failed = false, mode = 'prism';
  let visible = false, px = 0, py = 0, yaw = 0, pitch = 0, tilt = 0, pulse = 0;
  let active = 0, bad = 0, ewma = 16.7, resized = true;
  let dpr = Math.min(1.5, Math.max(1, devicePixelRatio || 1));

  // Optional desktop-only WebGL2 switcher (01 PRISM / 02 SDF) mounted inside #top so it stays clickable above pointer-events-none wrap.
  let switcher = null;
  const heroSection = wrap.closest('#top') || wrap.parentElement;
  if (heroSection && !heroSection.querySelector('.ak-hero-switch')) {
    switcher = document.createElement('div');
    switcher.className = 'ak-hero-switch';
    switcher.hidden = true;
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Hero monument shader mode');
    switcher.innerHTML = `<button type="button" data-hero-mode="prism" aria-pressed="true">01 Prism</button><button type="button" data-hero-mode="sdf" aria-pressed="false">02 SDF</button>`;
    heroSection.append(switcher);
    switcher.addEventListener('click', e => {
      const btn = e.target.closest('[data-hero-mode]');
      if (!btn || !desktop.matches || reduced.matches) return;
      mode = btn.dataset.heroMode === 'sdf' ? 'sdf' : 'prism';
      switcher.querySelectorAll('[data-hero-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.heroMode === mode)));
      resized = true;
      wake();
    }, { signal });
  }

  const syncSwitch = ok => {
    if (switcher) switcher.hidden = !(ok && desktop.matches && !reduced.matches);
    if (!desktop.matches && mode !== 'prism') {
      mode = 'prism';
      switcher?.querySelectorAll('[data-hero-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.heroMode === 'prism')));
    }
  };

  const show = ok => {
    wrap.classList.toggle('ak-hero-live', ok);
    syncSwitch(ok);
  };
  const wake = () => { active = performance.now(); };
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; bad = 0; wake(); });
  io.observe(wrap);
  const ro = new ResizeObserver(() => { resized = true; wake(); });
  ro.observe(wrap);

  // Bind pointer tracking to window because #hero-orb-wrap intentionally uses pointer-events-none over hero copy.
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || !visible) return;
    px = Math.max(-1, Math.min(1, (2 * e.clientX) / Math.max(1, window.innerWidth) - 1));
    py = Math.max(-1, Math.min(1, (2 * e.clientY) / Math.max(1, window.innerHeight) - 1));
    wake();
  }, { passive: true, signal });
  document.addEventListener('pointerleave', () => { px = 0; py = 0; wake(); }, { signal });
  document.addEventListener('visibilitychange', () => { bad = 0; ewma = 16.7; wake(); }, { signal });
  desktop.addEventListener('change', () => { syncSwitch(wrap.classList.contains('ak-hero-live')); resized = true; wake(); }, { signal });
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; show(false); }, { signal });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; resized = true; bad = 0; ewma = 16.7; wake(); }, { signal });

  function release() {
    unsubscribe?.(); unsubscribe = null;
    mesh?.geometry.dispose(); mesh?.material.dispose();
    sdfMesh?.geometry.dispose(); sdfMesh?.material.dispose();
    renderer?.dispose();
    renderer = mesh = scene = camera = sdfMesh = sdfScene = sdfCamera = null;
  }
  const fail = () => { failed = true; show(false); release(); };

  function frame(dt, s, wall) {
    if (s.direction) wake();
    if (!visible || lost || reduced.matches || document.hidden || performance.now() - active > 5000) {
      bad = 0; ewma = 16.7; return;
    }
    if (wall > 0 && wall < 100) {
      ewma += (wall - ewma) * (1 - Math.exp(-wall / 450));
      bad = ewma > 19 ? bad + wall : 0;
      if (bad >= 2000) {
        bad = 0; ewma = 16.7;
        if (mode === 'sdf') {
          mode = 'prism';
          syncSwitch(true);
        } else if (dpr <= 1) {
          fail(); return;
        } else {
          dpr = Math.max(1, dpr - 0.25); resized = true;
        }
      }
    } else if (wall >= 100 && wall < 500) {
      ewma += (wall - ewma) * 0.2;
      bad += wall;
      if (bad >= 2000) {
        bad = 0; ewma = 16.7;
        if (dpr <= 1) { fail(); return; }
        dpr = Math.max(1, dpr - 0.25); resized = true;
      }
    }
    if (resized) {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      const a = w / h, span = Math.max(1.27, 1.58 / a);
      camera.left = -span * a; camera.right = span * a;
      camera.top = span; camera.bottom = -span;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      sdfMesh.material.uniforms.uRes.value.set(w * dpr, h * dpr);
      resized = false;
    }
    const alpha = 1 - Math.exp(-dt / 0.16);
    const vNorm = Math.max(-1, Math.min(1, s.velocity / 1200));
    yaw += (px * 4.5 * Math.PI / 180 - yaw) * alpha;
    pitch += (py * 2.2 * Math.PI / 180 - pitch) * alpha;
    tilt += (vNorm * 2.2 * Math.PI / 180 - tilt) * alpha;
    pulse += (Math.min(1, Math.abs(vNorm)) - pulse) * alpha;

    if (mode === 'sdf' && desktop.matches) {
      sdfMesh.material.uniforms.uRot.value.set(0.18 + tilt + pitch, -0.36 + yaw);
      sdfMesh.material.uniforms.uPulse.value = pulse;
      renderer.render(sdfScene, sdfCamera);
    } else {
      mesh.material.uniforms.uPulse.value = pulse;
      mesh.rotation.set(0.20 + tilt + pitch, -0.37 + yaw, 0.025);
      renderer.render(scene, camera);
    }
    if (!lost && !failed) show(true);
  }

  async function start() {
    if (disposed || failed || reduced.matches || renderer) return;
    try {
      await afterPaint();
      if (disposed || reduced.matches || renderer) return;
      T = await load('three');
      if (disposed || reduced.matches || renderer || failed) return;
      const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
      if (!context) { fail(); return; }
      renderer = new T.WebGLRenderer({ canvas, context, alpha: true });
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.setClearColor(0, 0);
      renderer.debug.onShaderError = () => { failed = true; show(false); queueMicrotask(release); };

      const colour = hex => ({ value: new T.Color(hex) });
      scene = new T.Scene();
      camera = new T.OrthographicCamera(-2, 2, 1, -1, 0.1, 20);
      camera.position.set(0, 0, 5);
      mesh = new T.Mesh(gaugeGeometry(T), new T.ShaderMaterial({
        vertexShader, fragmentShader, toneMapped: false,
        defines: (navigator.hardwareConcurrency || 8) <= 4 ? { AK_FIXED_AA: 1 } : {},
        uniforms: {
          uStone: colour('#191921'), uEdge: colour('#777680'),
          uGold: colour('#e5a93c'), uFlame: colour('#ff3d00'),
          uPulse: { value: 0 }
        }
      }));
      scene.add(mesh);

      // Concept A desktop SDF fullscreen triangle on the same renderer.
      sdfScene = new T.Scene();
      sdfCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const tri = new T.BufferGeometry();
      tri.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      sdfMesh = new T.Mesh(tri, new T.ShaderMaterial({
        vertexShader: sdfVertexShader, fragmentShader: sdfFragmentShader,
        toneMapped: false, transparent: true, depthWrite: false, depthTest: false,
        uniforms: {
          uRes: { value: new T.Vector2(640, 400) },
          uRot: { value: new T.Vector2(0.20, -0.37) },
          uPulse: { value: 0 },
          uStone: colour('#191921'), uEdge: colour('#777680'),
          uGold: colour('#e5a93c'), uFlame: colour('#ff3d00')
        }
      }));
      sdfScene.add(sdfMesh);

      wake();
      unsubscribe = clock.subscribe(frame);
    } catch { fail(); }
  }

  reduced.addEventListener('change', () => { show(false); wake(); if (!reduced.matches) start(); }, { signal });
  start();
  return () => {
    disposed = true;
    life.abort();
    io.disconnect();
    ro.disconnect();
    switcher?.remove();
    show(false);
    release();
  };
}
