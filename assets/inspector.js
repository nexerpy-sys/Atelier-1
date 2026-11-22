import { load } from './loader.js';

const norm = v => String(v ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
const values = v => (Array.isArray(v) ? v.flatMap(values) : v == null ? [] : typeof v === 'object' ? values(v.name ?? v.label ?? v.id) : [String(v)]);

function tokens(text) {
  return [...norm(text).matchAll(/(?:(cat|tech|dep):)?(?:"([^"]+)"|([^\s"]+))/g)]
    .map(m => ({ field: m[1], value: m[2] ?? m[3] }));
}

function subsequence(q, s) {
  let i = 0;
  for (const c of s) { if (c === q[i] && ++i === q.length) return true; }
  return false;
}

export function indexRecords(records) {
  return records.map((r, i) => {
    if (!r.name || !r.id) throw new TypeError(`Registry row ${i + 1} needs a stable id and name.`);
    const dep = values(r.dependencies), name = norm(r.name);
    const fields = {
      cat: values(r.category).map(norm),
      tech: values(r.technique).map(norm),
      dep: dep.length ? dep.map(norm) : ['none']
    };
    return { r, i, name, fields, terms: [name, ...Object.values(fields).flat()] };
  });
}

export function rankRecords(index, query) {
  const parsed = tokens(query), filters = parsed.filter(t => t.field), free = parsed.filter(t => !t.field).map(t => t.value), whole = free.join(' ');
  return index.flatMap(row => {
    if (!filters.every(({ field, value }) => row.fields[field].some(t => t === value || t.split(/[\s/,;]+/).includes(value) || t.startsWith(value + '@')))) return [];
    const match = free.map(q => Math.max(...row.terms.map(t => (t === q ? 4 : t.startsWith(q) ? 3 : t.includes(q) ? 2 : subsequence(q, t) ? 1 : 0))));
    if (match.some(n => !n)) return [];
    return [{
      ...row,
      rank: whole && row.name === whole ? 3 : whole && row.name.startsWith(whole) ? 2 : 1,
      score: match.reduce((a, b) => a + b, 0)
    }];
  }).sort((a, b) => b.rank - a.rank || b.score - a.score || a.i - b.i).map(({ r }) => r);
}

// Extract <style>, inline <script>, and GLSL shader blocks on demand from standalone HTML files without mutating Full HTML.
export function extractEmbeddedSources(html) {
  if (typeof html !== 'string' || !html) return { css: null, js: null, glsl: null };
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(m => m[1].trim()).filter(Boolean);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc\s*=/i.test(m[1]) && !/x-shader|application\/json/i.test(m[1]))
    .map(m => m[2].trim()).filter(Boolean);
  const glslBlocks = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']x-shader\/[^"']+["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const s = m[1].trim();
    if (s) glslBlocks.push(s);
  }
  const joinedJs = scripts.join('\n\n');
  for (const m of joinedJs.matchAll(/`([^`]*\b(?:gl_Position|gl_FragColor|void\s+main\s*\(\s*\))[^`]*)`/g)) {
    const s = m[1].trim();
    if (s && s.includes('void main')) glslBlocks.push(s);
  }
  return {
    css: styles.length ? styles.join('\n\n/* --- */\n\n') : null,
    js: scripts.length ? scripts.join('\n\n// ---\n\n') : null,
    glsl: glslBlocks.length ? glslBlocks.join('\n\n// ---\n\n') : null
  };
}

const TABS = [
  ['html', 'Full HTML', 'markup'],
  ['css', 'CSS', 'css'],
  ['js', 'JS', 'javascript'],
  ['glsl', 'GLSL', 'glsl'],
  ['meta', 'Metadata & Dependencies', null]
];

const checks = [
  'Confirm licences and attribution before reusing the source.',
  'Keep local asset paths relative to the GitHub Pages project.',
  'Load only the dependencies the source actually uses; pin versions.',
  'Reserve layout dimensions and check narrow-screen behaviour.',
  'Test keyboard operation, reduced motion and sound opt-in.',
  'Test pause, teardown and failure with the network blocked.'
];

