# Atelier Kinetik · v2.9.1

Atelier Kinetik is a curated frontend reference for developers and AI coding agents: **183 design and motion resources in nine categories**, each documented with a live preview, readable source and an entry in `registry.json`.

It is a static reference site. It does not generate websites or write code on request. **Agentic Build** on the homepage is a choreographed visual animation.

## Inventory (183 resources · 9 categories)

| Category | Count | Notes |
| --- | ---: | --- |
| Google Fonts typefaces | 60 | Selected for display, text and interface roles |
| Studio font pairings | 24 | Curated combinations with assigned roles |
| Fluid typography scales | 3 | Viewport-scaled `clamp()` systems |
| Semantic colour systems | 6 | Stepped scales mapped to semantic interface tokens |
| Named motion laws | 12 | Easing curves and spring definitions |
| Production micro-interactions | 24 | Interactive UI patterns with live previews and source |
| Section templates | 8 | Reusable responsive page structures |
| Canvas FX | 16 | Effects drawn to canvas with resize handling |
| Computational motion graphics | 30 | Simulations, solvers, WebGL shaders, Three.js and GSAP pieces |

## External dependencies

The main showcase (`index.html`, `assets/studio-deps.js`, `assets/hero-3d.js`) uses CDN-hosted libraries with graceful offline and `prefers-reduced-motion` fallbacks:
- **GSAP 3.12.5 + ScrollTrigger** — choreography, Live Forge staging and scrubbed scroll motion
- **Lenis 1.1.18** — inertial smooth scrolling synced to ScrollTrigger
- **Three.js 0.170.0** — real-time 3D WebGL hero sculpture (falls back to 2D canvas if WebGL/CDN is unavailable)
- **Tone.js 14.8.49** — opt-in procedural mechanical audio (muted by default)
- **Matter.js 0.20.0** — interactive 2D rigid-body physics stage in Motion Laws
- **Prism.js 1.29.0** — Obsidian-themed syntax-highlighted source drawers across the Library Explorer
- **Lucide 0.460.0** & **Google Fonts** — UI icons and typography

Individual resources in `registry/` list their own dependencies in `registry.json` (pieces 26–30 use Three.js and/or GSAP; pieces 01–25 and Canvas FX use vanilla Canvas 2D / WebGL).

## Using these resources with an AI coding agent

1. Read `llms.txt` for orientation, then fetch `registry.json`.
2. Inspect the target project's tokens and conventions before adapting a resource.
3. Check dependencies in both `registry.json` and the resource source file before adding a library.
4. Take the smallest part needed — leave preview scaffolding behind.
5. Keep responsive behaviour, keyboard focus states and `prefers-reduced-motion` handling intact.

## Hosting (Netlify & static hosts)

This repository includes `netlify.toml` and `.nojekyll` at the root and uses relative asset paths so it deploys cleanly on **Netlify** (zero build step, publish directory `.`) as well as other static hosts.

This site is powered by [Netlify](https://www.netlify.com).

## Code of Conduct

Participation in this project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant v2.1).

## License

Code is released under the [MIT License](LICENSE) (OSI-approved). Typefaces (via Google Fonts) and third-party libraries (GSAP, Lenis, Three.js, Tone.js, Matter.js, Prism.js, Lucide) remain under their own licenses.
