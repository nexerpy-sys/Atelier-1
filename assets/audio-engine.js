import { load } from './loader.js';

const db = n => 10 ** (n / 20);
const duration = { plate: 0.052, tick: 0.012, drawer: 0.048, snap: 0.022, collision: 0.032 };

export function mountAudio({ button = document.querySelector('#nav-audio-btn'), label = document.querySelector('#nav-audio-label') } = {}) {
  const life = new AbortController(), signal = life.signal;
  let ctx, Tone, bus, master, limiter, nativeComp, ceiling, whiteBuf, pinkBuf;
  let enabled = false, busy = false, closed = false, seq = 0, lastCollision = -Infinity;
  const voices = Array.from({ length: 4 }, () => null);

  function ui(text) {
    if (label) label.textContent = text;
    else if (button) button.textContent = text;
    button?.setAttribute('aria-pressed', String(enabled));
    button?.setAttribute('aria-busy', String(busy));
    button?.classList.toggle('is-audio-on', enabled);
  }

  function buildNoiseBuffers() {
    if (whiteBuf) return;
    const len = ctx.sampleRate;
    whiteBuf = ctx.createBuffer(1, len, len);
    pinkBuf = ctx.createBuffer(1, len, len);
    const w = whiteBuf.getChannelData(0), p = pinkBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const n = 2 * Math.random() - 1;
      w[i] = n;
      b0 = 0.99765 * b0 + n * 0.0990460;
      b1 = 0.96300 * b1 + n * 0.2965164;
      b2 = 0.57000 * b2 + n * 1.0526913;
      p[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + n * 0.1848) * 0.14));
    }
  }

  function graph(t) {
    if (master) return;
    bus = ctx.createGain();
    bus.channelCount = 1;
    bus.channelCountMode = 'explicit';
    bus.channelInterpretation = 'discrete';
    master = ctx.createGain();
    master.gain.value = 0;
    // Bounded terminal waveshaper guarantees the -3 dBFS sample ceiling regardless of Tone vs native limiter.
    ceiling = ctx.createWaveShaper();
    ceiling.curve = Float32Array.from({ length: 4097 }, (_, i) => Math.max(-db(-3), Math.min(db(-3), i / 2048 - 1)));
    bus.connect(master);
    if (t) {
      t.setContext(ctx);
      Tone = t;
      limiter = new Tone.Limiter(-3);
      Tone.connect(master, limiter);
      Tone.connect(limiter, ceiling);
    } else {
      nativeComp = ctx.createDynamicsCompressor();
      nativeComp.threshold.value = -12;
      nativeComp.knee.value = 6;
      nativeComp.ratio.value = 12;
      nativeComp.attack.value = 0.003;
      nativeComp.release.value = 0.08;
      master.connect(nativeComp);
      nativeComp.connect(ceiling);
    }
    ceiling.connect(ctx.destination);
    buildNoiseBuffers();
  }

  function mute() {
    seq++;
    enabled = busy = false;
    ui('Sound off');
    if (!ctx || ctx.state === 'closed') return;
    if (master) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0, t);
    }
    for (let i = 0; i < 4; i++) {
      const v = voices[i];
      if (v) {
        v.out.disconnect();
        for (const s of v.sources) try { s.stop(ctx.currentTime); } catch {}
        voices[i] = null;
      }
    }
    void ctx.suspend().catch(() => {});
  }

  function toggle() {
    if (closed) return;
    if (enabled || busy) { mute(); return; }
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) { ui('Sound unavailable'); return; }
    let resume;
    try {
      ctx ??= new Audio({ latencyHint: 'interactive' });
      resume = ctx.resume();
    } catch { ui('Sound unavailable'); return; }
    const id = ++seq;
    busy = true;
    ui('Enabling sound');
    // Load Tone.js lazily when online; seamlessly fall back to native Web Audio DynamicsCompressor if CDN is blocked.
    const toneOrNull = load('tone').catch(() => null);
    void Promise.all([resume, toneOrNull]).then(([, t]) => {
      if (id !== seq || closed || document.hidden || !document.hasFocus()) return;
      if (ctx.state !== 'running') throw new Error('Audio context not running');
      graph(t);
      master.gain.setValueAtTime(db(-18), ctx.currentTime);
      enabled = true; busy = false; ui('Sound on');
    }).catch(() => { if (id === seq) { mute(); ui('Sound unavailable'); } });
  }

  function play(kind, { open = true, normalSpeed = 0 } = {}) {
    if (!enabled || !ctx || ctx.state !== 'running' || !Object.hasOwn(duration, kind)) return false;
    const now = ctx.currentTime;
    if (kind === 'collision') {
      if (!Number.isFinite(normalSpeed) || normalSpeed < 0.35 || now - lastCollision < 0.05) return false;
      lastCollision = now;
    }
    let i = voices.findIndex(v => !v || v.end <= now);
    let time = now;
    if (i < 0) {
      i = voices.reduce((a, v, j) => (v.start < voices[a].start ? j : a), 0);
      const v = voices[i], gain = v.out.gain;
      time = now + 0.002;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(1, now);
      gain.linearRampToValueAtTime(0, time);
      for (const s of v.sources) try { s.stop(time); } catch {}
    }
    const out = ctx.createGain();
    out.connect(bus);
    const v = { out, sources: [], start: time, end: time + duration[kind] };
    voices[i] = v;
    const detune = 0.98 + Math.random() * 0.04;

    function layer(type, f0, f1, seconds, peak, offset = 0, q = 1, pink = false) {
      const t = time + offset, stop = t + seconds, sine = type === 'sine';
      const src = sine ? ctx.createOscillator() : ctx.createBufferSource();
      const shape = ctx.createGain();
      shape.gain.setValueAtTime(0, t);
      shape.gain.linearRampToValueAtTime(peak, t + Math.min(0.001, seconds / 3));
      shape.gain.linearRampToValueAtTime(0, stop);
      let filter;
      if (sine) { src.type = 'sine'; src.connect(shape); }
      else {
        src.buffer = pink ? pinkBuf : whiteBuf;
        filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.Q.value = q;
        src.connect(filter);
        filter.connect(shape);
      }
      const f = sine ? src.frequency : filter.frequency;
      f.setValueAtTime(f0 * detune, t);
      if (f1 !== f0) f.exponentialRampToValueAtTime(f1 * detune, stop);
      shape.connect(out);
      v.sources.push(src);
      if (sine) src.start(t); else src.start(t, Math.random() * 0.85);
      src.stop(stop);
      src.onended = () => {
        src.disconnect(); filter?.disconnect(); shape.disconnect();
        const j = v.sources.indexOf(src);
        if (j >= 0) v.sources.splice(j, 1);
        if (!v.sources.length) {
          out.disconnect();
          if (voices[i] === v) voices[i] = null;
        }
      };
    }

    switch (kind) {
      case 'plate':
        layer('sine', 310, 145, 0.048, 0.12);
        layer('bandpass', 3800, 3800, 0.005, 0.055, 0, 3.2, true);
        layer('sine', 2700, 2700, 0.011, 0.022, 0.001);
        break;
      case 'tick':
        layer('bandpass', 5600, 5600, 0.0085, 0.055, 0, 5.5, false);
        layer('sine', 3350, 3350, 0.0075, 0.042, 0.0002);
        break;
      case 'drawer':
        layer('bandpass', open ? 520 : 2400, open ? 2400 : 520, 0.042, 0.055, 0, 0.9, true);
        layer('sine', 760, 760, 0.028, 0.022, 0.002);
        break;
      case 'snap':
        layer('highpass', 3200, 3200, 0.004, 0.08, 0, 1.0, false);
        layer('sine', 1900, 1900, 0.011, 0.032, 0.0005);
        layer('sine', 3800, 3800, 0.007, 0.022, 0.011);
        break;
      case 'collision': {
        const u = Math.max(0, Math.min(1, (normalSpeed - 0.35) / 7.65));
        const peak = 0.024 + 0.115 * u * u;
        const fTone = 210 * Math.pow(2, 0.8 * u);
        layer('sine', fTone, fTone * 0.72, 0.028, peak * 0.72);
        layer('bandpass', 1800 + 4200 * u, 1800 + 4200 * u, 0.012, peak * 0.38, 0, 1.4 + 3 * u, false);
        break;
      }
    }
    return true;
  }

  button?.addEventListener('click', toggle, { signal });
  window.addEventListener('blur', mute, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) mute(); }, { signal });
  ui('Sound off');

  return {
    play,
    destroy() {
      closed = true;
      life.abort();
      mute();
      limiter?.dispose();
      nativeComp?.disconnect();
      ceiling?.disconnect();
      if (ctx) void ctx.close().catch(() => {});
    }
  };
}
