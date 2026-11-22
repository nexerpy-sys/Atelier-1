import { mountKinetik } from './kinetik-v27.js';

(function () {
      "use strict";
      const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const resourceCards = new Map();
      let swarmRef = null;

      function normaliseRegistry(reg) {
        const out = [];
        const add = (r) => out.push(r);
        (reg.typography?.fonts || []).forEach((f, i) => add({
          id: `font-${i + 1}`, name: f.name, category: "Typefaces",
          technique: f.category || "Typography", dependencies: ["Google Fonts"],
          description: f.bestFor || "", sources: { css: { text: `/* ${f.name} */
@import url('${f.css2 || ""}');` } },
          _view: "home", _anchor: "#registry"
        }));
        (reg.typography?.pairings || []).forEach((p, i) => add({
          id: `pair-${p.id || i + 1}`, name: p.name, category: "Font pairings",
          technique: "Typography pairing", dependencies: ["Google Fonts"],
          description: p.use || "", sources: { css: { text: `/* ${p.name} */
/* Display: ${p.display} · Body: ${p.body} · Mono: ${p.mono} */` } },
          _view: "home", _anchor: "#registry"
        }));
        (reg.typography?.typeScale?.scales || []).forEach((sc, i) => add({
          id: `scale-${sc.id || i + 1}`, name: sc.name || `Type Scale ${i + 1}`, category: "Type scales",
          technique: "Fluid clamp()", dependencies: [],
          description: sc.note || "Fluid viewport type scale", sources: { css: { text: JSON.stringify(sc, null, 2) } },
          _view: "home", _anchor: "#registry"
        }));
        (reg.color?.systems || []).forEach((sys, i) => add({
          id: `sys-${sys.id || i + 1}`, name: sys.name, category: "Colour systems",
          technique: sys.mode || "Semantic tokens", dependencies: [],
          description: sys.role || "", sources: { css: { text: JSON.stringify(sys.tokens || {}, null, 2) } },
          _view: "systems"
        }));
        (reg.motion?.easings || []).forEach((ea, i) => add({
          id: `law-${ea.id || i + 1}`, name: ea.name, category: "Motion laws",
          technique: ea.kind || "cubic-bezier", dependencies: [],
          description: ea.use || "", sources: { css: { text: ea.css || `cubic-bezier(${(ea.cubicBezier || []).join(", ")})` } },
          _view: "home", _anchor: "#easings"
        }));
        Object.values(reg.snippets || {}).forEach((sn) => add({
          id: `mi-${sn.id}`, name: sn.name, category: "Micro-interactions",
          technique: sn.category || "Interaction", dependencies: [],
          description: sn.description || "", sources: { html: { text: sn.code || "" } },
          _view: "motion"
        }));
        (reg.templates || []).forEach((t) => add({
          id: `tpl-${t.id}`, name: t.name, category: "Section templates",
          technique: "HTML/CSS layout", dependencies: t.dependencies && t.dependencies !== "none" ? [t.dependencies] : [],
          description: t.bestFor || "", sources: { html: `./${String(t.file || "").replace(/^\/+/, "")}` },
          _view: "templates"
        }));
        (reg.fx || []).forEach((fx) => add({
          id: `fx-${fx.id}`, name: fx.name, category: "Canvas FX",
          technique: fx.engine || "Canvas 2D", dependencies: fx.dependencies && fx.dependencies !== "none" ? [fx.dependencies] : [],
          description: fx.bestFor || "", sources: { html: `./${String(fx.file || "").replace(/^\/+/, "")}` },
          _view: "fx"
        }));
        (reg.motionGraphics || []).forEach((mg) => add({
          id: `mg-${mg.id}`, name: mg.name, category: "Motion graphics",
          technique: [mg.engine, ...(mg.tags || [])].filter(Boolean),
          dependencies: mg.dependencies && mg.dependencies !== "none" ? String(mg.dependencies).split(/[+,]/).map((s) => s.trim()).filter(Boolean) : [],
          description: mg.bestFor || mg.math || "",
          sources: { html: `./${String(mg.file || "").replace(/^\/+/, "")}` },
          _view: "mg"
        }));
        return out;
      }

      async function jumpToResource(record) {
        if (record._view && typeof window.__akNavigate === "function") {
          window.__akNavigate(record._view, true);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
        const card = resourceCards.get(String(record.id));
        if (card && card.isConnected) return card;
        if (record._anchor) {
          const sec = document.querySelector(record._anchor);
          if (sec) return sec;
        }
        return document.getElementById("ak-explorer") || document.querySelector("main");
      }

      const ak = window.__akKinetik = mountKinetik({
        registry: "./registry.json",
        normalise: normaliseRegistry,
        jump: jumpToResource,
        frameSwarm(dtSec, scroll) {
          if (swarmRef && swarmRef.started) swarmRef.frame(dtSec * 1000, scroll);
        }
      });

      /* ==============================================================
         1. SHARED CLOCK BRIDGE & ADAPTIVE QUALITY ENGINE (v2.8)
         ============================================================== */
      const subs = new Set();
      let ema = 16.7;
      let slowFrames = 0;
      const isLowMem = typeof navigator !== "undefined" && navigator.deviceMemory && navigator.deviceMemory <= 2;
      const isSmallTouch = window.innerWidth < 768 && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

      const ticker = {
        quality: isLowMem ? 0 : isSmallTouch ? 1 : 2,
        fps: 60,
        onQuality: new Set(),
        add(fn) {
          subs.add(fn);
          return () => subs.delete(fn);
        },
      };

      ak.clock.subscribe((dtSec, _s, wall) => {
        const raw = wall || dtSec * 1000 || 16.7;
        if (raw > 0 && raw < 200) {
          ema += (raw - ema) * 0.06;
          ticker.fps = Math.min(120, Math.round(1000 / ema));
          slowFrames = ema > 26 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
          if (slowFrames > 75 && ticker.quality > 0) {
            ticker.quality -= 1;
            slowFrames = 0;
            ema = 16.7;
            ticker.onQuality.forEach((fn) => fn(ticker.quality));
          }
        }
        const dt = Math.min(Math.max(raw, 1), 34);
        const now = performance.now();
        subs.forEach((fn) => fn(dt, now));
      });

      /* ==============================================================
         2. TOAST & CLIPBOARD UTILITY (SANDBOX SAFE)
         ============================================================== */
      const toastEl = document.getElementById("ak-toast");
      let toastTimer = 0;
      function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2000);
      }

      function copyText(text, label) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            () => { showToast(`${label} copied`); ak.audio.play("snap"); },
            () => fallbackCopy(text, label)
          );
        } else {
          fallbackCopy(text, label);
        }
      }

      function fallbackCopy(text, label) {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          showToast(`${label} copied`);
        } catch (_) {
          showToast("Copy unavailable");
        }
      }

      const LLMS_SPEC = `# Atelier Kinetik

> Atelier Kinetik is a curated reference of frontend design and implementation
> resources for developers and AI coding agents. It contains 183 resources in
> nine categories. It is a static reference site. It is not a website
> generator, a chatbot, an API or a package registry.

Version: 2.8.0

## What this site provides

- Typefaces: 60 Google Fonts selected for interface and editorial use
- Font pairings: 24 studio pairings with a role assigned to each face
- Type scales: 3 fluid typography scales
- Colour systems: 6 semantic colour systems with colour scales and tokens
- Motion laws: 12 named rules for duration, easing and spring behaviour
- Micro-interactions: 24 production interaction patterns
- Section templates: 8 reusable page sections
- Canvas FX: 16 effects rendered to a canvas element
- Computational motion graphics: 30 simulation, solver and shader pieces

## Who it is for

- AI coding agents building or modifying websites
- Frontend developers, UI/UX designers and creative developers

## Where to start

- llms.txt : this file. Orientation only.
- registry.json : the primary structured manifest. Every resource is listed
  here with its category, description and file location. Read this before
  fetching anything else.
- index.html : the human-facing homepage with live previews and source inspection.
- README.md : repository overview and AI implementation principles.

There is no API and no search endpoint. All content is static files.

## How to retrieve a resource

1. Fetch registry.json.
2. Select the category that matches the task.
3. Read the entries in that category and choose by description, not by name.
4. Fetch the file or files listed for the chosen resource.
5. Read the whole file before using any part of it.

## How to identify dependencies

- Use the dependency information in the registry entry where it is present.
- Also read the resource file itself: check script tags, import statements
  and stylesheet links.
- Some motion resources (26..30) depend on Three.js or GSAP.
- The showcase homepage uses GSAP, Lenis, Three.js, Tone.js, Matter.js and Prism.js via CDN.
- Typefaces load from Google Fonts.
- Do not assume a resource is dependency-free unless its entry and its source
  both show that.

## How to adapt a resource to an existing project

1. Inspect the target project first: framework, styling method, existing
   tokens for type, colour, spacing and motion.
2. Use the target project's tokens. Replace the resource's fonts, colours,
   radii and durations with the project's own unless the user asked for the
   resource's look.
3. Take the smallest part that does the job. Do not import a whole file to
   use one function or one rule.
4. Do not add a library the project does not already use without telling the
   user. If a resource needs Three.js or GSAP, say so before adding it.
5. Preserve responsive behaviour, focus states, keyboard handling and
   prefers-reduced-motion handling.
6. Do not copy preview scaffolding or demo controls into the target project.

## Status and limits

- Resources are references. Some are demonstrations, not hardened production
  code. Review, test and adjust before shipping.
- Licensing: Code MIT. Typefaces (OFL via Google Fonts) and third-party
  libraries remain under their own licences.

## Agentic Build

The homepage includes an animation called Agentic Build. It is a
choreographed visual demonstration of a website being assembled. It does not
generate source code and is not an AI system. Do not describe it as one.
`;

      /* ==============================================================
         3. POPULATE DYNAMIC DOM BEFORE SWARM SCANS
         ============================================================== */
      const AGENTS = [
        { roman: "I", name: "Prometheus", color: "#FF3D00", epithet: "Fire-bringer", role: "Architect of structure", likes: ["box"], ease: [0.16, 1, 0.3, 1], craft: "Frames every surface with a crosshair and snaps it to the grid.", sigil: "M1 2 H9 L5 9 Z", sigilDot: [4.5, 3.5, 1, 2] },
        { roman: "II", name: "Athena", color: "#F4F2EC", epithet: "Kerning oracle", role: "Typographer", likes: ["text", "rise"], ease: [0.33, 1, 0.68, 1], craft: "Sets each line of type along a caret, one measure at a time.", sigil: "M1 1 V9 M9 1 V9 M5 3 L7 5 L5 7 L3 5 Z" },
        { roman: "III", name: "Daedalus", color: "#B89B6A", epithet: "Labyrinth maker", role: "Vector & hairline master", likes: ["line"], ease: [0.65, 0, 0.35, 1], craft: "Rules the hairlines and dividers with a single pen stroke.", sigil: "M1 9 V1 H9 M4 9 V4 H9 M1 6 H4" },
        { roman: "IV", name: "Hermes", color: "#B4B9C4", epithet: "Velocity courier", role: "Carrier of easing", likes: ["box", "text"], ease: [0.22, 1, 0.36, 1], craft: "Takes whatever is next in the queue and gets there first.", sigil: "M1 9 L4 6 M6 4 L9 1 M5 1 H9" },
        { roman: "V", name: "Chronos", color: "#7D8590", epithet: "Frame keeper", role: "Sequencer of time", likes: ["fade", "rise"], ease: [0.76, 0, 0.24, 1], craft: "Places media and holds the baseline until the headline rises.", sigil: "M2 1 H8 L2 9 H8 Z" },
        { roman: "VI", name: "Iris", color: "#CFCBC2", epithet: "Token messenger", role: "Colour systems", likes: ["fade", "box"], ease: [0.25, 1, 0.5, 1], craft: "Carries semantic colour between light and dark surfaces.", sigil: "M2 1 V9 M2 5 L9 2 M2 5 L9 8" },
        { roman: "VII", name: "Nyx", color: "#6A6E7A", epithet: "Night keeper", role: "Dark surfaces", likes: ["box"], ease: [0.5, 1, 0.89, 1], craft: "Lays down obsidian panels and their quiet borders.", sigil: "M1 5 H9", sigilEclipse: true },
        { roman: "VIII", name: "Hephaestus", color: "#9E7B4F", epithet: "Forge master", role: "Component smith", likes: ["line", "box"], ease: [0.34, 1.56, 0.64, 1], craft: "Hammers buttons, pills and controls into shape.", sigil: "M1 5 V2 H9 V5 M3 8 V5 H7 V8 M1 8 H9" },
      ];
      const VERBS = { box: "FRAME", text: "KERN", line: "RULE", rise: "DRAFT", fade: "PLACE", select: "EXCISE" };
      const curveD = ([a, b, c, d]) => `M0 100 C${a * 100} ${100 - b * 100} ${c * 100} ${100 - d * 100} 100 0`;

      // Editorial Marquee
      const MARQUEE_WORDS = ["Atelier Kinetik", "183 resources", "9 categories", "30 motion graphics", "Three.js · GSAP · Lenis", "Live preview & source"];
      const logoSvg = `<svg viewBox="0 0 32 32" class="h-8 w-8 text-[var(--flame)] sm:h-12 sm:w-12 shrink-0" aria-hidden="true"><circle cx="16" cy="16" r="10.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="54 12" transform="rotate(-38 16 16)"/><path d="M16 1.5v7M16 23.5v7M1.5 16h7M23.5 16h7" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 21.5 22 10l-4.2 8.6Z" fill="#FF3D00"/></svg>`;
      const marqueeRow = MARQUEE_WORDS.map((w, i) =>
        `<span class="flex items-center gap-10 pr-10"><span class="${i % 2 ? "f-serif italic text-[var(--ink)]" : "f-display font-extrabold uppercase text-transparent [-webkit-text-stroke:1px_rgba(244,242,236,.45)]"}">${w}</span>${logoSvg}</span>`
      ).join("");
      document.getElementById("marquee-track").innerHTML = marqueeRow + marqueeRow;

      // Pantheon 7 remaining agents + Rule of the house
      const pantheonGrid = document.getElementById("pantheon-grid");
      AGENTS.slice(1).forEach((ag) => {
        const el = document.createElement("article");
        el.setAttribute("data-build", "box");
        el.className = "cell spot agent-card group relative flex min-h-[248px] flex-col justify-between p-6";
        el.style.setProperty("--tint", ag.color);
        const sigilSvg = ag.sigilEclipse
          ? `<circle cx="5" cy="5" r="3.5" fill="none" stroke="#9A9DA6" stroke-width="1"/><path d="M1.5 5 A3.5 3.5 0 0 0 8.5 5 Z" fill="#6A6E7A"/><path d="M1 5 H9" stroke="#F4F2EC" stroke-width="1"/>`
          : `<path d="${ag.sigil}" fill="none" stroke="${ag.color}" stroke-width="1.15" stroke-linecap="square" stroke-linejoin="miter"/>`;
        el.innerHTML = `
          <div class="flex items-start justify-between">
            <span data-build="text" class="f-mono flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
              <svg viewBox="0 0 10 10" class="h-3 w-3 shrink-0" aria-hidden="true">${sigilSvg}</svg>
              ${ag.roman} · ${ag.epithet}
            </span>
            <svg viewBox="0 0 32 32" class="agent-cursor-svg h-8 w-8" aria-hidden="true" data-cursor="${ag.name}"></svg>
          </div>
          <div>
            <h3 data-build="text" class="f-display text-2xl font-bold text-[var(--ink)] sm:text-3xl">${ag.name}</h3>
            <p data-build="text" class="mt-2 text-sm leading-relaxed text-[var(--muted)]">${ag.craft}</p>
            <div class="mt-5 flex items-end justify-between">
              <span data-build="text" class="f-mono text-[10px] uppercase tracking-[0.16em]" style="color:${ag.color}">${ag.role}</span>
              <div data-build="fade">
                <svg viewBox="-4 -40 108 150" class="h-12 w-14 overflow-visible" aria-hidden="true">
                  <path d="M0 100H100M0 100V0" stroke="rgba(244,242,236,.14)" fill="none" />
                  <path class="agent-curve-path" d="${curveD(ag.ease)}" fill="none" stroke="${ag.color}" stroke-width="2.2" stroke-linecap="square" />
                </svg>
              </div>
            </div>
          </div>`;
        pantheonGrid.appendChild(el);
      });
      const houseRule = document.createElement("article");
      houseRule.setAttribute("data-build", "box");
      houseRule.className = "cell flex min-h-[248px] flex-col justify-between p-6";
      houseRule.innerHTML = `
        <span data-build="text" class="f-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Rule of the house</span>
        <p data-build="text" class="f-serif text-3xl italic leading-tight text-[var(--ink)]">No agent draws a straight line to anything.</p>`;
      pantheonGrid.appendChild(houseRule);

      // Registry Color Swatches
      const SYSTEMS = [
        ["Obsidian", ["#070709", "#12121A", "#8E8D8A", "#F4F2EC", "#FF3D00"]],
        ["Paper", ["#F4F2EC", "#ECE9E0", "#85847F", "#0E0E10", "#FF3D00"]],
        ["Aegean", ["#06121A", "#0D2430", "#6FA3B8", "#E6F7FF", "#00F0FF"]],
      ];
      const swatchRoot = document.getElementById("swatch-systems");
      SYSTEMS.forEach(([name, hexes]) => {
        const row = document.createElement("div");
        row.setAttribute("data-build", "fade");
        row.className = "flex h-9 overflow-hidden rounded-md border border-[var(--line)]";
        hexes.forEach((h) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.title = `${name} ${h}`;
          btn.setAttribute("aria-label", `Copy ${h}`);
          btn.className = "swatch h-full flex-1";
          btn.style.background = h;
          btn.addEventListener("click", () => copyText(h, h));
          row.appendChild(btn);
        });
        swatchRoot.appendChild(row);
      });

      // Motion Law Analytical Lab is mounted by kinetik-v27.js (motion-lab.js)

      // Live Forge 3 Looping Plates
      const BARS = [34, 62, 48, 88, 56, 72, 40, 94, 66, 52, 80, 44, 70, 58, 86, 38, 64, 50];
      const FORGE_NAMES = ["Orbital player", "Pricing oracle", "Type specimen"];
      const FORGE_TEMPLATES = [
        () => `
          <div data-build="box" class="stage-card w-full rounded-2xl p-6">
            <p data-build="text" class="f-mono text-[10px] uppercase tracking-[0.2em] text-[var(--flame)]">Now sequencing</p>
            <p data-build="text" class="f-display mt-2 text-2xl font-bold text-[var(--ink)]">Orbital Player</p>
            <div data-build="fade" class="mt-6 flex h-20 items-end gap-[5px]">
              ${BARS.map((h, i) => `<span class="wave-bar flex-1 rounded-sm bg-[var(--ink)]" style="height:${h}%;animation-delay:${(i * -0.13).toFixed(2)}s"></span>`).join("")}
            </div>
            <div data-build="line" class="mt-6 h-[3px] w-full rounded bg-[var(--line-strong)]"><div class="h-full w-2/5 rounded bg-[var(--flame)]"></div></div>
            <div class="mt-6 flex flex-wrap items-center gap-2 sm:gap-3">
              <span data-build="box" class="grid h-9 w-9 sm:h-11 sm:w-11 place-items-center rounded-full bg-[var(--ink)] text-[var(--bg)]"><svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg></span>
              <span data-build="box" class="grid h-9 w-9 sm:h-11 sm:w-11 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink)]"><svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></span>
              <span data-build="box" class="grid h-9 w-9 sm:h-11 sm:w-11 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink)]"><svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg></span>
              <span data-build="text" class="f-mono ml-auto text-[11px] text-[var(--muted)]">01:42 / 04:14</span>
            </div>
          </div>`,
        () => `
          <div data-build="box" class="stage-card w-full rounded-2xl p-6">
            <div class="flex items-center justify-between">
              <p data-build="text" class="f-mono text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]">Tier · Olympian</p>
              <span data-build="box" class="f-mono rounded-full bg-[var(--gold)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--bg)]">Most chosen</span>
            </div>
            <p data-build="text" class="f-display mt-5 text-6xl font-extrabold text-[var(--ink)]">$48<span class="f-serif text-2xl font-normal italic text-[var(--muted)]"> / seat</span></p>
            <div data-build="line" class="my-6 h-px w-full bg-[var(--line-strong)]"></div>
            <p data-build="text" class="mb-3 flex items-center gap-3 text-sm text-[var(--ink)]"><span class="h-1.5 w-1.5 rounded-full bg-[var(--flame)]"></span>All 183 indexed resources</p>
            <p data-build="text" class="mb-3 flex items-center gap-3 text-sm text-[var(--ink)]"><span class="h-1.5 w-1.5 rounded-full bg-[var(--flame)]"></span>Master AI prompt export</p>
            <p data-build="text" class="mb-3 flex items-center gap-3 text-sm text-[var(--ink)]"><span class="h-1.5 w-1.5 rounded-full bg-[var(--flame)]"></span>Bezier &amp; spring studio</p>
            <span data-build="box" class="mt-4 block rounded-full bg-[var(--flame)] py-3.5 text-center text-sm font-semibold text-white">Claim the tier</span>
          </div>`,
        () => `
          <div data-build="box" class="stage-card w-full rounded-2xl p-6">
            <div class="flex items-end justify-between">
              <p data-build="text" class="f-serif text-[5.2rem] italic leading-[0.8] text-[var(--ink)] sm:text-[7rem]">Ag</p>
              <p data-build="text" class="f-mono pb-2 text-right text-[10px] uppercase leading-relaxed tracking-[0.18em] text-[var(--muted)]">Instrument Serif<br />Italic · 400</p>
            </div>
            <div data-build="line" class="my-6 h-px w-full bg-[var(--line-strong)]"></div>
            <div class="mb-4"><p data-build="text" class="f-mono flex flex-wrap justify-between gap-1 text-[10px] text-[var(--muted)] sm:text-[11px]"><span class="text-[var(--ink)]">Display</span>clamp(2.9rem, 8vw, 7rem)</p><div data-build="line" class="mt-2 h-1 w-full rounded bg-[var(--cyan)]"></div></div>
            <div class="mb-4"><p data-build="text" class="f-mono flex flex-wrap justify-between gap-1 text-[10px] text-[var(--muted)] sm:text-[11px]"><span class="text-[var(--ink)]">Heading</span>clamp(1.9rem, 4vw, 3.2rem)</p><div data-build="line" class="mt-2 h-1 w-3/4 rounded bg-[var(--cyan)]"></div></div>
            <div><p data-build="text" class="f-mono flex flex-wrap justify-between gap-1 text-[10px] text-[var(--muted)] sm:text-[11px]"><span class="text-[var(--ink)]">Body</span>clamp(1rem, 1.1vw, 1.125rem)</p><div data-build="line" class="mt-2 h-1 w-1/2 rounded bg-[var(--cyan)]"></div></div>
          </div>`,
      ];

      const forgeZoneEl = document.getElementById("forge-loop-zone");
      const stageCycleEl = document.getElementById("stage-cycle");
      const stageStateEl = document.getElementById("stage-state");
      let forgeCycle = 0;
      forgeZoneEl.innerHTML = FORGE_TEMPLATES[0]();

      /* ==============================================================
         4. THE PANTHEON FORGE ENGINE — MYTHIC · DARK · BRUTALIST
            Eight rites. Each god owns a sigil cursor, a route, a reveal,
            a trail and an impact. Canvas-only FX + compositor-only DOM
            snaps (clip-path / translate / opacity) → zero layout shift.
         ============================================================== */
      const TAU = Math.PI * 2;
      const TRAIL_MAX = 18;
      const PART_MAX = 96;
      const INK = "#F4F2EC";
      const VERMILION = "#FF3D00";
      const GOLD = "#E5A93C";
      const KNOCKOUT = "#070709";
      const IRON = "#121317";
      const STEEL = "#9A9DA6";
      const ASH = "#5C5F68";
      const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
      const rand = (a, b) => a + Math.random() * (b - a);
      const minJerk = (t) => t * t * t * (10 + t * (6 * t - 15));
      const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
      const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const pad4 = (n) => String(Math.max(0, Math.round(n))).padStart(4, "0");
      const F_DIM = '500 8.5px "JetBrains Mono", ui-monospace, monospace';

      // Each god's rite: how it reveals a plate, how it travels, what it leaves behind
      const RITES = {
        Prometheus: { reveal: "frame", path: "arc", trail: "ember", spark: 7, pace: 1, gold: true },
        Athena: { reveal: "column", path: "arc", trail: "hair", spark: 0, pace: 1 },
        Daedalus: { reveal: "split", path: "dogleg", trail: "hair", spark: 0, pace: 1.05 },
        Hermes: { reveal: "dash", path: "dart", trail: "dash", spark: 2, pace: 0.62 },
        Chronos: { reveal: "tick", path: "tick", trail: "tick", spark: 0, pace: 1.1 },
        Iris: { reveal: "shutter", path: "wide", trail: "hair", spark: 3, pace: 1, gold: true },
        Nyx: { reveal: "aperture", path: "veil", trail: "none", spark: 0, pace: 1 },
        Hephaestus: { reveal: "hammer", path: "heavy", trail: "ember", spark: 10, pace: 1.2, gold: true },
      };

      // 32x32 sigil cursors, hotspot dead-centre (16,16)
      const GLYPHS = {
        Prometheus: { d: "M7 9 H25 L16 25 Z M16 2 V7 M16 27 V30 M2 16 H6 M26 16 H30", solid: true },
        Athena: { d: "M16 3 V29 M11 29 H21 M16 3 L12.5 9 H19.5 Z M11 16 H21", solid: true },
        Daedalus: { d: "M5 27 V5 H27 V22 H10 V10 H22 V17 H16", solid: false },
        Hermes: { d: "M16 3 L25 21 L16 16 L7 21 Z", solid: true },
        Chronos: { d: "M8 5 H24 L8 27 H24 Z M5 5 H27 M5 27 H27", solid: true },
        Iris: { d: "M16 6 L26 24 H6 Z", solid: true },
        Nyx: { d: "M25 16 A9 9 0 1 1 7 16 A9 9 0 1 1 25 16 Z", solid: true },
        Hephaestus: { d: "M6 7 H23 L26 10.5 L23 14 H6 Z M13 14 V28 M17 14 V28 M10 28 H20", solid: true },
      };
      // Raw accent d-strings — shared 1:1 by the canvas ACCENTS (Path2D) and the
      // pantheon card cursors (SVG), so both surfaces never drift apart.
      const ACCENT_D = {
        flame: "M13.5 12 H18.5 L16 17 Z",
        spearCore: "M16 11 V25",
        wing: "M10 26 L16 21.5 L22 26",
        ray0: "M21 13 L30 9",
        ray1: "M22 16 H30",
        ray2: "M22.5 19 L30 23",
        rayIn: "M2 17 L11 15",
        horizon: "M2 16 H30",
        face: "M23 7 L26 10.5 L23 14",
      };
      const ACCENTS = Object.fromEntries(Object.entries(ACCENT_D).map(([k, d]) => [k, new Path2D(d)]));

      AGENTS.forEach((ag) => {
        ag.sigilPath = new Path2D(ag.sigil);
        ag.rite = RITES[ag.name];
        ag.glyph = new Path2D(GLYPHS[ag.name].d);
        ag.solid = GLYPHS[ag.name].solid;
      });

      // PANTHEON SYNC — each card wears the same mythic sigil as its canvas agent,
      // frozen at the Pass 6 rest state: knockout halo → iron body → mineral edge
      // → accent → hotspot dot. 32×32 viewBox at 1u = 1px ⇒ pixel-true 1:1.
      const CURSOR_ACCENTS = {
        Prometheus: () => `<path d="${ACCENT_D.flame}" fill="${VERMILION}"/>`,
        Athena: () => "",
        Daedalus: () => `<rect x="15" y="16" width="2" height="2" fill="${STEEL}"/>`,
        Hermes: () => `<path d="${ACCENT_D.wing}" fill="none" stroke="${STEEL}" stroke-width="1.25"/>`,
        Chronos: () => `<path class="chronos-hand" d="M16 16 V10" fill="none" stroke="${INK}" stroke-width="1.25"/>`,
        Iris: () =>
          `<path d="${ACCENT_D.rayIn}" fill="none" stroke="${STEEL}"/>` +
          `<path d="${ACCENT_D.ray0}" fill="none" stroke="${STEEL}"/>` +
          `<path d="${ACCENT_D.ray1}" fill="none" stroke="${STEEL}"/>` +
          `<path d="${ACCENT_D.ray2}" fill="none" stroke="${ASH}"/>`,
        Nyx: () => `<circle cx="18.5" cy="14" r="5.5" fill="${KNOCKOUT}"/><path d="${ACCENT_D.horizon}" fill="none" stroke="${INK}"/>`,
        Hephaestus: () => `<path d="${ACCENT_D.face}" fill="none" stroke="${STEEL}" stroke-width="1.5"/>`,
      };
      function mythicCursorSVG(name, color) {
        const g = GLYPHS[name];
        if (!g) return "";
        const body = g.solid ? `<path d="${g.d}" fill="${IRON}" fill-rule="evenodd"/>` : "";
        const dot = name !== "Daedalus" && name !== "Chronos" ? `<rect x="15" y="15" width="2" height="2" fill="${INK}"/>` : "";
        return (
          `<path d="${g.d}" fill="none" stroke="${KNOCKOUT}" stroke-width="3.5" stroke-linejoin="miter" stroke-miterlimit="3"/>` +
          body +
          `<path d="${g.d}" fill="none" stroke="${color}" stroke-width="1.15" stroke-linejoin="miter" stroke-miterlimit="3"/>` +
          (CURSOR_ACCENTS[name] ? CURSOR_ACCENTS[name]() : "") +
          dot
        );
      }
      document.querySelectorAll("[data-cursor]").forEach((svg) => {
        const name = svg.getAttribute("data-cursor");
        const ag = AGENTS.find((a) => a.name === name);
        if (ag) svg.innerHTML = mythicCursorSVG(name, ag.color);
      });

      class Swarm {
        constructor() {
          this.started = false;
          this.agents = [];
          this.zones = new Map();
          this.queue = [];
          this.flashes = [];
          this.detents = [];
          this.rules = [];
          this.stamps = [];
          this.locks = [];
          this.genesis = null;
          this.rewind = null;
          this.genN = 0;
          // Flat pre-allocated spark pool: [x, y, vx, vy, age, life, kind] * PART_MAX
          this.pBuf = new Float32Array(PART_MAX * 7);
          this.pCount = 0;
          this.clock = 0;
          this.gate = 420;
          this.sy = 0;
          this.pointer = { x: -999, y: -999, last: -1e9 };
          this.monoW = 5.8;
          this.monoS = 5.2;
        }

        start() {
          if (this.started) return;
          this.started = true;
          if (!document.documentElement.classList.contains("ak-armed")) return;

          const c = (this.canvas = document.createElement("canvas"));
          c.setAttribute("aria-hidden", "true");
          c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:70;pointer-events:none";
          document.body.appendChild(c);
          this.ctx = c.getContext("2d");
          this.resize();
          this.ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
          this.monoW = this.ctx.measureText("M").width || 5.8;
          this.ctx.font = F_DIM;
          this.monoS = this.ctx.measureText("M").width || 5.2;

          // Mobile uses 5 core agents (I, II, III, IV, VIII); desktop uses all 8
          const pool = window.innerWidth < 768 ? [0, 1, 2, 3, 7] : [0, 1, 2, 3, 4, 5, 6, 7];
          const cx = this.W / 2;
          const cy = window.scrollY + this.H * 0.42;
          pool.forEach((agentIdx, idx) => {
            const def = AGENTS[agentIdx];
            const ang = (idx / pool.length) * TAU;
            this.agents.push({
              def, i: idx, x: cx, y: cy, vx: Math.cos(ang) * 860, vy: Math.sin(ang) * 860,
              hx: 0.1 + ((idx * 0.618034) % 1) * 0.8, hy: 0.14 + ((idx * 0.381966 + 0.2) % 1) * 0.7,
              ph: rand(0, TAU), f1: rand(0.6, 1.35), f2: rand(0.6, 1.35), orbit: ang, dir: idx % 2 ? 1 : -1,
              state: "idle", task: null, shape: "arrow", verb: "", side: idx % 2 ? 1 : -1, rest: 0,
              flipX: false, flipY: false, alpha: 1, rot: 0, tilt: 0, snapT: 999,
              // Pre-allocated ring buffer: [x, y, timestamp] * TRAIL_MAX
              tBuf: new Float32Array(TRAIL_MAX * 3),
              tHead: -1, tLen: 0, lastTx: cx, lastTy: cy,
            });
          });
          this.ignite(false);

          this.io = new IntersectionObserver(
            (entries) => entries.forEach((e) => {
              const z = this.zones.get(e.target);
              if (z) z.visible = e.isIntersecting;
            }),
            { rootMargin: "0px 0px -8% 0px" }
          );
          document.querySelectorAll("[data-build-zone]").forEach((el) => this.register(el));

          window.addEventListener("resize", () => this.resize(), { passive: true });
          const onPtr = (e) => {
            this.pointer.x = e.clientX;
            this.pointer.y = e.clientY;
            this.pointer.last = this.clock;
          };
          window.addEventListener("pointermove", onPtr, { passive: true });
          window.addEventListener("pointerdown", onPtr, { passive: true });
          ticker.onQuality.add(() => {
            this.resize();
            this.agents.forEach((a) => { a.tHead = -1; a.tLen = 0; });
          });
          swarmRef = this;
        }

        resize() {
          if (!this.canvas) return;
          const q = ticker.quality;
          const dpr = Math.min(window.devicePixelRatio || 1, q === 2 ? 2 : q === 1 ? 1.5 : 1);
          this.W = window.innerWidth;
          this.H = window.innerHeight;
          this.dpr = dpr;
          this.canvas.width = Math.round(this.W * dpr);
          this.canvas.height = Math.round(this.H * dpr);
        }

        register(el) {
          const z = {
            el, tasks: [], left: 0, active: false, built: false, visible: false, dissolving: false, forged: 0,
            loop: el.dataset.buildZone === "loop", hold: 3800, startedAt: 0, builtAt: 0, budget: 0, dissolveTimer: 0,
            slitAt: 0, slit: null,
          };
          this.zones.set(el, z);
          this.scan(z);
          this.io.observe(el);
          return z;
        }

        scan(z) {
          const els = Array.from(z.el.querySelectorAll("[data-build]")).filter((e) => e.closest("[data-build-zone]") === z.el);
          const map = new Map();
          z.tasks = els.map((el) => {
            const t = { el, zone: z, type: el.dataset.build || "box", done: false, claimed: false, dep: null };
            map.set(el, t);
            return t;
          });
          z.tasks.forEach((t) => {
            const p = t.el.parentElement && t.el.parentElement.closest("[data-build]");
            t.dep = (p && map.get(p)) || null;
          });
          z.left = z.tasks.length;
          z.forged = 0;
          z.budget = 4600 + z.tasks.length * 380;
        }

        setState(z, state) {
          z.el.dispatchEvent(new CustomEvent("ak:state", { detail: state }));
        }

        activate(z) {
          z.active = true;
          z.startedAt = this.clock;
          this.setState(z, "building");
          z.tasks.forEach((t) => {
            if (t.done) return;
            if (t.el.getBoundingClientRect().bottom < -120) this.finish(t, null);
            else this.queue.push(t);
          });
        }

        release(z) {
          this.queue = this.queue.filter((t) => t.zone !== z);
          this.agents.forEach((a) => {
            if (a.task && a.task.zone === z) {
              a.task = null; a.state = "idle"; a.verb = ""; a.alpha = 1; a.tilt = 0;
            }
          });
        }

        flush(z) {
          const open = z.tasks.filter((t) => !t.done);
          this.release(z);
          open.forEach((t) => this.finish(t, null));
        }

        unbuild(z) {
          if (z.dissolveTimer) { clearTimeout(z.dissolveTimer); z.dissolveTimer = 0; }
          z.slitAt = 0;
          this.release(z);
          z.tasks.forEach((t) => {
            t.el.getAnimations().forEach((an) => an.cancel());
            t.el.removeAttribute("data-built");
            t.el.style.clipPath = "";
            t.el.style.opacity = "";
          });
          z.active = z.built = z.dissolving = false;
        }

        rescan(el) {
          if (!this.canvas) return;
          const z = this.zones.get(el);
          if (!z) return this.register(el);
          this.release(z);
          z.active = z.built = z.dissolving = false;
          this.scan(z);
        }

        // REPLAY — act I: the pantheon razes what stands and is called back to the anvil
        replay() {
          if (!this.canvas || this.rewind) return;
          const vh = this.H;
          let k = 0;
          this.zones.forEach((z) => {
            if (z.dissolveTimer) { clearTimeout(z.dissolveTimer); z.dissolveTimer = 0; }
            z.slitAt = 0;
            this.release(z);
            for (let i = z.tasks.length - 1; i >= 0; i--) {
              const el = z.tasks[i].el;
              if (!el.hasAttribute("data-built")) continue;
              const r = el.getBoundingClientRect();
              if (r.bottom < 0 || r.top > vh || r.width < 2) continue;
              el.animate(
                [
                  { clipPath: "inset(0 0 0 0)", translate: "0 0", opacity: 1 },
                  { clipPath: "inset(0 0 100% 0)", translate: "0 12px", opacity: 1 },
                ],
                { duration: 240, delay: Math.min(k++ * 9, 260), easing: "cubic-bezier(.7,0,.84,0)", fill: "forwards" }
              );
            }
          });
          this.flashes.length = this.stamps.length = this.locks.length = this.rules.length = 0;
          this.gate = Infinity;
          this.genesis = null;
          this.rewind = { t: 0, dur: 620 };
        }

        // REPLAY — act II (and first boot): the strike. Everything is re-forged from nothing.
        ignite(reset) {
          const cx = this.W / 2;
          const cy = window.scrollY + this.H * 0.42;
          if (reset) {
            this.zones.forEach((z) => {
              this.unbuild(z);
              this.scan(z);
            });
            this.agents.forEach((a, i) => {
              const ang = (i / this.agents.length) * TAU;
              a.x = cx; a.y = cy; a.vx = Math.cos(ang) * 980; a.vy = Math.sin(ang) * 980;
              a.tHead = -1; a.tLen = 0; a.lastTx = cx; a.lastTy = cy;
              a.state = "idle"; a.task = null; a.verb = ""; a.alpha = 1; a.tilt = 0;
            });
            this.gate = this.clock + 460;
          }
          this.rewind = null;
          this.genN += 1;
          this.genesis = { x: cx, y: cy, t: 0, dur: 1300, n: this.genN };
          if (ticker.quality > 0) this.emitSparks(cx, cy, ticker.quality === 2 ? 26 : 12, 0, TAU, 420);
        }

        summon(clientX, clientY) {
          if (!this.canvas || this.rewind) return;
          const x = clientX;
          const y = clientY + this.sy;
          let best = null, bd = Infinity;
          this.agents.forEach((a) => {
            if (a.state !== "idle") return;
            const d = Math.hypot(a.x - x, a.y - y);
            if (d < bd) { bd = d; best = a; }
          });
          this.detents.push({ x, y, t: 0, dur: 260, vermilion: true });
          if (!best) return;
          best.state = "travel";
          best.verb = "LOCK";
          this.route(best, x, y);
        }

        pick(a) {
          const q = this.queue;
          let first = null, seen = 0;
          for (let i = 0; i < q.length && seen < 5; i++) {
            const t = q[i];
            if (t.claimed || (t.dep && !t.dep.done)) continue;
            seen++;
            if (!first) first = t;
            if (a.def.likes.indexOf(t.type) !== -1) return t;
          }
          return first;
        }

        claim(a, t) {
          t.claimed = true;
          const r = t.el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return this.finish(t, null);
          t.x = r.left; t.y = r.top + this.sy; t.w = r.width; t.h = r.height; t.u = 0;
          t.vert = t.type === "line" && t.h > t.w * 3;
          t.blow = 0;
          t.blows = t.h > 170 ? 4 : 3;
          t.reveal = t.type === "select" ? "frame" : a.def.rite.reveal;
          if (t.type === "text") {
            const cs = getComputedStyle(t.el);
            const fs = parseFloat(cs.fontSize) || 16;
            const lh = parseFloat(cs.lineHeight) || fs * 1.3;
            t.lines = Math.max(1, Math.round(t.h / lh));
            t.lh = t.h / t.lines;
            t.step = clamp(fs * 0.56, 5, 26);
          }
          this.pose(a, t, 0);
          t.ox = t.px; t.oy = t.py;
          a.task = t;
          a.state = "travel";
          a.verb = VERBS[t.type] || "";
          this.route(a, t.px, t.py);
        }

        route(a, x, y) {
          const dx = x - a.x, dy = y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const kind = a.def.rite.path;
          a.side = -a.side;
          const bowK = kind === "wide" ? 0.42 : kind === "dart" ? 0.07 : 0.18;
          const bow = clamp(d * bowK, 0, kind === "wide" ? 250 : 115) * a.side;
          const durK = kind === "dart" ? 0.58 : kind === "heavy" ? 1.12 : kind === "dogleg" ? 1.15 : 1;
          a.p = {
            kind, hFirst: Math.abs(dx) >= Math.abs(dy),
            x0: a.x, y0: a.y,
            x1: a.x + a.vx * 0.09 + dx * 0.22, y1: a.y + a.vy * 0.09 + dy * 0.22,
            x2: x - dx * 0.28 - (dy / d) * bow, y2: y - dy * 0.28 + (dx / d) * bow,
            x3: x, y3: y, t: 0, dur: (150 + 110 * Math.log2(1 + d / 50)) * durK,
          };
        }

        beginWork(a) {
          const t = a.task;
          const diag = Math.hypot(t.w, t.h);
          const pace = a.def.rite.pace;
          a.wt = 0;
          a.snapT = 0;
          a.wdur =
            t.type === "text" ? clamp(t.lines * (135 + t.w * 0.35), 210, 1200)
            : t.type === "line" ? 180 + clamp(Math.max(t.w, t.h) * 0.22, 0, 360)
            : t.type === "rise" ? 250 + t.w * 0.12
            : t.type === "select" ? 620
            : (230 + clamp(diag * 0.36, 0, 470)) * pace;
          a.state = "work";
          if (t.type !== "rise" && t.type !== "select") {
            t.el.style.clipPath = "inset(0 100% 100% 0)";
            t.el.style.opacity = "1";
          }
        }

        // Pure geometry: where the god stands (px,py), what is revealed (clip), and its bounds (b*)
        pose(a, t, u) {
          const { x, y, w, h } = t;
          let px = x, py = y, clip = "";
          t.bx0 = x; t.by0 = y; t.bx1 = x + w; t.by1 = y + h;
          if (t.type === "text") {
            const f = Math.min(u * t.lines, t.lines - 1e-4);
            const i = Math.floor(f), p = f - i;
            const cx = u >= 1 ? w : Math.min(w, Math.round((p * w) / t.step) * t.step);
            const y0 = i * t.lh, y1 = y0 + t.lh;
            px = x + cx; py = y + y0 + t.lh / 2;
            clip = `polygon(0 0,${w + 4}px 0,${w + 4}px ${y0}px,${cx}px ${y0}px,${cx}px ${y1}px,0 ${y1}px)`;
          } else if (t.type === "line") {
            const e = a.def.rite.path === "dart" ? expoOut(u) : inOut(u);
            if (t.vert) { px = x + w / 2; py = y + h * e; clip = `inset(0 0 ${(1 - e) * 100}% 0)`; }
            else { px = x + w * e; py = y + h / 2; clip = `inset(0 ${(1 - e) * 100}% 0 0)`; }
          } else if (t.type === "rise") {
            px = x + w * inOut(u); py = y + h;
          } else {
            const R = t.reveal;
            let e = inOut(u);
            if (R === "column") {
              px = x + w * u; py = y + h * e;
              t.by1 = py;
              clip = `inset(0 0 ${(1 - e) * 100}% 0)`;
            } else if (R === "split") {
              const half = (w / 2) * e;
              px = x + w / 2 + half; py = y + h * (0.5 + 0.5 * e);
              t.bx0 = x + w / 2 - half; t.bx1 = px;
              clip = `inset(0 ${(1 - e) * 50}% 0 ${(1 - e) * 50}%)`;
            } else if (R === "dash") {
              e = expoOut(u);
              px = x + w * e; py = y + h / 2;
              t.bx1 = px;
              clip = `inset(0 ${(1 - e) * 100}% 0 0)`;
            } else if (R === "tick") {
              e = u >= 1 ? 1 : Math.floor(u * 8) / 8;
              px = x + w * e; py = y + h;
              t.bx1 = px;
              clip = `inset(0 ${(1 - e) * 100}% 0 0)`;
            } else if (R === "shutter") {
              const A = e * 1.34, B = Math.max(0, A - 0.34);
              px = x + w * clamp(A - 0.17, 0, 1); py = y + h / 2;
              t.bx1 = x + w * Math.min(1, A);
              clip = `polygon(0 0,${A * 100}% 0,${B * 100}% 100%,0 100%)`;
            } else if (R === "aperture") {
              px = x + w / 2 + (w / 2) * e; py = y + h / 2 - (h / 2) * e;
              t.bx0 = x + w / 2 - (w / 2) * e; t.bx1 = px; t.by0 = py; t.by1 = y + h / 2 + (h / 2) * e;
              clip = `inset(${(1 - e) * 50}% ${(1 - e) * 50}%)`;
            } else if (R === "hammer") {
              const n = t.blows;
              const f = Math.min(u * n, n - 1e-4);
              const i = Math.floor(f), p = f - i;
              e = u >= 1 ? 1 : i / n;
              const drop = 1 - p * p * p;
              px = x + w * (0.5 + 0.28 * Math.sin(i * 2.4 + 1));
              py = y + h * ((i + 1) / n) - 34 * drop;
              t.by1 = y + h * e;
              t.blowNow = i;
              t.tilt = -0.75 * drop;
              clip = `inset(0 0 ${(1 - e) * 100}% 0)`;
            } else {
              px = x + w * e; py = y + h * e;
              t.bx1 = px; t.by1 = py;
              clip = `inset(0 ${(1 - e) * 100}% ${(1 - e) * 100}% 0)`;
            }
          }
          t.px = px; t.py = py; t.clip = clip;
        }

        work(a, t, u) {
          t.u = u;
          this.pose(a, t, u);
          a.x = t.px; a.y = t.py;
          if (t.type === "select" || t.type === "rise") return;
          t.el.style.clipPath = t.clip;
          if (t.reveal === "hammer" && t.type !== "text" && t.type !== "line") {
            a.tilt = t.tilt;
            if (t.blowNow !== t.blow) {
              t.blow = t.blowNow;
              this.strike(t, t.y + (t.h * t.blow) / t.blows, a.x);
            }
          }
        }

        // Hephaestus: one hammer blow — hot seam across the slab + sparks off the anvil
        strike(t, yPage, xAt) {
          const q = ticker.quality;
          this.rules.push({ x0: t.x, y0: yPage, x1: t.x + t.w, y1: yPage, t: 0, dur: 240, gold: true, ext: false });
          if (q > 0) this.emitSparks(xAt, yPage, q === 2 ? 6 : 3, -Math.PI / 2, 2.2, 230);
        }

        finish(t, a) {
          if (t.done) return;
          t.done = true;
          const z = t.zone;
          const qi = this.queue.indexOf(t);
          if (qi !== -1) this.queue.splice(qi, 1);
          if (t.type === "select") {
            if (a) {
              this.flashes.push({ x: t.x, y: t.y, w: t.w, h: t.h, t: 0, dur: 420, gold: false, fill: true });
              if (ticker.quality === 2) this.stamp(t.x, t.y - 14, `${a.def.roman}·EXCISE ${pad4(t.x)},${pad4(t.y)}`);
            }
            return this.dissolve(z);
          }
          const el = t.el;
          el.setAttribute("data-built", "");
          el.style.clipPath = "";
          el.style.opacity = "";
          el.querySelectorAll(".ak-count").forEach((cEl) => animateCounter(cEl));
          if (a) {
            a.tilt = 0;
            z.forged++;
            this.impact(t, a);
          }
          z.left--;
          if (z.left <= 0 && !z.built) {
            z.built = true; z.active = false; z.builtAt = this.clock;
            if (z.forged > 2 && z.visible && ticker.quality > 0) {
              const r = z.el.getBoundingClientRect();
              this.locks.push({
                x: r.left, y: r.top + this.sy, w: r.width, h: r.height, t: 0, dur: 760,
                txt: `LOCKED · ${String(z.tasks.length).padStart(2, "0")} PLATES · ${((this.clock - z.startedAt) / 1000).toFixed(2)}S`,
              });
            }
            this.setState(z, "built");
          }
        }

        // Brutalist lock-in: seismic micro-detent on the element itself + canvas stamp, flash, laser, sparks
        impact(t, a) {
          const q = ticker.quality;
          const rite = a.def.rite;
          const heavy = t.type === "box" || t.type === "fade" || t.type === "rise";
          const amp = t.type === "box" ? 3 : heavy ? 2 : 1;
          const kf = heavy
            ? [{ translate: `0 ${amp}px` }, { translate: "0 -1px" }, { translate: "0 0" }]
            : [{ translate: "0 1px" }, { translate: "0 0" }];
          if (t.type === "fade") {
            kf[0].opacity = 0.42; kf[1].opacity = 1; kf[2].opacity = 0.74;
            kf.push({ translate: "0 0", opacity: 1 });
          }
          t.el.animate(kf, { duration: heavy ? 150 : 70, easing: "steps(1, end)" });

          this.flashes.push({ x: t.x, y: t.y, w: t.w, h: t.h, t: 0, dur: 440, gold: !!rite.gold, fill: heavy && t.type !== "rise" });
          if (q === 0) return;
          if (heavy) {
            const ry = t.type === "rise" ? t.y + t.h : t.y;
            this.rules.push({ x0: t.x, y0: ry, x1: t.x + t.w, y1: ry, t: 0, dur: 200, gold: !!rite.gold, ext: q === 2 });
            const n = rite.spark + (t.type === "box" ? 2 : 0);
            if (n) this.emitSparks(a.x, a.y, q === 2 ? n : Math.ceil(n / 2), -Math.PI / 2, 2.6, 260);
            if (q === 2) {
              this.detents.push({ x: a.x, y: a.y, t: 0, dur: 200, vermilion: a.def.roman === "I" });
              this.stamp(t.x, t.y - 14, `${a.def.roman}·${a.verb || "SET"} ${pad4(t.x)},${pad4(t.y)} ${Math.round(t.w)}×${Math.round(t.h)}`);
            }
          }
        }

        stamp(x, y, txt) {
          if (this.stamps.length >= 6) this.stamps.shift();
          this.stamps.push({ x, y, txt, t: 0, dur: 980 });
        }

        // EXCISE — the plate is dismantled piece by piece with real weight, then sheared shut on a hot seam
        dissolve(z) {
          if (z.dissolveTimer) clearTimeout(z.dissolveTimer);
          let k = 0;
          const roots = [];
          for (let i = z.tasks.length - 1; i >= 0; i--) {
            const t = z.tasks[i];
            if (!t.dep) { roots.push(t); continue; }
            const kick = (k % 2 ? 1 : -1) * (4 + (k % 3) * 3);
            t.el.animate(
              [
                { translate: "0 0", rotate: "0deg", clipPath: "inset(0 0 0 0)", opacity: 1, easing: "steps(1, end)" },
                { translate: "0 -2px", rotate: "0deg", clipPath: "inset(0 0 0 0)", opacity: 1, offset: 0.14, easing: "cubic-bezier(.6,0,.9,.25)" },
                { translate: `${kick}px 26px`, rotate: `${kick * 0.35}deg`, clipPath: "inset(0 0 100% 0)", opacity: 1 },
              ],
              { duration: 330, delay: k * 26, fill: "forwards" }
            );
            k++;
          }
          const seamDelay = k * 26 + 200;
          roots.forEach((t) => {
            t.el.animate(
              [
                { clipPath: "inset(0 0 0 0)", opacity: 1, easing: "steps(1, end)" },
                { clipPath: "inset(0 0 0 0)", opacity: 0.7, offset: 0.1, easing: "cubic-bezier(.8,0,.2,1)" },
                { clipPath: "inset(49.6% 0 49.6% 0)", opacity: 1, offset: 0.72, easing: "cubic-bezier(.7,0,.84,0)" },
                { clipPath: "inset(49.6% 50% 49.6% 50%)", opacity: 1 },
              ],
              { duration: 360, delay: seamDelay, fill: "forwards" }
            );
          });
          const r = z.el.getBoundingClientRect();
          z.slit = { x: r.left, y: r.top + this.sy + r.height / 2, w: r.width };
          z.slitAt = this.clock + seamDelay + 250;
          z.dissolveTimer = setTimeout(() => {
            z.dissolveTimer = 0;
            if (!this.zones.has(z.el)) return;
            this.unbuild(z);
            this.scan(z);
            this.setState(z, "dissolved");
          }, seamDelay + 440);
        }

        emitSparks(x, y, count, dir, spread, speed) {
          for (let i = 0; i < count && this.pCount < PART_MAX; i++) {
            const base = this.pCount * 7;
            const ang = dir + rand(-spread, spread) * 0.5, sp = speed * rand(0.35, 1);
            this.pBuf[base] = x;
            this.pBuf[base + 1] = y;
            this.pBuf[base + 2] = Math.cos(ang) * sp;
            this.pBuf[base + 3] = Math.sin(ang) * sp;
            this.pBuf[base + 4] = 0;
            this.pBuf[base + 5] = rand(280, 620);
            this.pBuf[base + 6] = i % 4 === 0 ? 0 : i % 2 ? 1 : 2; // 0 ash · 1 ember · 2 gold
            this.pCount++;
          }
        }

        frame = (dt, s) => {
          this.clock += dt;
          const clock = this.clock;
          const sy = (this.sy = s ? s.y : window.scrollY);
          const dts = dt / 1000;
          const open = clock > this.gate;
          const q = ticker.quality;

          if (this.rewind) {
            this.rewind.t += dt;
            if (this.rewind.t >= this.rewind.dur) this.ignite(true);
          }

          this.zones.forEach((z) => {
            if (z.slitAt && clock >= z.slitAt) {
              z.slitAt = 0;
              const s = z.slit;
              this.rules.push({ x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y, t: 0, dur: 340, gold: true, ext: q === 2 });
              if (q > 0) for (let i = 0; i < 4; i++) this.emitSparks(s.x + s.w * (0.15 + i * 0.233), s.y, q === 2 ? 5 : 2, -Math.PI / 2, 3, 300);
            }
            if (!open) return;
            if (z.visible && !z.active && !z.built && !z.dissolving && z.left > 0) this.activate(z);
            else if (z.active && clock - z.startedAt > z.budget) this.flush(z);
            else if (z.loop && z.built && z.visible && !z.dissolving && clock - z.builtAt > z.hold) {
              z.dissolving = true;
              this.setState(z, "dissolving");
              this.queue.push({ el: z.el, zone: z, type: "select", done: false, claimed: false, dep: null });
            }
          });

          const pending = this.queue.length;
          const speed = clamp(1 + pending / 10, 1, 3.4);
          const follow = clock - this.pointer.last < 2600;
          const STEP = TAU / 16;

          for (let n = 0; n < this.agents.length; n++) {
            const a = this.agents[n];
            if (a.state === "idle" && pending && open) {
              const t = this.pick(a);
              if (t) this.claim(a, t);
            }
            if (a.state === "idle") {
              let tx, ty, k;
              a.alpha = 1;
              if (this.rewind) {
                tx = this.W / 2; ty = sy + this.H * 0.42; k = 130;
              } else if (follow) {
                const ang = a.orbit + clock * 0.00065 * a.dir;
                const R = 64 + a.i * 14;
                tx = this.pointer.x + Math.cos(ang) * R;
                ty = this.pointer.y + sy + Math.sin(ang) * R * 0.8;
                k = 44;
              } else {
                tx = a.hx * this.W + Math.sin(clock * 0.00038 * a.f1 + a.ph) * 44;
                ty = sy + a.hy * this.H + Math.cos(clock * 0.00046 * a.f2 + a.ph) * 32;
                k = 20;
              }
              const c = 2 * Math.sqrt(k) * 0.84;
              a.vx += ((tx - a.x) * k - a.vx * c) * dts;
              a.vy += ((ty - a.y) * k - a.vy * c) * dts;
              a.x += a.vx * dts;
              a.y += a.vy * dts;
            } else if (a.state === "travel") {
              const p = a.p;
              p.t = Math.min(1, p.t + (dt * speed) / p.dur);
              const pt = p.t;
              const e =
                p.kind === "dart" ? 1 - Math.pow(1 - pt, 4)
                : p.kind === "heavy" ? pt * pt * (0.35 + 0.65 * pt)
                : p.kind === "tick" ? (pt >= 1 ? 1 : Math.floor(minJerk(pt) * 7) / 7)
                : minJerk(pt);
              let nx, ny;
              if (p.kind === "dogleg") {
                const dx = p.x3 - p.x0, dy = p.y3 - p.y0;
                const adx = Math.abs(dx), ady = Math.abs(dy);
                const s = e * (adx + ady);
                if (p.hFirst) {
                  if (s < adx) { nx = p.x0 + Math.sign(dx) * s; ny = p.y0; }
                  else { nx = p.x3; ny = p.y0 + Math.sign(dy) * (s - adx); }
                } else if (s < ady) { nx = p.x0; ny = p.y0 + Math.sign(dy) * s; }
                else { nx = p.x0 + Math.sign(dx) * (s - ady); ny = p.y3; }
              } else {
                const m = 1 - e;
                nx = m * m * m * p.x0 + 3 * m * m * e * p.x1 + 3 * m * e * e * p.x2 + e * e * e * p.x3;
                ny = m * m * m * p.y0 + 3 * m * m * e * p.y1 + 3 * m * e * e * p.y2 + e * e * e * p.y3;
              }
              a.alpha = p.kind === "veil" ? clamp(Math.abs(1 - 2 * pt) * 1.5, 0.05, 1) : 1;
              a.vx = (nx - a.x) / dts; a.vy = (ny - a.y) / dts;
              a.x = nx; a.y = ny;
              if (pt >= 1) {
                a.vx = a.vy = 0;
                a.alpha = 1;
                if (p.kind === "heavy" && q > 0) {
                  this.detents.push({ x: a.x, y: a.y, t: 0, dur: 180, vermilion: true });
                  this.emitSparks(a.x, a.y, q === 2 ? 5 : 2, -Math.PI / 2, 2.4, 200);
                }
                if (a.task) this.beginWork(a);
                else {
                  this.detents.push({ x: a.x, y: a.y, t: 0, dur: 220, vermilion: true });
                  if (q > 0) this.emitSparks(a.x, a.y, q === 2 ? 8 : 4, -Math.PI / 2, 3, 240);
                  a.state = "rest"; a.rest = 600;
                }
              }
            } else if (a.state === "work") {
              a.wt += dt * speed;
              a.snapT += dt;
              const u = clamp(a.wt / a.wdur, 0, 1);
              this.work(a, a.task, u);
              if (u >= 1) {
                this.finish(a.task, a);
                a.task = null; a.state = "rest"; a.rest = rand(25, 105) / speed;
              }
            } else {
              a.rest -= dt;
              if (a.rest <= 0) { a.state = "idle"; a.verb = ""; }
            }

            if (a.def.rite.path === "dart") {
              if (a.state === "work") a.rot = Math.PI / 2;
              else if (a.vx * a.vx + a.vy * a.vy > 3600) a.rot = Math.round((Math.atan2(a.vy, a.vx) + Math.PI / 2) / STEP) * STEP;
            }

            if (q > 0 && Math.hypot(a.x - a.lastTx, a.y - a.lastTy) >= 6) {
              const cap = q === 2 ? TRAIL_MAX : 9;
              a.tHead = (a.tHead + 1) % cap;
              const o = a.tHead * 3;
              a.tBuf[o] = a.x; a.tBuf[o + 1] = a.y; a.tBuf[o + 2] = clock;
              if (a.tLen < cap) a.tLen++;
              a.lastTx = a.x; a.lastTy = a.y;
            }
          }

          this.draw(dt, sy, clock, q);
        };

        draw(dt, sy, clock, q) {
          const ctx = this.ctx;
          const { W, H, dpr } = this;
          const mS = this.monoS;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);
          ctx.lineJoin = "miter";
          ctx.miterLimit = 3;
          ctx.textBaseline = "middle";

          // ------------------------------------------------------------ PASS 1: STEEL CROSSHAIRS, LASER RULES & CALIBRATED CALLOUTS
          if (q > 0) {
            ctx.font = F_DIM;
            for (let n = 0; n < this.agents.length; n++) {
              const a = this.agents[n];
              if (a.state !== "work") continue;
              const t = a.task;
              const ax = Math.round(a.x) + 0.5, ay = Math.round(a.y - sy) + 0.5;
              if (ay < -90 || ay > H + 90) continue;
              ctx.lineWidth = 1;

              if (t.type === "box" || t.type === "fade" || t.type === "select") {
                const x0 = Math.round(t.bx0) + 0.5, y0 = Math.round(t.by0 - sy) + 0.5;
                const x1 = Math.round(t.bx1) + 0.5, y1 = Math.round(t.by1 - sy) + 0.5;
                const w = x1 - x0, h = y1 - y0;
                if (q === 2) {
                  ctx.strokeStyle = "rgba(255, 61, 0, 0.24)";
                  ctx.beginPath();
                  ctx.moveTo(0, y1); ctx.lineTo(W, y1); ctx.moveTo(x1, 0); ctx.lineTo(x1, H);
                  ctx.stroke();
                  ctx.strokeStyle = "rgba(244, 242, 236, 0.07)";
                  ctx.beginPath();
                  ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.moveTo(x0, 0); ctx.lineTo(x0, H);
                  ctx.stroke();
                }
                if (w > 1 && h > 1) {
                  if (t.type === "select") { ctx.strokeStyle = VERMILION; ctx.setLineDash([5, 3]); ctx.lineDashOffset = -clock * 0.04; }
                  else ctx.strokeStyle = "rgba(244, 242, 236, 0.6)";
                  ctx.strokeRect(x0, y0, w, h);
                  ctx.setLineDash([]);
                  if (t.type === "select" && q === 2) {
                    ctx.strokeStyle = "rgba(255, 61, 0, 0.3)";
                    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.moveTo(x1, y0); ctx.lineTo(x0, y1); ctx.stroke();
                  }
                  ctx.fillStyle = INK;
                  ctx.fillRect(x0 - 2, y0 - 2, 3, 3); ctx.fillRect(x1 - 2, y0 - 2, 3, 3);
                  ctx.fillRect(x0 - 2, y1 - 2, 3, 3); ctx.fillRect(x1 - 2, y1 - 2, 3, 3);
                }
                if (q === 2 && w > 56) {
                  const dy = y0 - 9;
                  ctx.strokeStyle = STEEL;
                  ctx.beginPath();
                  ctx.moveTo(x0, dy); ctx.lineTo(x1, dy);
                  ctx.moveTo(x0, dy - 3); ctx.lineTo(x0, dy + 3);
                  ctx.moveTo(x1, dy - 3); ctx.lineTo(x1, dy + 3);
                  ctx.stroke();
                  const lw = String(Math.round(w / 2) * 2);
                  const tw = lw.length * mS + 8;
                  const lx = Math.round(x0 + w / 2 - tw / 2);
                  ctx.fillStyle = KNOCKOUT;
                  ctx.fillRect(lx, dy - 6, tw, 12);
                  ctx.fillStyle = INK;
                  ctx.fillText(lw, lx + 4, dy + 0.5);
                  if (h > 44) {
                    const dx = x1 + 9;
                    ctx.beginPath();
                    ctx.moveTo(dx, y0); ctx.lineTo(dx, y1);
                    ctx.moveTo(dx - 3, y0); ctx.lineTo(dx + 3, y0);
                    ctx.moveTo(dx - 3, y1); ctx.lineTo(dx + 3, y1);
                    ctx.stroke();
                    const lh = String(Math.round(h / 2) * 2);
                    const my = Math.round(y0 + h / 2);
                    ctx.fillStyle = KNOCKOUT;
                    ctx.fillRect(dx - 3, my - 6, lh.length * mS + 8, 12);
                    ctx.fillStyle = INK;
                    ctx.fillText(lh, dx + 1, my + 0.5);
                  }
                }
              } else if (t.type === "text") {
                const half = t.lh * 0.5;
                if (q === 2) {
                  const by = Math.round(ay + half) + 0.5;
                  ctx.strokeStyle = "rgba(255, 61, 0, 0.42)";
                  ctx.beginPath(); ctx.moveTo(Math.round(t.x) - 14, by); ctx.lineTo(ax + 22, by); ctx.stroke();
                }
                ctx.fillStyle = VERMILION;
                ctx.fillRect(ax - 0.5, Math.round(ay - half), 2, Math.round(t.lh));
              } else {
                const bx = Math.round(t.ox) + 0.5, by = Math.round(t.oy - sy) + 0.5;
                if (q === 2) {
                  ctx.strokeStyle = "rgba(255, 61, 0, 0.16)";
                  ctx.beginPath();
                  if (t.vert) { ctx.moveTo(ax, ay); ctx.lineTo(ax, H); }
                  else { ctx.moveTo(ax, ay); ctx.lineTo(W, ay); }
                  ctx.stroke();
                }
                ctx.strokeStyle = VERMILION;
                ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ay); ctx.stroke();
                ctx.fillStyle = INK;
                ctx.fillRect(bx - 2, by - 2, 3, 3);
              }

              if (a.snapT < 150) {
                const s = a.snapT < 50 ? 0 : a.snapT < 100 ? 1 : 2;
                const L = s === 0 ? 46 : s === 1 ? 20 : 9;
                const ox = Math.round(t.ox) + 0.5, oy = Math.round(t.oy - sy) + 0.5;
                ctx.strokeStyle = s === 0 ? VERMILION : INK;
                ctx.lineWidth = s === 0 ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(ox - L, oy); ctx.lineTo(ox - 4, oy); ctx.moveTo(ox + 4, oy); ctx.lineTo(ox + L, oy);
                ctx.moveTo(ox, oy - L); ctx.lineTo(ox, oy - 4); ctx.moveTo(ox, oy + 4); ctx.lineTo(ox, oy + L);
                ctx.stroke();
                if (q === 2 && s > 0) {
                  const c = `${pad4(t.ox)},${pad4(t.oy)}`;
                  ctx.fillStyle = KNOCKOUT;
                  ctx.fillRect(ox + 7, oy - 19, c.length * mS + 6, 12);
                  ctx.fillStyle = STEEL;
                  ctx.fillText(c, ox + 10, oy - 12.5);
                }
              }
            }
          }

          // ------------------------------------------------------------ PASS 2: RITE TRAILS (ember · hairline · dash · tick)
          if (q > 0) {
            const cap = q === 2 ? TRAIL_MAX : 9;
            const buckets = [[], [], []];
            const ticks = [];
            const embers = [[], [], []];
            for (let n = 0; n < this.agents.length; n++) {
              const a = this.agents[n];
              const kind = a.def.rite.trail;
              const len = Math.min(a.tLen, cap);
              if (kind === "none" || len < 2 || a.tHead < 0) continue;
              const tMax = kind === "ember" ? 620 : a.state === "work" ? 540 : 420;
              for (let k = 0; k < len - 1; k++) {
                const i0 = ((a.tHead - k) % cap + cap) % cap;
                const i1 = ((a.tHead - k - 1) % cap + cap) % cap;
                const age = clock - a.tBuf[i0 * 3 + 2];
                if (age > tMax) break;
                const ratio = age / tMax;
                const x0 = a.tBuf[i0 * 3], y0 = a.tBuf[i0 * 3 + 1] - sy;
                const x1 = a.tBuf[i1 * 3], y1 = a.tBuf[i1 * 3 + 1] - sy;
                if ((y0 < -60 && y1 < -60) || (y0 > H + 60 && y1 > H + 60)) continue;
                if (kind === "ember") {
                  embers[ratio < 0.3 ? 0 : ratio < 0.65 ? 1 : 2].push(x0, y0 + ratio * ratio * 9);
                  continue;
                }
                if (kind === "tick") {
                  ticks.push(x0 - 3, y0, x0 + 3, y0, x0, y0 - 3, x0, y0 + 3);
                  continue;
                }
                const bIdx = kind === "dash" ? 0 : ratio < 0.33 ? 2 : ratio < 0.66 ? 1 : 0;
                if (q === 1 && bIdx === 0 && kind !== "dash") continue;
                buckets[bIdx].push(x0, y0, x1, y1);
              }
            }
            ctx.lineWidth = 1;
            const strokeSegs = (arr, style) => {
              if (!arr.length) return;
              ctx.strokeStyle = style;
              ctx.beginPath();
              for (let i = 0; i < arr.length; i += 4) { ctx.moveTo(arr[i], arr[i + 1]); ctx.lineTo(arr[i + 2], arr[i + 3]); }
              ctx.stroke();
            };
            ctx.setLineDash([2, 4]);
            strokeSegs(buckets[0], "rgba(244, 242, 236, 0.2)");
            ctx.setLineDash([]);
            strokeSegs(buckets[1], "rgba(244, 242, 236, 0.16)");
            strokeSegs(buckets[2], "rgba(244, 242, 236, 0.34)");
            strokeSegs(ticks, "rgba(154, 157, 166, 0.5)");
            const EMB = [GOLD, VERMILION, ASH];
            for (let b = 0; b < 3; b++) {
              const arr = embers[b];
              if (!arr.length) continue;
              ctx.fillStyle = EMB[b];
              ctx.globalAlpha = b === 2 ? 0.55 : 0.95;
              const sz = b === 0 ? 3 : 2;
              for (let i = 0; i < arr.length; i += 2) ctx.fillRect(Math.round(arr[i]) - 1, Math.round(arr[i + 1]) - 1, sz, sz);
            }
            ctx.globalAlpha = 1;
          }

          // ------------------------------------------------------------ PASS 3: GENESIS, LOCKS, IMPACTS, STAMPS & SPARKS
          if (this.rewind) {
            const u = this.rewind.t / this.rewind.dur;
            const cx = Math.round(W / 2) + 0.5, cy = Math.round(H * 0.42) + 0.5;
            ctx.lineWidth = 1;
            ctx.strokeStyle = VERMILION;
            ctx.globalAlpha = 0.15 + 0.5 * u;
            ctx.beginPath();
            for (let n = 0; n < this.agents.length; n++) {
              const a = this.agents[n];
              ctx.moveTo(cx, cy); ctx.lineTo(a.x, a.y - sy);
            }
            ctx.stroke();
            const sStep = Math.ceil((1 - u) * 6) / 6;
            const half = 14 + sStep * Math.min(W, H) * 0.34;
            ctx.strokeStyle = INK;
            ctx.globalAlpha = 0.25 + 0.6 * u;
            ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
            ctx.globalAlpha = 1;
          }

          if (this.genesis) {
            const g = this.genesis;
            g.t += dt;
            const u = g.t / g.dur;
            if (u >= 1) {
              this.genesis = null;
            } else {
              const R = Math.hypot(W, H) * 0.5;
              const gx = Math.round(g.x) + 0.5, gy = Math.round(g.y - sy) + 0.5;
              const hot = g.t < 70;
              ctx.strokeStyle = hot ? GOLD : VERMILION;
              ctx.lineWidth = hot ? 2 : 1;
              ctx.globalAlpha = hot ? 1 : Math.pow(1 - u, 2) * 0.8;
              ctx.beginPath();
              ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.moveTo(gx, 0); ctx.lineTo(gx, H);
              ctx.stroke();
              ctx.lineWidth = 1;
              ctx.strokeStyle = INK;
              for (let k = 0; k < 3; k++) {
                const uu = clamp(u * 1.3 - k * 0.11, 0, 1);
                if (uu <= 0 || uu >= 1) continue;
                let e = expoOut(uu);
                if (k === 1) e = Math.ceil(e * 9) / 9;
                const half = e * R * (0.72 - k * 0.16);
                ctx.globalAlpha = (1 - uu) * (k === 0 ? 0.6 : 0.32);
                if (k === 2) {
                  ctx.beginPath();
                  ctx.moveTo(gx, gy - half); ctx.lineTo(gx + half, gy); ctx.lineTo(gx, gy + half); ctx.lineTo(gx - half, gy);
                  ctx.closePath();
                  ctx.stroke();
                } else ctx.strokeRect(gx - half, gy - half, half * 2, half * 2);
              }
              if (q > 0) {
                const e = expoOut(Math.min(1, u * 1.6));
                ctx.lineWidth = 2;
                ctx.globalAlpha = Math.max(0, 1 - u * 1.5);
                for (let n = 0; n < this.agents.length; n++) {
                  const ang = (n / this.agents.length) * TAU;
                  const r0 = R * e * 0.3, r1 = r0 + 16;
                  ctx.strokeStyle = this.agents[n].def.color;
                  ctx.beginPath();
                  ctx.moveTo(gx + Math.cos(ang) * r0, gy + Math.sin(ang) * r0);
                  ctx.lineTo(gx + Math.cos(ang) * r1, gy + Math.sin(ang) * r1);
                  ctx.stroke();
                }
              }
              if (g.t < 520) {
                const s = g.t < 60 ? 0 : g.t < 130 ? 1 : 2;
                const pad = (s === 0 ? 34 : s === 1 ? 18 : 12) + 0.5;
                const leg = 26;
                ctx.strokeStyle = s === 0 ? VERMILION : INK;
                ctx.lineWidth = s === 0 ? 2 : 1;
                ctx.globalAlpha = s < 2 ? 1 : 0.7 * (1 - (g.t - 130) / 390);
                ctx.beginPath();
                ctx.moveTo(pad, pad + leg); ctx.lineTo(pad, pad); ctx.lineTo(pad + leg, pad);
                ctx.moveTo(W - pad - leg, pad); ctx.lineTo(W - pad, pad); ctx.lineTo(W - pad, pad + leg);
                ctx.moveTo(pad, H - pad - leg); ctx.lineTo(pad, H - pad); ctx.lineTo(pad + leg, H - pad);
                ctx.moveTo(W - pad - leg, H - pad); ctx.lineTo(W - pad, H - pad); ctx.lineTo(W - pad, H - pad - leg);
                ctx.stroke();
              }
              if (q === 2 && u < 0.86) {
                const full = `GENESIS ${String(g.n).padStart(2, "0")} · ${this.agents.length === 8 ? "VIII" : "V"} AGENTS · ${pad4(g.x)},${pad4(g.y)}`;
                const txt = full.slice(0, Math.ceil(g.t / 16));
                const tw = txt.length * mS + 10;
                const tx = Math.round(gx + 10), ty = Math.round(gy + 10);
                ctx.font = F_DIM;
                ctx.globalAlpha = u < 0.6 ? 1 : Math.ceil(((0.86 - u) / 0.26) * 3) / 3;
                ctx.fillStyle = KNOCKOUT;
                ctx.fillRect(tx, ty, tw, 14);
                ctx.fillStyle = VERMILION;
                ctx.fillRect(tx, ty, 2, 14);
                ctx.fillStyle = INK;
                ctx.fillText(txt, tx + 6, ty + 7.5);
              }
              ctx.globalAlpha = 1;
            }
          }

          for (let i = this.locks.length - 1; i >= 0; i--) {
            const l = this.locks[i];
            l.t += dt;
            if (l.t >= l.dur) { this.locks.splice(i, 1); continue; }
            const s = l.t < 55 ? 0 : l.t < 115 ? 1 : 2;
            const pad = s === 0 ? 16 : s === 1 ? 6 : 0;
            const x0 = Math.round(l.x - pad) + 0.5, y0 = Math.round(l.y - sy - pad) + 0.5;
            const x1 = Math.round(l.x + l.w + pad) + 0.5, y1 = Math.round(l.y - sy + l.h + pad) + 0.5;
            if (y0 > H + 20 || y1 < -20) continue;
            const leg = 18;
            ctx.strokeStyle = s === 0 ? VERMILION : INK;
            ctx.lineWidth = 2;
            ctx.globalAlpha = s < 2 ? 1 : 0.75 * (1 - (l.t - 115) / (l.dur - 115));
            ctx.beginPath();
            ctx.moveTo(x0, y0 + leg); ctx.lineTo(x0, y0); ctx.lineTo(x0 + leg, y0);
            ctx.moveTo(x1 - leg, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + leg);
            ctx.moveTo(x0, y1 - leg); ctx.lineTo(x0, y1); ctx.lineTo(x0 + leg, y1);
            ctx.moveTo(x1 - leg, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - leg);
            ctx.stroke();
            if (q === 2 && s > 0) {
              const txt = l.txt.slice(0, Math.ceil((l.t - 55) / 12));
              const tw = txt.length * mS + 10;
              const tx = clamp(Math.round(x1 - tw - 4), 4, W - tw - 4);
              const ty = clamp(Math.round(y0 + 5), 72, H - 20);
              ctx.font = F_DIM;
              ctx.fillStyle = KNOCKOUT;
              ctx.fillRect(tx, ty, tw, 14);
              ctx.fillStyle = GOLD;
              ctx.fillRect(tx, ty, 2, 14);
              ctx.fillStyle = INK;
              ctx.fillText(txt, tx + 6, ty + 7.5);
            }
          }
          ctx.globalAlpha = 1;

          for (let i = this.flashes.length - 1; i >= 0; i--) {
            const f = this.flashes[i];
            f.t += dt;
            if (f.t >= f.dur) { this.flashes.splice(i, 1); continue; }
            const fy = f.y - sy;
            if (fy > H + 40 || fy + f.h < -40) continue;
            if (f.fill && q > 0 && f.t < 70) {
              const big = f.w * f.h > 200000 ? 0.5 : 1;
              ctx.globalAlpha = (f.t < 36 ? 0.2 : 0.08) * big;
              ctx.fillStyle = f.gold ? GOLD : VERMILION;
              ctx.fillRect(Math.round(f.x), Math.round(fy), Math.round(f.w), Math.round(f.h));
            }
            const s = f.t < 50 ? 0 : f.t < 100 ? 1 : 2;
            const pad = s === 0 ? 12 : s === 1 ? 5 : 0;
            const leg = s === 0 ? 12 : 8;
            ctx.strokeStyle = s === 0 ? (f.gold ? GOLD : VERMILION) : INK;
            ctx.lineWidth = s === 0 ? 2 : 1;
            ctx.globalAlpha = s < 2 ? 1 : 0.6 * (1 - (f.t - 100) / (f.dur - 100));
            const x0 = Math.round(f.x - pad) + 0.5, y0 = Math.round(fy - pad) + 0.5;
            const x1 = Math.round(f.x + f.w + pad) + 0.5, y1 = Math.round(fy + f.h + pad) + 0.5;
            ctx.beginPath();
            ctx.moveTo(x0, y0 + leg); ctx.lineTo(x0, y0); ctx.lineTo(x0 + leg, y0);
            ctx.moveTo(x1 - leg, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + leg);
            ctx.moveTo(x0, y1 - leg); ctx.lineTo(x0, y1); ctx.lineTo(x0 + leg, y1);
            ctx.moveTo(x1 - leg, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - leg);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;

          for (let i = this.rules.length - 1; i >= 0; i--) {
            const r = this.rules[i];
            r.t += dt;
            if (r.t >= r.dur) { this.rules.splice(i, 1); continue; }
            const y = Math.round(r.y0 - sy) + 0.5;
            if (y < -4 || y > H + 4) continue;
            const hot = r.t < 45;
            const fade = 1 - r.t / r.dur;
            if (r.ext) {
              ctx.strokeStyle = VERMILION;
              ctx.lineWidth = 1;
              ctx.globalAlpha = 0.3 * fade;
              ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            }
            ctx.strokeStyle = hot && r.gold ? GOLD : VERMILION;
            ctx.lineWidth = hot ? 2 : 1;
            ctx.globalAlpha = hot ? 1 : 0.8 * fade;
            ctx.beginPath(); ctx.moveTo(Math.round(r.x0) - 10, y); ctx.lineTo(Math.round(r.x1) + 10, y); ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;

          for (let i = this.detents.length - 1; i >= 0; i--) {
            const d = this.detents[i];
            d.t += dt;
            const u = d.t / d.dur;
            if (u >= 1) { this.detents.splice(i, 1); continue; }
            const r = 3 + 11 * (1 - Math.pow(1 - u, 3));
            const dx = Math.round(d.x) + 0.5, dy = Math.round(d.y - sy) + 0.5;
            ctx.strokeStyle = d.vermilion ? VERMILION : INK;
            ctx.globalAlpha = 0.72 * (1 - u);
            ctx.beginPath();
            ctx.moveTo(dx, dy - r); ctx.lineTo(dx + r, dy); ctx.lineTo(dx, dy + r); ctx.lineTo(dx - r, dy);
            ctx.closePath();
            ctx.stroke();
          }
          ctx.globalAlpha = 1;

          if (q === 2 && this.stamps.length) {
            ctx.font = F_DIM;
            for (let i = this.stamps.length - 1; i >= 0; i--) {
              const s = this.stamps[i];
              s.t += dt;
              if (s.t >= s.dur) { this.stamps.splice(i, 1); continue; }
              const y = Math.round(s.y - sy);
              if (y < 4 || y > H - 16) continue;
              const u = s.t / s.dur;
              const txt = s.txt.slice(0, Math.ceil(s.t / 13));
              const tw = txt.length * mS + 9;
              const x = clamp(Math.round(s.x), 4, W - tw - 4);
              ctx.globalAlpha = u < 0.7 ? 1 : Math.ceil(((1 - u) / 0.3) * 3) / 3;
              ctx.fillStyle = KNOCKOUT;
              ctx.fillRect(x, y, tw, 12);
              ctx.fillStyle = s.t < 110 ? VERMILION : ASH;
              ctx.fillRect(x, y, 2, 12);
              ctx.fillStyle = s.t < 110 ? VERMILION : STEEL;
              ctx.fillText(txt, x + 5, y + 6.5);
            }
            ctx.globalAlpha = 1;
          }

          if (this.pCount > 0) {
            const dts = dt / 1000;
            const drag = Math.pow(0.16, dts);
            const pb = this.pBuf;
            for (let i = this.pCount - 1; i >= 0; i--) {
              const b = i * 7;
              pb[b + 4] += dt;
              const age = pb[b + 4], life = pb[b + 5];
              if (age >= life) {
                this.pCount--;
                if (i < this.pCount) {
                  const last = this.pCount * 7;
                  for (let k = 0; k < 7; k++) pb[b + k] = pb[last + k];
                }
                continue;
              }
              pb[b + 2] *= drag;
              pb[b + 3] = pb[b + 3] * drag + 620 * dts;
              pb[b] += pb[b + 2] * dts;
              pb[b + 1] += pb[b + 3] * dts;
              if (q === 0) continue;
              const frac = age / life;
              const kind = pb[b + 6];
              const px = Math.round(pb[b]), py = Math.round(pb[b + 1] - sy);
              ctx.globalAlpha = frac > 0.6 ? (1 - frac) / 0.4 : 1;
              ctx.fillStyle = kind === 0 ? INK : kind === 2 && frac < 0.45 ? GOLD : frac > 0.8 ? ASH : VERMILION;
              ctx.fillRect(px, py, 2, 2);
              if (frac < 0.5 && kind !== 0) {
                ctx.globalAlpha *= 0.5;
                ctx.fillRect(Math.round(px - pb[b + 2] * 0.022), Math.round(py - pb[b + 3] * 0.022), 1, 1);
              }
            }
            ctx.globalAlpha = 1;
          }

          // --------------- PASS 5: VERB TAGS · TELEMETRY · DATUM TICKS · LOCK-IN CUES
          if (q > 0) {
            ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
            for (let n = 0; n < this.agents.length; n++) {
              const a = this.agents[n];
              if (a.state !== "work" && a.state !== "travel") continue;
              const x = Math.round(a.x), y = Math.round(a.y - sy);
              if (y < -20 || y > H + 20 || x < -40 || x > W + 40) continue;
              const working = a.state === "work";
              const label = a.verb ? `${a.def.roman}·${a.verb}` : a.def.roman;
              const tw = label.length * this.monoW + 10;
              const bx = x + 15 + tw > W - 6 ? x - 15 - tw : x + 15;
              const by = clamp(y - 7, 68, H - 18);
              ctx.globalAlpha = a.alpha * (working ? 0.96 : 0.72);
              ctx.fillStyle = KNOCKOUT;
              ctx.fillRect(bx, by, tw, 14);
              // Forge lock-in cue: the tag fills as the plate completes
              if (working && a.task) {
                const u = clamp(a.wt / a.wdur, 0, 1);
                if (u > 0.02) {
                  ctx.fillStyle = a.def.rite.gold ? GOLD : VERMILION;
                  ctx.fillRect(bx + 2, by + 12, Math.round((tw - 4) * u), 2);
                }
              }
              ctx.fillStyle = working ? VERMILION : a.def.color;
              ctx.fillRect(bx, by, 2, 14);
              ctx.fillStyle = working ? INK : STEEL;
              ctx.fillText(label, bx + 5, by + 7.5);
              const t = a.task;
              if (working && t) {
                // Datum ticks riding the rule — the measuring tape while a line is drawn
                if (t.type === "line") {
                  const ox = Math.round(t.ox) + 0.5, oy = Math.round(t.oy - sy) + 0.5;
                  const ddx = x - ox, ddy = y - oy;
                  const len = Math.hypot(ddx, ddy) || 1;
                  const nx = -ddy / len, ny = ddx / len;
                  ctx.strokeStyle = "rgba(154, 157, 166, 0.5)";
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  for (let k = 1; k <= 3; k++) {
                    const f = k / 4;
                    const mx = ox + ddx * f, my = oy + ddy * f;
                    ctx.moveTo(mx - nx * 3, my - ny * 3);
                    ctx.lineTo(mx + nx * 3, my + ny * 3);
                  }
                  ctx.stroke();
                }
                // Agent telemetry: plate datum + forge progress (q2 only, dim, right-edge clamped)
                if (q === 2) {
                  const u = clamp(a.wt / a.wdur, 0, 1);
                  const pct = String(Math.round(u * 100)).padStart(3, "0");
                  const tele = `${pad4(t.ox)},${pad4(t.oy)} · ${pct}%`;
                  const tw2 = tele.length * mS + 7;
                  const bx2 = clamp(bx + 1, 4, W - tw2 - 4);
                  ctx.font = F_DIM;
                  ctx.globalAlpha = a.alpha * 0.62;
                  ctx.fillStyle = KNOCKOUT;
                  ctx.fillRect(bx2, by + 16, tw2, 11);
                  ctx.fillStyle = u > 0.98 ? GOLD : ASH;
                  ctx.fillText(tele, bx2 + 3, by + 22);
                  ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
                }
              }
            }
            ctx.globalAlpha = 1;
          }

          // ------------------------------------------------------------ PASS 6: THE EIGHT SIGIL CURSORS (pixel-snapped, 32x32, hotspot centre)
          const detentOn = ((clock / 250) | 0) % 2 === 0;
          for (let n = 0; n < this.agents.length; n++) {
            const a = this.agents[n];
            const x = Math.round(a.x), y = Math.round(a.y - sy);
            if (y < -40 || y > H + 40 || x < -40 || x > W + 40) continue;
            const d = a.def;
            const active = a.state === "work";
            const name = d.name;
            const rot = name === "Hermes" ? a.rot : name === "Hephaestus" ? a.tilt : 0;

            ctx.save();
            ctx.globalAlpha = a.alpha;
            ctx.translate(x + 0.5, y + 0.5);
            if (rot) ctx.rotate(rot);
            ctx.translate(-16, -16);

            // Knockout halo → iron body → mineral edge
            ctx.lineWidth = 3.5; ctx.strokeStyle = KNOCKOUT; ctx.stroke(d.glyph);
            if (d.solid) { ctx.fillStyle = IRON; ctx.fill(d.glyph, "evenodd"); }
            ctx.lineWidth = 1.15; ctx.strokeStyle = active ? INK : d.color; ctx.stroke(d.glyph);

            if (name === "Prometheus") {
              ctx.fillStyle = active && detentOn ? GOLD : VERMILION;
              ctx.fill(ACCENTS.flame);
            } else if (name === "Athena") {
              if (active && detentOn) { ctx.lineWidth = 1.5; ctx.strokeStyle = VERMILION; ctx.stroke(ACCENTS.spearCore); }
            } else if (name === "Daedalus") {
              ctx.fillStyle = active ? VERMILION : STEEL;
              ctx.fillRect(15, 16, 2, 2);
            } else if (name === "Hermes") {
              ctx.lineWidth = 1.25; ctx.strokeStyle = active ? VERMILION : STEEL; ctx.stroke(ACCENTS.wing);
            } else if (name === "Chronos") {
              const ang = (((clock / (active ? 110 : 1000)) | 0) % 12) * (TAU / 12) - Math.PI / 2;
              ctx.lineWidth = 1.25; ctx.strokeStyle = active ? VERMILION : INK;
              ctx.beginPath(); ctx.moveTo(16, 16); ctx.lineTo(16 + Math.cos(ang) * 6, 16 + Math.sin(ang) * 6); ctx.stroke();
            } else if (name === "Iris") {
              ctx.lineWidth = 1;
              ctx.strokeStyle = active ? INK : STEEL; ctx.stroke(ACCENTS.rayIn);
              ctx.strokeStyle = active ? GOLD : STEEL; ctx.stroke(ACCENTS.ray0);
              ctx.strokeStyle = active ? VERMILION : STEEL; ctx.stroke(ACCENTS.ray1);
              ctx.strokeStyle = active ? INK : ASH; ctx.stroke(ACCENTS.ray2);
            } else if (name === "Nyx") {
              ctx.fillStyle = KNOCKOUT;
              ctx.beginPath(); ctx.arc(18.5, 14, 5.5, 0, TAU); ctx.fill();
              ctx.lineWidth = 1; ctx.strokeStyle = active ? VERMILION : INK; ctx.stroke(ACCENTS.horizon);
            } else {
              ctx.lineWidth = 1.5; ctx.strokeStyle = active ? (a.tilt > -0.2 ? GOLD : VERMILION) : STEEL; ctx.stroke(ACCENTS.face);
            }

            if (name !== "Daedalus" && name !== "Chronos") {
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              ctx.fillStyle = active ? VERMILION : INK;
              ctx.fillRect(x - 0.5, y - 0.5, 2, 2);
            }
            ctx.restore();
          }
        }
      }

      const swarm = new Swarm();

      // Animated counters
      function animateCounter(el) {
        const to = parseInt(el.dataset.to, 10) || 0;
        if (REDUCED_MOTION) { el.textContent = to; return; }
        const start = performance.now();
        const dur = 1400;
        function step(now) {
          const t = Math.min(1, (now - start) / dur);
          el.textContent = Math.round(to * expoOut(t));
          if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      }

      // Live Forge cycle listener — GSAP-staged: chip punch, corner re-registration,
      // hot-seam weld, compositor-only anvil inhale. Zero layout shift.
      const forgeArtboard = document.getElementById("live-artboard");
      const forgeSeamEl = document.getElementById("forge-seam");
      const forgeInhaleEl = document.getElementById("forge-inhale");
      const forgeCorners = forgeArtboard ? Array.from(forgeArtboard.querySelectorAll(".forge-corner")) : [];
      const GS = () => window.gsap; // CDN script is deferred — resolve lazily

      const setForgeState = (state) => {
        stageStateEl.textContent = state;
        if (forgeArtboard) forgeArtboard.setAttribute("data-ak-state", state);
        const G = GS();
        if (REDUCED_MOTION || !G) return;
        G.fromTo(stageStateEl, { scale: 1.45, y: -3 }, { scale: 1, y: 0, duration: 0.42, ease: "power4.out", overwrite: "auto", clearProps: "transform" });
      };

      forgeZoneEl.addEventListener("ak:state", (e) => {
        const state = e.detail;
        setForgeState(state);
        const G = GS();
        const motion = !REDUCED_MOTION && G;
        if (state === "building" && motion && forgeCorners.length) {
          // overwrite:"auto" preserves any in-flight corner scale snap from dissolved
          G.fromTo(forgeCorners, { opacity: 0.25 }, { opacity: 0.9, duration: 0.5, ease: "power1.out", overwrite: "auto" });
        }
        if (state === "built" && !REDUCED_MOTION) {
          forgeZoneEl.classList.remove("ak-forge-strike");
          void forgeZoneEl.offsetWidth;
          forgeZoneEl.classList.add("ak-forge-strike");
        }
        if (state === "dissolving" && motion && forgeInhaleEl) {
          // Compositor-only vermilion anvil inhale (keeps .artboard outer shadow intact)
          G.fromTo(
            forgeInhaleEl,
            { opacity: 1 },
            { opacity: 0, duration: 0.72, ease: "power2.out", overwrite: "auto" }
          );
        }
        if (state === "dissolved") {
          forgeCycle += 1;
          const idx = forgeCycle % FORGE_TEMPLATES.length;
          forgeZoneEl.innerHTML = FORGE_TEMPLATES[idx]();
          stageCycleEl.textContent = `Cycle ${String(forgeCycle + 1).padStart(2, "0")} · ${FORGE_NAMES[idx]}`;
          requestAnimationFrame(() => swarm.rescan(forgeZoneEl));
          if (motion && forgeSeamEl) {
            const fromLeft = forgeCycle % 2 === 1;
            const tl = G.timeline();
            tl.set(forgeSeamEl, { transformOrigin: fromLeft ? "left center" : "right center" }, 0)
              .fromTo(forgeSeamEl, { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 0.36, ease: "power4.in" }, 0)
              .to(forgeSeamEl, { opacity: 0, duration: 0.24, ease: "power1.out" })
              .set(forgeSeamEl, { scaleX: 0 });
            if (forgeCorners.length) {
              G.fromTo(forgeCorners, { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 0.9, duration: 0.55, ease: "power4.out", stagger: 0.04, overwrite: "auto", clearProps: "transform" });
            }
            G.fromTo(stageCycleEl, { y: -5, opacity: 0.15 }, { y: 0, opacity: 1, duration: 0.34, ease: "power3.out", overwrite: "auto", clearProps: "transform,opacity" });
            G.fromTo(forgeZoneEl, { opacity: 0.3 }, { opacity: 1, duration: 0.32, ease: "power1.out", clearProps: "opacity" });
          }
        }
      });

      const artboardEl = document.getElementById("live-artboard");
      const coordsEl = document.getElementById("stage-coords");
      artboardEl.addEventListener("pointermove", (e) => {
        const r = artboardEl.getBoundingClientRect();
        coordsEl.textContent = `X ${String(Math.max(0, Math.round(e.clientX - r.left))).padStart(4, "0")} · Y ${String(Math.max(0, Math.round(e.clientY - r.top))).padStart(4, "0")}`;
      }, { passive: true });
      artboardEl.addEventListener("pointerdown", (e) => swarm.summon(e.clientX, e.clientY));

      /* ==============================================================
         5. COSMOS STARFIELD CANVAS
         ============================================================== */
      (function initCosmos() {
        const c = document.getElementById("cosmos-canvas");
        const ctx = c.getContext("2d");
        const HUES = ["#F4F2EC", "#F4F2EC", "#F4F2EC", "#FFD2BF", "#BFEFFF", "#E5A93C"];
        const wrap = (v, m) => ((v % m) + m) % m;
        let W = 0, H = 0, stars = [], links = [], t0 = 0, shoot = null, nextShoot = 4000;
        const ptr = { x: 0, y: 0, tx: 0, ty: 0 };

        const build = () => {
          const dpr = Math.min(window.devicePixelRatio || 1, ticker.quality === 2 ? 2 : 1);
          W = window.innerWidth; H = window.innerHeight;
          c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const n = Math.round(Math.max(80, Math.min(260, (W * H) / 5600)) * (ticker.quality === 0 ? 0.5 : 1));
          stars = Array.from({ length: n }, () => {
            const z = Math.pow(Math.random(), 2) * 0.9 + 0.1;
            return { x: Math.random() * W, y: Math.random() * H, z, r: 0.6 + z * 1.5, tw: Math.random() * 6.28, sp: 0.0006 + Math.random() * 0.002, hue: HUES[(Math.random() * HUES.length) | 0], px: 0, py: 0 };
          }).sort((a, b) => (a.hue < b.hue ? -1 : 1));
          const near = stars.filter((s) => s.z > 0.45);
          links = [];
          for (let k = 0; k < 6 && near.length > 6; k++) {
            let cur = near[(Math.random() * near.length) | 0];
            const used = new Set([cur]);
            for (let j = 0; j < 4; j++) {
              let best = null, bd = 240 * 240;
              near.forEach((s) => {
                if (used.has(s)) return;
                const d = (s.x - cur.x) ** 2 + (s.y - cur.y) ** 2;
                if (d < bd) { bd = d; best = s; }
              });
              if (!best) break;
              links.push([cur, best, k]);
              used.add(best); cur = best;
            }
          }
        };

        window.addEventListener("pointermove", (e) => {
          ptr.tx = e.clientX / (W || 1) - 0.5;
          ptr.ty = e.clientY / (H || 1) - 0.5;
        }, { passive: true });

        let lastW = window.innerWidth;
        window.addEventListener("resize", () => {
          if (window.innerWidth !== lastW || Math.abs(window.innerHeight - H) > 140) {
            lastW = window.innerWidth; build();
          }
        }, { passive: true });
        ticker.onQuality.add(build);
        build();

        ticker.add((dt, now) => {
          if (!t0) t0 = now;
          const intro = Math.min(1, (now - t0) / 2000);
          const zoom = 0.35 + 0.65 * (1 - Math.pow(2, -10 * intro));
          const sy = window.scrollY;
          ptr.x += (ptr.tx - ptr.x) * 0.05;
          ptr.y += (ptr.ty - ptr.y) * 0.05;
          const cx = W / 2, cy = H * 0.42;
          ctx.clearRect(0, 0, W, H);
          let hue = "";
          for (let i = 0; i < stars.length; i++) {
            const s = stars[i];
            const bx = wrap(s.x - ptr.x * s.z * 46, W);
            const by = wrap(s.y - sy * s.z * 0.16 - ptr.y * s.z * 46, H);
            s.px = cx + (bx - cx) * zoom;
            s.py = cy + (by - cy) * zoom;
            if (s.hue !== hue) ctx.fillStyle = hue = s.hue;
            ctx.globalAlpha = (0.25 + 0.75 * s.z) * (0.62 + 0.38 * Math.sin(now * s.sp + s.tw)) * Math.min(1, intro * 3);
            ctx.fillRect(s.px, s.py, s.r, s.r);
          }
          ctx.strokeStyle = "#F4F2EC";
          ctx.lineWidth = 0.6;
          for (let i = 0; i < links.length; i++) {
            const [a, b, k] = links[i];
            if (Math.abs(a.px - b.px) > 320 || Math.abs(a.py - b.py) > 320) continue;
            ctx.globalAlpha = 0.15 * (0.5 + 0.5 * Math.sin(now * 0.00035 + k * 1.7)) * intro;
            ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
          }
          nextShoot -= dt;
          if (nextShoot < 0 && !shoot) {
            shoot = { x: Math.random() * W * 0.8, y: Math.random() * H * 0.4, t: 0 };
            nextShoot = 5000 + Math.random() * 7000;
          }
          if (shoot) {
            shoot.t += dt / 900;
            const u = shoot.t, hx = shoot.x + u * 420, hy = shoot.y + u * 170;
            const g = ctx.createLinearGradient(hx, hy, hx - 150, hy - 60);
            g.addColorStop(0, "rgba(244,242,236,.9)");
            g.addColorStop(1, "rgba(244,242,236,0)");
            ctx.globalAlpha = Math.sin(Math.min(1, u) * Math.PI);
            ctx.strokeStyle = g; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - 150, hy - 60); ctx.stroke();
            if (u >= 1) shoot = null;
          }
          ctx.globalAlpha = 1;
        });
      })();

      /* ==============================================================
         6. HERO 3D ARMILLARY SPHERE CANVAS
         ============================================================== */
      /* ==============================================================
         7. REGISTRY LIVE 60FPS HERO FX CANVAS (MATRIX / GLOBE / BEAMS)
         ============================================================== */
      (function initHeroFx() {
        const c = document.getElementById("herofx-canvas");
        const ctx = c.getContext("2d");
        let w = 400, h = 265, visible = true, mode = "matrix";
        const ptr = { x: 0.62, y: 0.48 };

        const resize = () => {
          const r = c.getBoundingClientRect();
          w = Math.max(240, r.width); h = Math.max(200, r.height);
          const dpr = Math.min(window.devicePixelRatio || 1, ticker.quality === 2 ? 2 : 1.25);
          c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        new ResizeObserver(resize).observe(c);
        new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(c);
        resize();

        c.addEventListener("pointermove", (e) => {
          const r = c.getBoundingClientRect();
          ptr.x = (e.clientX - r.left) / r.width;
          ptr.y = (e.clientY - r.top) / r.height;
        }, { passive: true });

        document.querySelectorAll("#herofx-tabs button").forEach((btn) => {
          btn.addEventListener("click", () => {
            mode = btn.dataset.fx;
            document.querySelectorAll("#herofx-tabs button").forEach((b) => b.classList.toggle("chip-on", b === btn));
          });
        });

        ticker.add((_, now) => {
          if (!visible) return;
          const t = now * 0.001;
          ctx.fillStyle = "#0d0d12";
          ctx.fillRect(0, 0, w, h);
          const px = ptr.x * w, py = ptr.y * h;

          if (mode === "matrix") {
            const step = ticker.quality === 0 ? 28 : 20;
            for (let y = step * 0.5; y < h; y += step) {
              for (let x = step * 0.5; x < w; x += step) {
                const dist = Math.hypot(x - px, y - py);
                const focus = Math.max(0, 1 - dist / 150);
                const wave = Math.sin(x * 0.025 + y * 0.02 - t * 2.2) * 0.5 + 0.5;
                ctx.fillStyle = focus > 0.3 ? `rgba(255,61,0,${0.25 + focus * 0.75})` : `rgba(244,242,236,${0.1 + wave * 0.14})`;
                ctx.beginPath();
                ctx.arc(x, y, 1 + focus * 2.3 + wave * 0.4, 0, TAU);
                ctx.fill();
              }
            }
          } else if (mode === "beams") {
            const count = ticker.quality === 0 ? 10 : 18;
            for (let i = 0; i < count; i++) {
              const x = ((i + 0.5) / count) * w;
              const speed = 38 + (i % 4) * 22;
              const by = ((t * speed + i * 71) % (h + 120)) - 60;
              const grad = ctx.createLinearGradient(x, by - 60, x, by + 10);
              grad.addColorStop(0, "rgba(0,240,255,0)");
              grad.addColorStop(0.8, i % 3 === 0 ? "rgba(255,61,0,0.75)" : "rgba(0,240,255,0.55)");
              grad.addColorStop(1, "#F4F2EC");
              ctx.strokeStyle = grad; ctx.lineWidth = 1.25;
              ctx.beginPath(); ctx.moveTo(x, by - 60); ctx.lineTo(x, by + 10); ctx.stroke();
            }
          } else {
            const cx = w * 0.65, cy = h * 0.52, rad = Math.min(w, h) * 0.38;
            const pts = ticker.quality === 0 ? 100 : 190;
            const rotY = t * 0.45 + (ptr.x - 0.5) * 1.4, rotX = 0.28 + (ptr.y - 0.5) * 0.7;
            const cosY = Math.cos(rotY), sinY = Math.sin(rotY), cosX = Math.cos(rotX), sinX = Math.sin(rotX);
            for (let i = 0; i < pts; i++) {
              const phi = Math.acos(1 - (2 * (i + 0.5)) / pts);
              const theta = Math.PI * (1 + Math.sqrt(5)) * i;
              const x0 = Math.sin(phi) * Math.cos(theta), y0 = Math.cos(phi), z0 = Math.sin(phi) * Math.sin(theta);
              const x1 = x0 * cosY - z0 * sinY, z1 = x0 * sinY + z0 * cosY;
              const y2 = y0 * cosX - z1 * sinX, z2 = y0 * sinX + z1 * cosX;
              const depth = (z2 + 1.2) / 2.2;
              if (depth < 0.1) continue;
              ctx.fillStyle = i % 11 === 0 ? `rgba(255,61,0,${depth})` : `rgba(244,242,236,${depth * 0.8})`;
              ctx.beginPath();
              ctx.arc(cx + x1 * rad, cy + y2 * rad, 0.9 + depth * 1.5, 0, TAU);
              ctx.fill();
            }
          }
        });
      })();

      /* ==============================================================
         8. MICRO-INTERACTIONS, SPOTLIGHT, PARALLAX & SCROLLING
         ============================================================== */
      // Spotlight hover coordinates
      document.querySelectorAll(".spot").forEach((el) => {
        el.addEventListener("pointermove", (e) => {
          const r = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${e.clientX - r.left}px`);
          el.style.setProperty("--my", `${e.clientY - r.top}px`);
        }, { passive: true });
      });

      // Magnetic spring buttons
      document.querySelectorAll(".magnetic").forEach((wrap) => {
        const strength = parseFloat(wrap.dataset.strength) || 0.32;
        let tx = 0, ty = 0, cx = 0, cy = 0, active = false;
        wrap.addEventListener("pointermove", (e) => {
          const r = wrap.getBoundingClientRect();
          tx = (e.clientX - r.left - r.width / 2) * strength;
          ty = (e.clientY - r.top - r.height / 2) * strength;
          active = true;
        });
        wrap.addEventListener("pointerleave", () => { tx = 0; ty = 0; });
        ticker.add(() => {
          if (!active && Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05) return;
          cx += (tx - cx) * 0.16;
          cy += (ty - cy) * 0.16;
          wrap.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
          if (tx === 0 && ty === 0 && Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05) {
            cx = cy = 0; active = false; wrap.style.transform = "";
          }
        });
      });

      // Scroll parallax (Hero orb, Hero head, Marquee shift, Monolith image)
      const orbWrap = document.getElementById("hero-orb-wrap");
      const headWrap = document.getElementById("hero-head-wrap");
      const marqueeEl = document.getElementById("editorial-marquee");
      const marqueeShift = document.getElementById("marquee-shift");
      const monolithFrame = document.getElementById("monolith-frame");
      const monolithImg = document.getElementById("monolith-img");

      ticker.add(() => {
        const sy = window.scrollY;
        const p = clamp(sy / 900, 0, 1);
        orbWrap.style.transform = `translate3d(0, ${(p * 170).toFixed(1)}px, 0) scale(${(1 - p * 0.13).toFixed(3)})`;
        headWrap.style.transform = `translate3d(0, ${(-p * 62).toFixed(1)}px, 0)`;

        const mr = marqueeEl.getBoundingClientRect();
        if (mr.bottom > 0 && mr.top < window.innerHeight) {
          const mp = clamp((window.innerHeight - mr.top) / (window.innerHeight + mr.height), 0, 1);
          marqueeShift.style.transform = `translate3d(${(4 - mp * 12).toFixed(2)}%, 0, 0)`;
        }
        const fr = monolithFrame.getBoundingClientRect();
        if (fr.bottom > 0 && fr.top < window.innerHeight) {
          const fp = clamp((window.innerHeight - fr.top) / (window.innerHeight + fr.height), 0, 1);
          monolithImg.style.transform = `translate3d(0, ${(-18 + fp * 18).toFixed(2)}%, 0)`;
        }
      });

      // Typography switcher
      const FACES = [
        ["f-display font-extrabold uppercase", "clamp(2.7rem, 8vw, 7.2rem)"],
        ["f-serif italic font-normal", "clamp(3rem, 8.5vw, 7.6rem)"],
        ["f-mono font-medium", "clamp(2rem, 6vw, 5.2rem)"],
      ];
      const specEl = document.getElementById("type-specimen");
      const clampEl = document.getElementById("face-clamp");
      document.querySelectorAll("#face-buttons button").forEach((btn) => {
        const setFace = () => {
          const i = parseInt(btn.dataset.face, 10);
          specEl.className = `${FACES[i][0]} truncate py-3 text-5xl leading-none text-[var(--ink)] sm:text-7xl`;
          clampEl.textContent = FACES[i][1];
          document.querySelectorAll("#face-buttons button").forEach((b) => b.classList.toggle("chip-on", b === btn));
        };
        btn.addEventListener("click", setFace);
        btn.addEventListener("mouseenter", setFace);
      });

      // Magnetic demo button feedback
      document.getElementById("magnetic-demo-btn").addEventListener("click", () => {
        showToast("Spring 260 / 16 · engaged");
      });

      // Replay genesis handlers
      function replayGenesis() {
        if (typeof window.__akNavigate === "function") window.__akNavigate("home", false);
        window.scrollTo({ top: 0, behavior: "instant" });
        swarm.replay();
      }
      const navReplayBtn = document.getElementById("nav-replay-btn");
      if (navReplayBtn) navReplayBtn.addEventListener("click", replayGenesis);
      const footerReplayBtn = document.getElementById("footer-replay-btn");
      if (footerReplayBtn) footerReplayBtn.addEventListener("click", replayGenesis);

      // Architectural GSAP 3.12 Command Drawer + Live Vernier Drafting Canvas
      const menuToggle = document.getElementById("menu-toggle");
      const menuClose = document.getElementById("menu-close");
      const siteMenu = document.getElementById("site-menu");
      const menuDrawer = document.getElementById("menu-drawer");
      const menuBg = siteMenu ? siteMenu.querySelector(".menu-bg") : null;
      const menuRuleFlame = document.getElementById("menu-rule-flame");
      const menuCanvas = document.getElementById("menu-canvas");
      const menuCoord = document.getElementById("menu-coord");
      const menuLiveView = document.getElementById("menu-live-view");
      let menuLastFocus = null;
      let menuTl = null;
      let menuRaf = 0;

      // Hydrate Lucide icons if loaded
      if (window.lucide && typeof window.lucide.createIcons === "function") {
        try { window.lucide.createIcons(); } catch (_) {}
      }

      // Magnetic hover pull on hamburger button via GSAP quickTo
      if (menuToggle && !REDUCED_MOTION && typeof window.gsap !== "undefined" && window.matchMedia("(pointer: fine)").matches) {
        const qx = window.gsap.quickTo(menuToggle, "x", { duration: 0.35, ease: "power3.out" });
        const qy = window.gsap.quickTo(menuToggle, "y", { duration: 0.35, ease: "power3.out" });
        menuToggle.addEventListener("pointermove", (e) => {
          const r = menuToggle.getBoundingClientRect();
          qx((e.clientX - (r.left + r.width / 2)) * 0.28);
          qy((e.clientY - (r.top + r.height / 2)) * 0.28);
        });
        menuToggle.addEventListener("pointerleave", () => { qx(0); qy(0); });
      }

      // Live Vernier Drafting Lattice inside the opened drawer
      let mx = 0, my = 0, tx = 0, ty = 0, mIn = false;
      if (menuDrawer) {
        menuDrawer.addEventListener("pointermove", (e) => {
          const r = menuDrawer.getBoundingClientRect();
          tx = e.clientX - r.left; ty = e.clientY - r.top; mIn = true;
          if (menuCoord) menuCoord.textContent = "X " + String(Math.round(tx)).padStart(3, "0") + " · Y " + String(Math.round(ty)).padStart(3, "0");
        }, { passive: true });
        menuDrawer.addEventListener("pointerleave", () => { mIn = false; });
      }
      function startMenuCanvas() {
        if (!menuCanvas || REDUCED_MOTION || menuRaf) return;
        const ctx = menuCanvas.getContext("2d");
        if (!ctx) return;
        const draw = () => {
          if (!siteMenu || !siteMenu.classList.contains("open")) { menuRaf = 0; return; }
          const r = menuCanvas.getBoundingClientRect();
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
          if (menuCanvas.width !== Math.round(w * dpr) || menuCanvas.height !== Math.round(h * dpr)) {
            menuCanvas.width = Math.round(w * dpr); menuCanvas.height = Math.round(h * dpr);
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          mx += ((mIn ? tx : w * 0.35) - mx) * 0.12;
          my += ((mIn ? ty : h * 0.3) - my) * 0.12;
          // Ambient flame glow
          const g = ctx.createRadialGradient(mx, my, 0, mx, my, 210);
          g.addColorStop(0, "rgba(255, 61, 0, 0.11)");
          g.addColorStop(0.5, "rgba(229, 169, 60, 0.035)");
          g.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
          // Subtle architectural dot lattice
          const step = 28;
          ctx.fillStyle = "rgba(244, 242, 236, 0.08)";
          for (let y = 20; y < h; y += step) {
            for (let x = 20; x < w; x += step) {
              const d = Math.hypot(x - mx, y - my);
              const s = d < 120 ? 1.5 - (d / 120) * 0.7 : 0.8;
              ctx.fillRect(x, y, s, s);
            }
          }
          if (mIn) {
            ctx.strokeStyle = "rgba(255, 61, 0, 0.16)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(mx, 0); ctx.lineTo(mx, h);
            ctx.moveTo(0, my); ctx.lineTo(w, my);
            ctx.stroke();
          }
          menuRaf = requestAnimationFrame(draw);
        };
        menuRaf = requestAnimationFrame(draw);
      }

      function setMenu(open) {
        if (!siteMenu || !menuToggle) return;
        menuToggle.setAttribute("aria-expanded", String(open));
        menuToggle.setAttribute("aria-label", open ? "Close index menu" : "Open index menu");
        siteMenu.setAttribute("aria-hidden", String(!open));
        document.documentElement.classList.toggle("menu-open", open);
        ak.audio.play("drawer", { open });

        const activeBtn = siteMenu.querySelector(".idx-row.is-active .idx-title");
        if (menuLiveView && activeBtn) menuLiveView.textContent = activeBtn.textContent.toUpperCase();

        const hasGsap = typeof window.gsap !== "undefined" && !REDUCED_MOTION;
        if (menuTl) { menuTl.kill(); menuTl = null; }

        if (open) {
          siteMenu.classList.add("open");
          menuLastFocus = document.activeElement;
          startMenuCanvas();
          if (hasGsap && menuDrawer) {
            const rows = siteMenu.querySelectorAll(".idx-row");
            const extras = siteMenu.querySelectorAll(".menu-chapters, .menu-ai-dock, .menu-foot");
            menuTl = window.gsap.timeline();
            if (menuBg) menuTl.fromTo(menuBg, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" }, 0);
            menuTl.fromTo(menuDrawer, { xPercent: -100 }, { xPercent: 0, duration: 0.56, ease: "expo.out", clearProps: "transform" }, 0);
            if (menuRuleFlame) {
              menuTl.fromTo(menuRuleFlame, { strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 0.72, ease: "power4.inOut" }, 0.12);
            }
            menuTl.fromTo(rows, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.52, ease: "power4.out", stagger: 0.042, clearProps: "transform,opacity" }, 0.12);
            menuTl.fromTo(extras, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out", stagger: 0.06, clearProps: "transform,opacity" }, 0.28);
          } else if (menuRuleFlame) {
            menuRuleFlame.style.strokeDashoffset = "0";
          }
          const first = menuClose || siteMenu.querySelector(".idx-row");
          if (first) first.focus({ preventScroll: true });
        } else {
          if (menuRaf) { cancelAnimationFrame(menuRaf); menuRaf = 0; }
          if (hasGsap && menuDrawer && siteMenu.classList.contains("open")) {
            menuTl = window.gsap.timeline({
              onComplete: () => {
                siteMenu.classList.remove("open");
                window.gsap.set(menuDrawer, { clearProps: "transform" });
              }
            });
            menuTl.to(menuDrawer, { xPercent: -102, duration: 0.32, ease: "power3.in" }, 0);
            if (menuBg) menuTl.to(menuBg, { opacity: 0, duration: 0.26, ease: "power2.in" }, 0);
          } else {
            siteMenu.classList.remove("open");
          }
          if (menuLastFocus && menuLastFocus.focus) menuLastFocus.focus({ preventScroll: true });
        }
      }

      if (menuToggle) menuToggle.addEventListener("click", () => setMenu(!siteMenu.classList.contains("open")));
      if (menuClose) menuClose.addEventListener("click", () => setMenu(false));
      if (siteMenu) {
        siteMenu.addEventListener("click", (e) => {
          if (e.target === siteMenu || e.target.classList.contains("menu-bg")) setMenu(false);
        });
      }

      document.addEventListener("keydown", (e) => {
        if (!siteMenu) return;
        const isOpen = siteMenu.classList.contains("open");
        if (e.key === "Escape" && isOpen) { setMenu(false); return; }
        if (e.key === "Tab" && isOpen) {
          const focusables = Array.from(siteMenu.querySelectorAll("a[href], button:not([disabled])"));
          if (!focusables.length) return;
          const first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });

      // Multi-View Router (Home vs Dedicated Library Sections)
      const viewHome = document.getElementById("view-home");
      const viewLibrary = document.getElementById("view-library");
      const libKicker = document.getElementById("lib-kicker");
      const libTitle = document.getElementById("lib-title");
      const libDesc = document.getElementById("lib-desc");

      const VIEW_META = {
        mg: { kicker: "01 · Category · 30 pieces", title: "Motion graphics", desc: "Thirty pieces in which movement is computed by simulations, solvers or shaders. Pieces 26–30 depend on Three.js or GSAP; check each card.", hash: "#/motion-graphics" },
        fx: { kicker: "02 · Category · 16 effects", title: "Canvas FX", desc: "Sixteen effects rendered to canvas — fields, textures, particles and light with resize handling and device-pixel-ratio scaling.", hash: "#/canvas-fx" },
        motion: { kicker: "03 · Category · 24 patterns", title: "Micro-interactions", desc: "Twenty-four production patterns for interface response. Inspect the trigger, timing and source before adapting to your tokens.", hash: "#/micro-interactions" },
        templates: { kicker: "04 · Category · 8 sections", title: "Section templates", desc: "Eight reusable page sections with markup, layout and responsive behaviour in place.", hash: "#/templates" },
        systems: { kicker: "05 · Category · 6 systems", title: "Colour systems", desc: "Six semantic colour systems mapped to background, surface, text, border and accent roles, with CSS and JSON export.", hash: "#/themes" },
      };
      const HASH_TO_VIEW = {
        "#/motion-graphics": "mg",
        "#/canvas-fx": "fx",
        "#/micro-interactions": "motion",
        "#/templates": "templates",
        "#/themes": "systems",
      };

      function navigate(view, pushHash = true) {
        setMenu(false);
        const isLib = view && view !== "home" && VIEW_META[view];
        const entering = isLib ? viewLibrary : viewHome;
        if (viewHome) viewHome.hidden = Boolean(isLib);
        if (viewLibrary) viewLibrary.hidden = !isLib;
        if (entering && !REDUCED_MOTION) {
          entering.classList.remove("ak-view-enter");
          void entering.offsetWidth;
          entering.classList.add("ak-view-enter");
        }
        if (swarm && swarm.canvas) swarm.canvas.style.display = isLib ? "none" : "";

        document.querySelectorAll("[data-view]").forEach((el) => {
          const on = el.getAttribute("data-view") === (isLib ? view : "home");
          el.classList.toggle("is-active", on);
        });

        if (isLib) {
          const m = VIEW_META[view];
          if (libKicker) libKicker.textContent = m.kicker;
          if (libTitle) libTitle.textContent = m.title;
          if (libDesc) libDesc.textContent = m.desc;
          if (typeof window.__akOpenExplorerTab === "function") window.__akOpenExplorerTab(view);
          if (pushHash && location.hash !== m.hash) {
            try { history.pushState(null, "", m.hash); } catch (_) {}
          }
          window.scrollTo({ top: 0, behavior: "instant" });
        } else {
          if (typeof window.__akDestroyMG === "function") window.__akDestroyMG();
          if (pushHash && location.hash && location.hash !== "#/") {
            try { history.pushState(null, "", "#/"); } catch (_) {}
          }
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      }
      window.__akNavigate = navigate;

      document.querySelectorAll("[data-view]").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          navigate(el.getAttribute("data-view"), true);
        });
      });

      document.querySelectorAll("[data-home-scroll]").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          const sel = el.getAttribute("data-home-scroll");
          navigate("home", true);
          requestAnimationFrame(() => {
            const target = document.querySelector(sel);
            if (target) target.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth" });
          });
        });
      });

      document.querySelectorAll("[data-scroll]").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          const target = document.querySelector(el.dataset.scroll);
          if (target) {
            if (window.__akKinetik?.scrollTo) window.__akKinetik.scrollTo(target);
            else target.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth" });
          }
        });
      });

      window.addEventListener("hashchange", () => {
        const mapped = HASH_TO_VIEW[location.hash];
        navigate(mapped || "home", false);
      });

      const menuCopyBtn = document.getElementById("menu-copy-llms");
      if (menuCopyBtn) menuCopyBtn.addEventListener("click", () => { copyText(LLMS_SPEC, "llms.txt"); setMenu(false); });
      const menuReplayBtn = document.getElementById("menu-replay");
      if (menuReplayBtn) menuReplayBtn.addEventListener("click", () => { setMenu(false); replayGenesis(); });
      const heroCopyBtn = document.getElementById("hero-copy-llms-btn");
      if (heroCopyBtn) heroCopyBtn.addEventListener("click", () => copyText(LLMS_SPEC, "llms.txt"));
      const copyLlmsBtn = document.getElementById("copy-llms-btn");
      if (copyLlmsBtn) copyLlmsBtn.addEventListener("click", () => copyText(LLMS_SPEC, "llms.txt"));
      const footerCopyBtn = document.getElementById("footer-copy-btn");
      if (footerCopyBtn) footerCopyBtn.addEventListener("click", () => copyText(LLMS_SPEC, "llms.txt"));

      // Live FPS pill
      const fpsEl = document.getElementById("fps-readout");
      setInterval(() => {
        fpsEl.textContent = `${ticker.fps} fps`;
      }, 650);

      // Boot swarm cleanly once fonts settle
      Promise.race([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        new Promise((r) => setTimeout(r, 900)),
      ]).then(() => {
        setTimeout(() => {
          window.__akStarted = true;
          if (swarm.wCache) swarm.wCache.clear();
          swarm.start();
        }, 140);
      });

      /* ==============================================================
         11. REGISTRY EXPLORER — tabbed live gallery fed by /registry.json
         ============================================================== */
      (function initExplorer() {
        const root = document.getElementById("ak-explorer");
        if (!root) return;

        const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
          { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
        ));

        /* ---- Tabs: click + roving tabindex (Arrow/Home/End) ---- */
        const tabs = Array.from(root.querySelectorAll("[data-xr-tab]"));
        const panels = {
          templates: document.getElementById("xr-panel-templates"),
          fx: document.getElementById("xr-panel-fx"),
          mg: document.getElementById("xr-panel-mg"),
          motion: document.getElementById("xr-panel-motion"),
          systems: document.getElementById("xr-panel-systems"),
        };
        function activate(name, focusTab) {
          tabs.forEach((t) => {
            const on = t.dataset.xrTab === name;
            t.classList.toggle("is-on", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
            t.tabIndex = on ? 0 : -1;
          });
          Object.keys(panels).forEach((k) => { if (panels[k]) panels[k].hidden = k !== name; });
          if (name !== "mg") {
            destroyMotionGraphic();
          } else if (activate._mgReady && mgItems.length) {
            /* LRU pool active via ak.mountMotionGraphics */
          }
          if (name === "fx" || name === "templates") {
            observeLazyFrames(panels[name]);
          }
          if (focusTab) {
            const target = tabs.find((t) => t.dataset.xrTab === name);
            if (target) target.focus();
          }
        }
        window.__akOpenExplorerTab = (name) => activate(name, false);
        window.__akDestroyMG = () => destroyMotionGraphic();
        tabs.forEach((tab, i) => {
          tab.addEventListener("click", () => { if (typeof window.__akNavigate === "function") window.__akNavigate(tab.dataset.xrTab, true); else activate(tab.dataset.xrTab, false); });
          tab.addEventListener("keydown", (event) => {
            let next = null;
            if (event.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
            else if (event.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
            else if (event.key === "Home") next = tabs[0];
            else if (event.key === "End") next = tabs[tabs.length - 1];
            if (next) {
              event.preventDefault();
              activate(next.dataset.xrTab, true);
            }
          });
        });

        /* ---- Copy helpers ---- */
        const fetchImpl = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
        async function copyFromFile(file, label) {
          if (!fetchImpl) { showToast("Clipboard fetch unavailable — open the file"); return; }
          try {
            const res = await fetchImpl(file);
            if (!res.ok) throw new Error("HTTP " + res.status);
            copyText(await res.text(), label);
          } catch (err) {
            showToast("Could not read file — open it instead");
          }
        }
        function wireFileCopyButtons(scope) {
          scope.querySelectorAll("[data-copy-file]").forEach((btn) => {
            btn.addEventListener("click", () => {
              copyFromFile(btn.getAttribute("data-copy-file"), btn.getAttribute("data-copy-label") || "File");
            });
          });
        }
        const frameCard = (item, badge, prefix) => `
          <article class="xr-card" id="${esc(prefix + "-" + item.id)}" data-rec-id="${esc(prefix + "-" + item.id)}">
            <div class="xr-frame" data-lazy-src="${esc(item.file)}" data-lazy-title="${esc(item.name)} — live preview">
              <a class="xr-veil" href="${esc(item.file)}" target="_blank" rel="noopener" aria-label="Open ${esc(item.name)} as a full page"><span>Open full page ↗</span></a>
            </div>
            <div class="xr-body">
              <div class="xr-line">
                <h3 class="xr-name f-display">${esc(item.name)}</h3>
                ${badge ? `<span class="xr-badge f-mono">${esc(badge)}</span>` : ""}
              </div>
              <p class="xr-best">${esc(item.bestFor || "")}</p>
              <div class="xr-actions">
                <button type="button" class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" data-inspect-id="${esc(prefix + "-" + item.id)}">View source</button>
                <button type="button" class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" data-copy-file="${esc(item.file)}" data-copy-label="${esc(item.name)}">Copy code</button>
                <a class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" href="${esc(item.file)}" target="_blank" rel="noopener">Open preview ↗</a>
              </div>
            </div>
          </article>`;

        /* ---- Theme switcher ---- */
        function kebab(key) { return key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()); }
        function systemCss(sys) {
          const lines = [":root {"];
          Object.keys(sys.tokens || {}).forEach((k) => {
            lines.push(`  --${kebab(k)}: ${sys.tokens[k]};`);
          });
          lines.push("}");
          return lines.join("\n");
        }
        function buildSystems(systems) {
          const host = document.getElementById("xr-swatches");
          const preview = document.getElementById("xr-preview");
          const meta = document.getElementById("xr-sys-meta");
          if (!host || !preview || !meta || !systems.length) return;
          let current = systems[0];
          function paint(sys) {
            current = sys;
            const t = sys.tokens || {};
            preview.style.setProperty("--x-bg", t.bg || "#070709");
            preview.style.setProperty("--x-surface", t.surface || "#0d0d12");
            preview.style.setProperty("--x-elevated", t.elevated || "#12121a");
            preview.style.setProperty("--x-ink", t.ink || "#f4f2ec");
            preview.style.setProperty("--x-muted", t.mutedInk || "#8e8d8a");
            preview.style.setProperty("--x-hairline", t.hairlineStrong || t.hairline || "rgba(244,242,236,0.24)");
            preview.style.setProperty("--x-accent", t.accent || "#ff3d00");
            preview.style.setProperty("--x-on-accent", t.onAccent || "#160800");
            host.querySelectorAll(".xr-swatch").forEach((btn) => {
              const on = btn.getAttribute("data-sys") === sys.id;
              btn.classList.toggle("is-on", on);
              btn.setAttribute("aria-pressed", on ? "true" : "false");
            });
            const a = sys.audit || {};
            const fmt = (pair) => (pair && typeof pair.ratio === "number") ? `${pair.ratio.toFixed(2)}:1 ${pair.grade}` : "—";
            meta.innerHTML = `
              <p class="xr-sys-name f-display">${esc(sys.name)} <span class="xr-badge xr-cat f-mono">${esc(sys.mode || "")}</span></p>
              <p class="xr-sys-role">${esc(sys.role || "")}</p>
              <p class="xr-sys-audit f-mono">ink/bg ${fmt(a.inkOnBg)} · muted/bg ${fmt(a.mutedOnBg)} · accent/bg ${fmt(a.accentOnBg)}</p>`;
          }
          host.innerHTML = systems.map((sys) => `
            <button type="button" class="xr-swatch" data-sys="${esc(sys.id)}" aria-pressed="false">
              <span class="xr-triple" aria-hidden="true"><span style="background:${esc(sys.tokens && sys.tokens.bg)}"></span><span style="background:${esc(sys.tokens && sys.tokens.ink)}"></span><span style="background:${esc(sys.tokens && sys.tokens.accent)}"></span></span>
              <span class="xr-swatch-name f-mono">${esc(sys.name)}<span class="xr-swatch-mode">${esc(sys.mode || "")}${sys.audit && sys.audit.inkOnBg ? " · ink/bg " + sys.audit.inkOnBg.grade : ""}</span></span>
            </button>`).join("");
          host.addEventListener("click", (event) => {
            const btn = event.target.closest("[data-sys]");
            if (!btn) return;
            const sys = systems.find((item) => item.id === btn.getAttribute("data-sys"));
            if (sys) paint(sys);
          });
          const cssBtn = document.getElementById("xr-copy-css");
          const jsonBtn = document.getElementById("xr-copy-json");
          if (cssBtn) cssBtn.addEventListener("click", () => copyText(systemCss(current), current.name + " — CSS variables"));
          if (jsonBtn) jsonBtn.addEventListener("click", () => copyText(JSON.stringify(current, null, 2), current.name + " — JSON"));
          paint(current);
        }

        /* ---- Motion Graphics: ALL items open in scrollable feed with IntersectionObserver auto-mount ---- */
        let mgItems = [];
        let mgTheme = "obsidian";
        let mgObserver = null;
        let lazyFrameObserver = null;
        const mgFeed = document.getElementById("xr-mg-feed");

        function mountStageFrame(stageEl, item) {
          if (!stageEl || stageEl.querySelector("iframe.xr-mg-frame")) return;
          const ph = stageEl.querySelector(".xr-mg-placeholder");
          const frame = document.createElement("iframe");
          frame.className = "xr-mg-frame";
          frame.title = item.name + " — live preview";
          frame.src = item.file + "?theme=" + encodeURIComponent(mgTheme);
          frame.addEventListener("load", () => { if (ph) ph.hidden = true; }, { once: true });
          stageEl.appendChild(frame);
        }

        function unmountStageFrame(stageEl) {
          if (!stageEl) return;
          const frame = stageEl.querySelector("iframe.xr-mg-frame");
          if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
          const ph = stageEl.querySelector(".xr-mg-placeholder");
          if (ph) ph.hidden = false;
        }

        function destroyMotionGraphic() {
          if (mgObserver) { mgObserver.disconnect(); mgObserver = null; }
          if (mgFeed) {
            mgFeed.querySelectorAll(".xr-mg-stage").forEach(unmountStageFrame);
          }
        }

        function observeMotionFeed() {
          if (!mgFeed) return;
          if (mgObserver) mgObserver.disconnect();
          const stages = Array.from(mgFeed.querySelectorAll(".xr-mg-stage"));
          if (typeof IntersectionObserver === "undefined") {
            stages.forEach((st) => {
              const idx = Number(st.getAttribute("data-mg-index"));
              if (mgItems[idx]) mountStageFrame(st, mgItems[idx]);
            });
            return;
          }
          mgObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              const st = entry.target;
              const idx = Number(st.getAttribute("data-mg-index"));
              const item = mgItems[idx];
              if (!item) return;
              if (entry.isIntersecting) {
                mountStageFrame(st, item);
              } else {
                unmountStageFrame(st);
              }
            });
          }, { rootMargin: "420px 0px 420px 0px", threshold: 0.01 });
          stages.forEach((st) => mgObserver.observe(st));
        }

        function observeLazyFrames(panelEl) {
          if (!panelEl || typeof IntersectionObserver === "undefined") return;
          if (!lazyFrameObserver) {
            lazyFrameObserver = new IntersectionObserver((entries) => {
              entries.forEach((entry) => {
                const holder = entry.target;
                const src = holder.getAttribute("data-lazy-src");
                const title = holder.getAttribute("data-lazy-title") || "Live preview";
                if (!src) return;
                const existing = holder.querySelector("iframe");
                if (entry.isIntersecting && !existing) {
                  const ifr = document.createElement("iframe");
                  ifr.tabIndex = -1;
                  ifr.title = title;
                  ifr.src = src;
                  holder.insertBefore(ifr, holder.firstChild);
                } else if (!entry.isIntersecting && existing) {
                  existing.parentNode.removeChild(existing);
                }
              });
            }, { rootMargin: "350px 0px 350px 0px", threshold: 0.01 });
          }
          panelEl.querySelectorAll(".xr-frame[data-lazy-src]").forEach((el) => lazyFrameObserver.observe(el));
        }

        function buildMotionGraphics(items) {
          mgItems = Array.isArray(items) ? items : [];
          if (!mgFeed || !mgItems.length) return;
          mgFeed.innerHTML = mgItems.map((item, i) => {
            const num = String(i + 1).padStart(2, "0");
            const isTall = item.id === "spring-to-css-linear-forge" || item.id === "inertial-drum-picker";
            return `
            <article class="xr-mg-card${isTall ? " is-tall" : ""}" id="mg-card-${num}" data-rec-id="mg-${esc(item.id)}">
              <div class="xr-mg-stage" data-mg-index="${i}">
                <div class="xr-mg-placeholder f-mono">${num} · ${esc(item.name)}</div>
              </div>
              <div class="xr-mg-card-bar">
                <div class="xr-line">
                  <div class="xr-mg-card-head">
                    <span class="xr-mg-idx f-mono">${num} / ${String(mgItems.length).padStart(2, "0")}</span>
                    <h2 class="xr-mg-name f-display">${esc(item.name)}</h2>
                  </div>
                  <span class="xr-badge f-mono">${esc((item.engine || "canvas-2d") + (item.dependencies && item.dependencies !== "none" ? " · " + item.dependencies : ""))}</span>
                </div>
                <p class="xr-best">${esc(item.bestFor || item.math || "Standalone · copy-paste ready.")}</p>
                <div class="xr-mg-card-actions">
                  <button type="button" class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" data-inspect-id="mg-${esc(item.id)}">View source</button>
                  <button type="button" class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" data-mg-copy="full" data-mg-index="${i}">Copy HTML</button>
                  <button type="button" class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" data-mg-copy="engine" data-mg-index="${i}">Copy CSS + JS</button>
                  <a class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" href="${esc(item.file)}" target="_blank" rel="noopener">Open preview ↗</a>
                </div>
              </div>
            </article>`;
          }).join("");

          mgFeed.addEventListener("click", (event) => {
            const btn = event.target.closest("[data-mg-copy]");
            if (!btn) return;
            const item = mgItems[Number(btn.getAttribute("data-mg-index"))];
            if (!item || !fetchImpl) return;
            const mode = btn.getAttribute("data-mg-copy");
            fetchImpl(item.file).then((res) => {
              if (!res.ok) throw new Error("HTTP " + res.status);
              return res.text();
            }).then((text) => {
              if (mode === "full") {
                copyText(text, item.name + " — full standalone HTML");
              } else {
                const styles = Array.from(text.matchAll(/<style>([\s\S]*?)<\/style>/g)).map((m) => m[1].trim());
                const scripts = Array.from(text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)).map((m) => m[1].trim()).filter(Boolean);
                const engine =
                  "/* ============ " + item.name + " — CSS engine ============ */\n" + styles.join("\n\n") +
                  "\n\n/* ============ " + item.name + " — JS engine ============ */\n" + scripts.join("\n\n");
                copyText(engine, item.name + " — CSS + JS engine");
              }
            }).catch(() => showToast("Could not read " + item.name));
          });

          root.querySelectorAll(".xr-mg-theme").forEach((btn) => {
            btn.addEventListener("click", () => {
              const t = btn.getAttribute("data-mg-theme");
              if (!t) return;
              mgTheme = t;
              window.__akKinetik?.setMotionTheme?.(mgTheme);
              root.querySelectorAll(".xr-mg-theme").forEach((b) => {
                const on = b.getAttribute("data-mg-theme") === t;
                b.classList.toggle("is-on", on);
                b.setAttribute("aria-pressed", on ? "true" : "false");
              });
              mgFeed.querySelectorAll("iframe.ak-mg-frame").forEach((frame) => {
                if (frame.contentWindow) {
                  try { frame.contentWindow.postMessage({ type: "ak-theme", theme: t }, "*"); } catch (_) {}
                }
              });
            });
          });
          const specs = [];
          mgFeed.querySelectorAll(".xr-mg-card").forEach((card, i) => {
            const item = mgItems[i];
            if (!item) return;
            resourceCards.set(`mg-${item.id}`, card);
            const slot = card.querySelector(".xr-mg-stage");
            if (slot) {
              slot.innerHTML = "";
              specs.push({
                slot,
                src: `./${String(item.file || "").replace(/^\/+/, "")}?theme=${encodeURIComponent(mgTheme)}`,
                title: item.name,
                trustedLocal: true
              });
            }
          });
          ak.mountMotionGraphics(specs);
          activate._mgReady = true;
        }

        
        /* ---- Fetch the manifest once, render everything ---- */
        if (!fetchImpl) {
          const err = document.getElementById("xr-error");
          if (err) err.hidden = false;
          return;
        }
        fetchImpl("registry.json")
          .then((res) => { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
          .then((reg) => {
            const tHost = document.getElementById("xr-templates");
            if (tHost) { tHost.innerHTML = (reg.templates || []).map((t) => frameCard(t, "template", "tpl")).join(""); tHost.querySelectorAll("[data-rec-id]").forEach((c) => resourceCards.set(c.getAttribute("data-rec-id"), c)); }
            const fHost = document.getElementById("xr-fx");
            if (fHost) { fHost.innerHTML = (reg.fx || []).map((f) => frameCard(f, f.fps ? f.fps + "fps" : "fx", "fx")).join(""); fHost.querySelectorAll("[data-rec-id]").forEach((c) => resourceCards.set(c.getAttribute("data-rec-id"), c)); }
            const miPreview = (id) => {
              switch (id) {
                case "magnetic-button": return `<div class="mi-mag-wrap"><span class="mi-mag-btn">Engage</span><span class="mi-mag-dot"></span></div>`;
                case "spotlight-card": return `<div class="mi-spot"><span class="mi-spot-glow"></span><span>SURFACE · 01</span></div>`;
                case "masked-rise-headline": return `<div class="mi-rise-box"><span class="mi-rise-line"><span>ATELIER</span></span><span class="mi-rise-line em"><span>in motion.</span></span></div>`;
                case "stateful-button": return `<div class="mi-state-btn"><span class="mi-st-1">Copy tokens</span><span class="mi-st-2"><i class="mi-spin"></i>Syncing</span><span class="mi-st-3">✓ Copied</span></div>`;
                case "smooth-drawer": return `<div class="mi-drawer-frame"><div class="mi-drawer-panel"><i></i><i></i><i></i></div></div>`;
                case "marquee-zero-cls": return `<div class="mi-mq"><div class="mi-mq-track"><span>KINETIK <em>·</em> ZERO CLS <em>·</em> 60FPS <em>·</em></span><span>KINETIK <em>·</em> ZERO CLS <em>·</em> 60FPS <em>·</em></span></div></div>`;
                case "reveal-on-scroll": return `<div class="mi-rev"><span></span><span></span><span></span></div>`;
                case "tilt-card-3d": return `<div class="mi-tilt-wrap"><div class="mi-tilt">PERSPECTIVE 3D</div></div>`;
                case "conic-border-spin": return `<div class="mi-conic"><span>CONIC RING</span></div>`;
                case "grain-overlay": return `<div class="mi-grain-box">35mm grain</div>`;
                case "glass-hairline-panel": return `<div class="mi-glass-wrap"><span class="mi-glass-orb"></span><div class="mi-glass-pane">BLUR 12PX</div></div>`;
                case "accordion-spring": return `<div class="mi-acc"><div class="mi-acc-h"><span>Grid-rows spring</span><b>+</b></div><div class="mi-acc-b">Smooth 0fr → 1fr height without JS measurement.</div></div>`;
                case "link-underline-sweep": return `<span class="mi-link">Read specification ↗</span>`;
                case "dropdown-spring": return `<div class="mi-dd"><div class="mi-dd-btn"><span>Theme</span><span>▾</span></div><div class="mi-dd-menu"><i></i><i></i><i></i></div></div>`;
                case "tooltip-nudge": return `<div class="mi-tip-wrap"><span class="mi-tip-pill">⌘K · COPY</span><span class="mi-tip-btn">Hover target</span></div>`;
                case "toast-action": return `<div class="mi-toast-demo"><span>Tokens copied</span><b>UNDO</b></div>`;
                case "count-up": return `<span class="mi-cnt" data-mi-count="183">000</span>`;
                case "typewriter-caret": return `<div class="mi-type"><span class="mi-type-txt">fetch('/llms.txt')</span><span class="mi-caret"></span></div>`;
                case "gradient-text-pan": return `<span class="mi-grad">KINETIK</span>`;
                case "shimmer-load": return `<div class="mi-skel"><span></span><span></span><span></span></div>`;
                case "shake-x": return `<div class="mi-shake">invalid_token</div>`;
                case "float-soft": return `<div class="mi-float-wrap"><div class="mi-float-obj"></div><div class="mi-float-sh"></div></div>`;
                case "ink-ripple": return `<span class="mi-rip-btn">Press</span>`;
                case "tab-glide": return `<div class="mi-tabs"><i class="mi-tabs-pill"></i><span>Type</span><span>Color</span><span>Motion</span></div>`;
                default: return `<div class="mi-conic"><span>${esc(id)}</span></div>`;
              }
            };
            window.__akSnippets = reg.snippets || {};
            const sHost = document.getElementById("xr-motion");
            if (sHost) {
              sHost.innerHTML = Object.values(reg.snippets || {}).map((s) => `
                <article class="mi-card is-inview" id="mi-${esc(s.id)}" data-rec-id="mi-${esc(s.id)}">
                  <div class="mi-stage" aria-hidden="true">${miPreview(s.id)}</div>
                  <div class="mi-body">
                    <div class="xr-line">
                      <h3 class="xr-name f-display">${esc(s.name)}</h3>
                      <span class="xr-badge xr-cat f-mono">${esc(s.category || "interaction")}</span>
                    </div>
                    <p class="xr-best">${esc(s.description || "")}</p>
                    <div class="xr-actions">
                      <button type="button" class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" data-inspect-id="mi-${esc(s.id)}">View source</button>
                      <button type="button" class="chip f-mono rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.14em]" data-snippet-id="${esc(s.id)}">Copy code</button>
                      <span class="xr-lang f-mono">${esc(s.language || "html")}</span>
                    </div>
                  </div>
                </article>`).join("");
              sHost.querySelectorAll("[data-snippet-id]").forEach((btn) => {
                btn.addEventListener("click", () => {
                  const snippet = (reg.snippets || {})[btn.getAttribute("data-snippet-id")];
                  if (snippet && snippet.code) copyText(snippet.code, snippet.name);
                });
              });
              // IntersectionObserver: run live animations only while card is on screen
              if ("IntersectionObserver" in window) {
                const miIO = new IntersectionObserver((entries) => {
                  entries.forEach((e) => e.target.classList.toggle("is-inview", e.isIntersecting));
                }, { threshold: 0.05 });
                sHost.querySelectorAll(".mi-card").forEach((c) => miIO.observe(c));
              }
              // Continuous count-up loop for the Count-Up card while in view
              const cntEl = sHost.querySelector("[data-mi-count]");
              if (cntEl && !REDUCED_MOTION) {
                const cntCard = cntEl.closest(".mi-card");
                let cStart = performance.now();
                const runCnt = (now) => {
                  if (cntCard && cntCard.classList.contains("is-inview") && !document.hidden) {
                    const cycle = (now - cStart) % 3000;
                    const p = Math.min(1, cycle / 1400);
                    const val = Math.round(183 * (1 - Math.pow(2, -10 * p)));
                    cntEl.textContent = String(val).padStart(3, "0");
                  }
                  requestAnimationFrame(runCnt);
                };
                requestAnimationFrame(runCnt);
              } else if (cntEl) {
                cntEl.textContent = "183";
              }
            }
            // Respect initial URL hash on load
            if (location.hash && HASH_TO_VIEW[location.hash]) {
              navigate(HASH_TO_VIEW[location.hash], false);
            }
            buildSystems((reg.color && reg.color.systems) || []);
            buildMotionGraphics(reg.motionGraphics || []);
            sHost?.querySelectorAll("[data-rec-id]").forEach((c) => resourceCards.set(c.getAttribute("data-rec-id"), c));
            root.addEventListener("click", (e) => {
              const b = e.target.closest("[data-inspect-id]");
              if (b) void ak.inspector.openSource(b.getAttribute("data-inspect-id"), b);
            });
            wireFileCopyButtons(root);
          })
          .catch(() => {
            const err = document.getElementById("xr-error");
            if (err) err.hidden = false;
          });
      })();

    })();