const RECENT_KEY = 'ak-recent-resources-v28';
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6); } catch { return []; }
}
function saveRecent(id) {
  try {
    const list = [id, ...loadRecent().filter(x => x !== id)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

const fetchText = async (url, signal) => {
  const r = await fetch(url, { signal, credentials: 'same-origin' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

function localURL(path) {
  if (typeof path !== 'string' || !path || /^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(path)) {
    throw new Error('Expected a relative project path.');
  }
  const root = new URL('.', document.baseURI), u = new URL(path, root);
  if (u.protocol !== 'file:' && (u.origin !== root.origin || !u.pathname.startsWith(root.pathname))) {
    throw new Error('Source is outside the project.');
  }
  return u;
}

function writableTarget(el) {
  return el instanceof Element && (el.matches('input,textarea,select,[role="textbox"]') || el.isContentEditable);
}

export function mountInspector({ registry = './registry.json', normalise, jump, openButton, audio = null } = {}) {
  if (typeof normalise !== 'function' || typeof jump !== 'function') {
    throw new TypeError('Pass normalise(json) and jump(record).');
  }
  const life = new AbortController(), signal = life.signal;
  const palette = document.createElement('dialog'), inspector = document.createElement('dialog');
  palette.className = inspector.className = 'ak-dialog';
  palette.setAttribute('aria-labelledby', 'ak-palette-title');
  inspector.setAttribute('aria-labelledby', 'ak-source-title');

  palette.innerHTML = `<div class="ak-dlg-head"><h2 id="ak-palette-title">Find a resource</h2><form method="dialog"><button class="ak-btn">Esc · Close</button></form></div>
  <label class="ak-dlg-label" for="ak-query">Filter 183 resources · try <code>cat:</code>, <code>tech:</code>, <code>dep:none</code>, or <code>verlet</code></label>
  <input id="ak-query" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ak-results" autocomplete="off" placeholder="Search by name, category, technique, or dependency…">
  <p class="ak-dlg-status" role="status" data-status></p><ul id="ak-results" role="listbox" aria-label="Resources" hidden></ul>`;

  inspector.innerHTML = `<div class="ak-dlg-head"><h2 id="ak-source-title">Source inspector</h2><form method="dialog"><button class="ak-btn">Esc · Close</button></form></div>
  <div class="ak-dlg-toolbar">
    <div role="tablist" aria-label="Source format"></div>
    <div class="ak-dlg-actions">
      <label class="ak-wrap-lbl"><input type="checkbox" data-wrap> Wrap</label>
      <button type="button" class="ak-btn" data-copy>Copy raw</button>
      <button type="button" class="ak-btn" data-save>Download</button>
    </div>
  </div>
  <p class="ak-dlg-status" data-status role="status"></p>`;

  document.body.append(palette, inspector);

  const input = palette.querySelector('input'), list = palette.querySelector('ul'), resultStatus = palette.querySelector('[data-status]');
  const tabs = inspector.querySelector('[role=tablist]'), sourceStatus = inspector.querySelector('[data-status]'),
    copy = inspector.querySelector('[data-copy]'), save = inspector.querySelector('[data-save]'), wrap = inspector.querySelector('[data-wrap]');
  const panels = [], buttons = [];
  let dataPromise, ranked = [], index = -1, paletteFrom, sourceFrom, skipRestore = false;
  let record, current = 0, raw = null, htmlCache = null, extractedCache = null, sequence = 0, tabAbort, fallbackCopy;

  const records = () => (dataPromise ??= fetchText(localURL(registry), signal).then(JSON.parse).then(normalise).then(indexRecords).catch(e => { dataPromise = null; throw e; }));

  function choose(i, scroll = true) {
    index = i;
    for (let j = 0; j < list.children.length; j++) list.children[j].setAttribute('aria-selected', String(j === i));
    const item = list.children[i];
    if (item) {
      input.setAttribute('aria-activedescendant', item.id);
      if (scroll) item.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function results(rows, recentIds = []) {
    ranked = rows;
    const recentSet = new Set(recentIds);
    list.replaceChildren(...rows.map((r, i) => {
      const li = document.createElement('li');
      li.id = `ak-option-${i}`;
      li.setAttribute('role', 'option');
      li.dataset.i = i;
      const badge = recentSet.has(r.id) ? ' · Recent' : '';
      li.textContent = `${r.name}${r.category ? ' · ' + r.category : ''}${badge}`;
      return li;
    }));
    list.hidden = !rows.length;
    input.setAttribute('aria-expanded', String(!!rows.length));
    choose(-1);
    list.scrollTop = 0;
  }

  let searchRevision = 0;
  async function search() {
    const rev = ++searchRevision, q = input.value;
    try {
      const all = await records();
      if (!palette.open || rev !== searchRevision) return;
      let rows = rankRecords(all, q);
      const recentIds = !q.trim() ? loadRecent() : [];
      if (recentIds.length) {
        const byId = new Map(rows.map(r => [r.id, r]));
        const head = recentIds.map(id => byId.get(id)).filter(Boolean);
        const headSet = new Set(head.map(r => r.id));
        rows = [...head, ...rows.filter(r => !headSet.has(r.id))];
      }
      results(rows, recentIds);
      resultStatus.textContent = `${rows.length} ${rows.length === 1 ? 'resource' : 'resources'}${recentIds.length ? ' · recent first' : ''}`;
    } catch {
      if (rev === searchRevision && palette.open) { results([]); resultStatus.textContent = 'Resource list unavailable.'; }
    }
  }

  function openPalette(opener = document.activeElement) {
    if (palette.open || document.querySelector('dialog[open]')) return;
    paletteFrom = opener; skipRestore = false; input.value = ''; results([]);
    resultStatus.textContent = 'Loading resources…';
    palette.showModal(); input.focus(); search();
  }

  async function activate(i) {
    const row = ranked[i]; if (!row) return;
    saveRecent(row.id);
    const opener = paletteFrom; skipRestore = true; palette.close();
    try {
      const target = await jump(row);
      if (!(target instanceof HTMLElement) || !target.isConnected) throw new Error('Resource card not found.');
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (!target.hasAttribute('tabindex') && target.tabIndex < 0) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    } catch {
      openPalette(opener);
      resultStatus.textContent = 'Could not open that resource. Check the card mapping.';
    }
  }

  const restore = el => { if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true }); };
  palette.addEventListener('close', () => { if (!skipRestore) restore(paletteFrom); }, { signal });
  openButton?.addEventListener('click', e => openPalette(e.currentTarget), { signal });
  input.addEventListener('input', () => { results([]); search(); }, { signal });
  input.addEventListener('keydown', e => {
    if (e.isComposing || !ranked.length) return;
    const n = ranked.length;
    switch (e.key) {
      case 'ArrowDown': choose((index + 1) % n); break;
      case 'ArrowUp': choose(index <= 0 ? n - 1 : index - 1); break;
      case 'Home': choose(0); break;
      case 'End': choose(n - 1); break;
      case 'Enter': activate(index < 0 ? 0 : index); break;
      default: return;
    }
    e.preventDefault();
  }, { signal });
  list.addEventListener('pointerdown', e => { if (e.target.closest('[role=option]') && e.pointerType === 'mouse') e.preventDefault(); }, { signal });
  list.addEventListener('click', e => { const option = e.target.closest('[data-i]'); if (option) activate(+option.dataset.i); }, { signal });
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || e.repeat || writableTarget(e.target)) return;
    if ((e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) || ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k')) {
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault(); openPalette();
    }
  }, { signal });

  for (const [key, text] of TABS) {
    const b = document.createElement('button'), p = document.createElement('div');
    b.type = 'button'; b.textContent = text;
    b.id = `ak-tab-${key}`; p.id = `ak-panel-${key}`;
    b.setAttribute('role', 'tab'); p.setAttribute('role', 'tabpanel');
    b.setAttribute('aria-controls', p.id); p.setAttribute('aria-labelledby', b.id);
    p.tabIndex = 0; tabs.append(b); inspector.append(p);
    buttons.push(b); panels.push(p);
  }

  function metadata(panel) {
    const heading = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
    panel.append(heading('p', `${record.category ?? 'Uncategorised'} · ${values(record.technique).join(', ') || 'Technique not listed'}`));
    if (record.description) panel.append(heading('p', record.description));
    panel.append(heading('h3', 'Dependencies'));
    const ul = document.createElement('ul'); ul.className = 'ak-pills';
    const dep = values(record.dependencies);
    for (const d of dep.length ? dep : ['None']) ul.append(heading('li', d));
    panel.append(ul, heading('h3', 'Adaptation Checklist'));
    const ol = document.createElement('ol');
    for (const c of checks) ol.append(heading('li', c));
    panel.append(ol);
  }

  function renderCode(panel, text, prism, lang) {
    const pre = document.createElement('pre'), code = document.createElement('code');
    pre.className = 'ak-source-code'; pre.tabIndex = 0;
    if (prism?.languages?.[lang]) code.innerHTML = prism.highlight(text, prism.languages[lang], lang);
    else code.textContent = text;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT), offs = [];
    let node, start = 0;
    while ((node = walker.nextNode())) { offs.push({ node, start, end: start + node.length }); start += node.length; }
    const lines = [];
    let offset = 0, j = 0;
    for (const [i, line] of text.split(/\r\n|\n|\r/).entries()) {
      const skip = text.slice(offset + line.length, offset + line.length + 2) === '\r\n' ? 2 : 1;
      const row = document.createElement('span'), gutter = document.createElement('span'), body = document.createElement('span');
      row.className = 'ak-source-line'; gutter.className = 'ak-line-no'; gutter.setAttribute('aria-hidden', 'true');
      gutter.textContent = i + 1; row.append(gutter, body);
      let cursor = offset;
      while (j < offs.length && offs[j].end <= cursor) j++;
      let k = j;
      while (cursor < offset + line.length && k < offs.length) {
        const { node: tn, start: st, end: en } = offs[k], stop = Math.min(en, offset + line.length);
        let span = document.createTextNode(tn.data.slice(cursor - st, stop - st));
        for (let p = tn.parentElement; p && p !== code; p = p.parentElement) {
          const clone = p.cloneNode(false); clone.append(span); span = clone;
        }
        body.append(span); cursor = stop;
        if (cursor >= en) k++;
      }
      if (!body.childNodes.length) body.textContent = '\u200b';
      lines.push(row); offset += line.length + skip;
    }
    code.replaceChildren(...lines); pre.append(code); panel.replaceChildren(pre);
  }

  async function ensureHtmlText(tabSignal) {
    if (htmlCache !== null) return htmlCache;
    const htmlSpec = record?.sources?.html;
    if (!htmlSpec) return null;
    htmlCache = typeof htmlSpec === 'string'
      ? await fetchText(localURL(htmlSpec), tabSignal)
      : String(htmlSpec.text ?? '');
    extractedCache = extractEmbeddedSources(htmlCache);
    return htmlCache;
  }

  async function selectTab(i, focus = false) {
    const rev = ++sequence; current = i; tabAbort?.abort(); tabAbort = new AbortController();
    raw = null; fallbackCopy?.remove(); fallbackCopy = null;
    buttons.forEach((b, j) => { b.setAttribute('aria-selected', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
    panels.forEach((p, j) => { p.hidden = j !== i; if (j === i) p.replaceChildren(); });
    if (focus) buttons[i].focus();
    const [key, label, lang] = TABS[i], panel = panels[i];
    copy.disabled = save.disabled = true;
    sourceStatus.textContent = '';
    if (!record) return;
    if (key === 'meta') { metadata(panel); return; }

    let spec = record.sources?.[key];
    sourceStatus.textContent = `Loading ${label}…`;
    try {
      let text = null;
      let extracted = false;
      if (spec) {
        text = typeof spec === 'string' ? await fetchText(localURL(spec), tabAbort.signal) : String(spec.text ?? '');
        if (key === 'html') {
          htmlCache = text;
          extractedCache = extractEmbeddedSources(text);
        }
      } else if (record.sources?.html && (key === 'css' || key === 'js' || key === 'glsl')) {
        await ensureHtmlText(tabAbort.signal);
        text = extractedCache?.[key] ?? null;
        extracted = !!text;
      }

      if (!inspector.open || rev !== sequence) return;
      if (!text) {
        const msg = document.createElement('p');
        msg.textContent = `No ${label} source listed for this resource.`;
        panel.append(msg);
        sourceStatus.textContent = '';
        return;
      }

      raw = { text, name: `${record.id}-${key}.${key === 'html' ? 'html' : key}` };
      copy.disabled = save.disabled = false;
      const prism = await load(lang === 'glsl' ? 'glsl' : 'prism').catch(() => null);
      if (!inspector.open || rev !== sequence) return;
      renderCode(panel, text, prism, lang);
      const note = extracted ? ' · extracted from HTML' : '';
      sourceStatus.textContent = prism ? `Highlighted with Prism${note}.` : `Plaintext shown (highlighter unavailable${note}).`;
    } catch {
      if (inspector.open && rev === sequence) {
        const msg = document.createElement('p'); msg.textContent = 'Source unavailable.';
        panel.replaceChildren(msg); sourceStatus.textContent = 'Source unavailable.';
      }
    }
  }

  tabs.addEventListener('click', e => { const i = buttons.indexOf(e.target); if (i >= 0) selectTab(i); }, { signal });
  tabs.addEventListener('keydown', e => {
    const n = buttons.length;
    if (e.key === 'ArrowRight') selectTab((current + 1) % n, true);
    else if (e.key === 'ArrowLeft') selectTab((current - 1 + n) % n, true);
    else if (e.key === 'Home') selectTab(0, true);
    else if (e.key === 'End') selectTab(n - 1, true);
    else return;
    e.preventDefault();
  }, { signal });

  wrap.addEventListener('change', () => inspector.classList.toggle('ak-wrap', wrap.checked), { signal });
  copy.addEventListener('click', async () => {
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(raw.text);
      audio?.play('snap');
      sourceStatus.textContent = 'Copied raw source.';
    } catch {
      fallbackCopy?.remove();
      fallbackCopy = document.createElement('textarea');
      fallbackCopy.readOnly = true; fallbackCopy.rows = 4; fallbackCopy.value = raw.text;
      sourceStatus.after(fallbackCopy); fallbackCopy.focus(); fallbackCopy.select();
      sourceStatus.textContent = 'Clipboard blocked; raw source selected below for manual copy.';
    }
  }, { signal });
  save.addEventListener('click', () => {
    if (!raw) return;
    const blob = new Blob([raw.text], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = raw.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    audio?.play('snap');
    sourceStatus.textContent = `Downloaded ${raw.name}.`;
  }, { signal });
  inspector.addEventListener('close', () => {
    tabAbort?.abort(); fallbackCopy?.remove(); fallbackCopy = null;
    audio?.play('drawer', { open: false });
    restore(sourceFrom);
  }, { signal });

  return {
    openPalette,
    async openSource(rec, format = 'html', opener = document.activeElement) {
      if (document.querySelector('dialog[open]')) return;
      sourceFrom = opener; record = null; raw = null; htmlCache = null; extractedCache = null;
      inspector.querySelector('h2').textContent = typeof rec === 'object' ? rec.name : 'Source inspector';
      sourceStatus.textContent = 'Loading resource…';
      inspector.showModal();
      audio?.play('drawer', { open: true });
      const rev = ++sequence;
      try {
        record = typeof rec === 'object' ? rec : (await records()).find(x => x.r.id === rec)?.r;
        if (!inspector.open || rev !== sequence) return;
        if (!record) { sourceStatus.textContent = 'Resource not found.'; return; }
        saveRecent(record.id);
        inspector.querySelector('h2').textContent = record.name;
        selectTab(Math.max(0, TABS.findIndex(([k]) => k === format)));
      } catch {
        if (inspector.open && rev === sequence) sourceStatus.textContent = 'Resource unavailable.';
      }
    },
    destroy() { life.abort(); tabAbort?.abort(); palette.remove(); inspector.remove(); }
  };
}
