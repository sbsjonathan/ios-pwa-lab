/* Loaded before the lab controls so the initial measurement precedes opening a panel. */
(() => {
  'use strict';
  const root = document.documentElement;
  const profile = root.dataset.profile;
  if (!['padrao', 'translucido'].includes(profile) || window.LabRecorder) return;

  const build = document.querySelector('meta[name="app-version"]')?.content ?? null;
  const sessionId = crypto.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const start = performance.now();
  const startedAt = new Date().toISOString();
  const labBase = new URL('./', document.currentScript.src);
  const prefix = 'ios-pwa-lab:v1:' + profile + ':';
  const slots = Array.from({length: 4}, (_, i) => prefix + 'session-' + i);
  const limits = {sessions: slots.length, samples: 80, events: 160, observations: 24, checkpointChars: 176 * 1024};
  const dropped = {samples: 0, events: 0, observations: 0};
  const events = [], samples = [], observations = [];
  const changes = new Map();
  let sequence = 0, baseline = null, endedAt = null, slot = null;
  let device = {model: null, os: null};
  let storage = {available: null, lastError: null};
  let saveTimer = 0, measureTimer = 0, settleTimer = 0;
  let readyState = {state: 'preparing', build: null, profile: null};
  let lastMeasure = -Infinity;
  const timerMs = () => Math.round(performance.now() - start);
  const num = n => Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  const clip = (s, max) => typeof s === 'string' ? s.slice(0, max) : null;
  const media = q => matchMedia(q).matches;
  const stamp = () => ({seq: ++sequence, atMs: timerMs()});
  const slotHeader = key => key + ':header';

  // Only these fixed keys ever get opened. Other apps on github.io can share this origin.
  function readJSON(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  function storageStatus(available, lastError = null) {
    if (available === storage.available && lastError === storage.lastError) return;
    storage = {available, lastError};
    window.dispatchEvent(new CustomEvent('lab:storage', {detail:{...storage}}));
  }
  function storageError(error) { storageStatus(false, error.name || 'StorageError'); }
  try {
    device = readJSON(prefix + 'device') || device;
    // Each run owns one of four slots. A resumed tab cannot overwrite a newer recording.
    const headers = slots.map(key => ({key, header: readJSON(slotHeader(key))}));
    slot = headers.find(item => !item.header)?.key ||
      headers.sort((a, b) => a.header.startedAt.localeCompare(b.header.startedAt))[0].key;
    localStorage.setItem(slotHeader(slot), JSON.stringify({id: sessionId, startedAt, count: 0, profile}));
    storage.available = true;
  } catch (error) { storageError(error); }

  const probes = document.createElement('div');
  probes.setAttribute('aria-hidden', 'true');
  probes.style.cssText = 'position:fixed;inset:0;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);box-sizing:border-box';
  const units = {};
  for (const unit of ['vh', 'svh', 'lvh', 'dvh']) {
    if (!CSS.supports('height', '100' + unit)) continue;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:100' + unit;
    probes.append(probe);
    units[unit] = probe;
  }
  document.body.append(probes);
  const elements = Object.fromEntries(['aura', 'editor', 'dock', 'panel', 'workspace'].map(id => [id, document.getElementById(id)]));
  function elementName(el) {
    if (!el) return null;
    if (el === document || el === document.documentElement || el === document.body) return 'document';
    if (!(el instanceof Element)) return null;
    for (const [id, owner] of Object.entries(elements)) {
      if (el === owner || owner?.contains(el)) return id;
    }
    return el.localName;
  }
  function rect(box) {
    if (!box) return null;
    return {x: num(box.x), y: num(box.y), width: num(box.width), height: num(box.height),
      top: num(box.top), bottom: num(box.bottom), left: num(box.left), right: num(box.right)};
  }
  function metrics(el) {
    if (!el) return null;
    const css = getComputedStyle(el);
    return {rect: rect(el.getBoundingClientRect()), position: css.position, display: css.display,
      visibility: css.visibility, opacity: css.opacity, zIndex: css.zIndex, overflowY: css.overflowY,
      scrollTop: num(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      backgroundColor: css.backgroundColor, borderTopLeftRadius: css.borderTopLeftRadius,
      borderBottomLeftRadius: css.borderBottomLeftRadius, backdropFilter: css.backdropFilter || css.webkitBackdropFilter || null};
  }
  function caret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !elements.editor?.contains(selection.focusNode)) return null;
    try {
      // A fresh, collapsed range contains only geometry; it never modifies the selection.
      const range = document.createRange();
      range.setStart(selection.focusNode, selection.focusOffset);
      range.collapse(true);
      const box = range.getBoundingClientRect();
      return {collapsed: selection.isCollapsed, rect: box.height || box.width ? rect(box) : null};
    } catch (_) { return null; }
  }
  function localScript(src) {
    if (!src) return null;
    try {
      const path = new URL(src, labBase);
      if (path.origin !== labBase.origin || !path.pathname.startsWith(labBase.pathname)) return 'external';
      return path.pathname.slice(labBase.pathname.length);
    } catch (_) { return null; }
  }
  function snapshot(reason) {
    const css = getComputedStyle(probes);
    const safeAreas = {top: num(parseFloat(css.paddingTop)), right: num(parseFloat(css.paddingRight)),
      bottom: num(parseFloat(css.paddingBottom)), left: num(parseFloat(css.paddingLeft))};
    const fixedEdges = rect(probes.getBoundingClientRect());
    const v = window.visualViewport;
    const vv = v ? {width: num(v.width), height: num(v.height), offsetTop: num(v.offsetTop),
      offsetLeft: num(v.offsetLeft), pageTop: num(v.pageTop), pageLeft: num(v.pageLeft), scale: num(v.scale)} : null;
    const geometry = Object.fromEntries(Object.entries(elements).map(([name, el]) => [name, metrics(el)]));
    const visualBottom = vv ? vv.offsetTop + vv.height : null;
    const cursor = caret();
    const keyboard = navigator.virtualKeyboard?.boundingRect;
    return {...stamp(), reason, visibility: document.visibilityState, focused: elementName(document.activeElement),
      viewport: {innerWidth, innerHeight, clientWidth: root.clientWidth, clientHeight: root.clientHeight,
        scrollX: num(scrollX), scrollY: num(scrollY), visual: vv},
      screen: {width: screen.width, height: screen.height, availWidth: screen.availWidth,
        availHeight: screen.availHeight, dpr: num(devicePixelRatio),
        orientation: screen.orientation?.type || (media('(orientation: portrait)') ? 'portrait' : 'landscape'),
        angle: screen.orientation?.angle ?? window.orientation ?? null},
      units: Object.fromEntries(['vh','svh','lvh','dvh'].map(u => [u, num(units[u]?.getBoundingClientRect().height)])),
      safeAreas, fixedEdges, elements: geometry, caret: cursor, reportedKeyboardRect: rect(keyboard),
      distances: {
        screenMinusInner: num(screen.height - innerHeight),
        auraTopMinusFixedTop: geometry.aura ? num(geometry.aura.rect.top - fixedEdges.top) : null,
        dockBottomMinusVisualBottom: geometry.dock && visualBottom !== null ? num(geometry.dock.rect.bottom - visualBottom) : null,
        caretBottomMinusVisualBottom: cursor?.rect && visualBottom !== null ? num(cursor.rect.bottom - visualBottom) : null
      },
      appearance: {theme: root.dataset.theme || null, systemDark: media('(prefers-color-scheme: dark)'),
        auraPhase: num(window.LabAura?.phase?.()), corners: root.dataset.corners || null, motion: root.dataset.motion || null, surface: root.dataset.surface || null,
        reducedMotion: media('(prefers-reduced-motion: reduce)'), themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null},
      online: navigator.onLine, serviceWorker: {...readyState}};
  }
  const boot = {
    hrefPath: location.pathname, viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
    statusBarStyle: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content ?? null,
    standalone: typeof navigator.standalone === 'boolean' ? navigator.standalone : null,
    displayModes: Object.fromEntries(['standalone','browser','fullscreen','minimal-ui'].map(mode => [mode, media('(display-mode: ' + mode + ')')])),
    userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language,
    maxTouchPoints: navigator.maxTouchPoints, timeOrigin: performance.timeOrigin,
    navigationType: performance.getEntriesByType('navigation')[0]?.type ?? null,
    supported: {visualViewport: !!window.visualViewport, serviceWorker: 'serviceWorker' in navigator,
      safeArea: CSS.supports('padding-top','env(safe-area-inset-top)'), virtualKeyboard: 'virtualKeyboard' in navigator,
      segmentAPI: !!window.visualViewport && 'segments' in visualViewport,
      resizeObserver: 'ResizeObserver' in window, indexedDB: 'indexedDB' in window},
    network: {effectiveType: navigator.connection?.effectiveType ?? null, saveData: navigator.connection?.saveData ?? null}
  };
  function current() {
    return {type: 'ios-pwa-lab-session', schemaVersion: 1, sessionId, profile, build,
      startedAt, endedAt, exportedAt: new Date().toISOString(), device: {...device}, boot,
      baseline, samples: [...samples], events: [...events], observations: [...observations], dropped: {...dropped},
      limits, storage: {...storage}, offline: {...readyState},
      limitations: ['Native status bar pixels and the home indicator require visual observation.',
        'Visual viewport changes alone do not establish whether the keyboard is open.',
        'Device model and OS version are operator declarations.'],
      privacy: 'No input text, keystrokes, note content, arbitrary URLs or keys from other apps are recorded.'};
  }
  function listSessions() {
    const mine = {id: sessionId, startedAt, endedAt, profile, count: sequence};
    try {
      const headers = slots.map(k => readJSON(slotHeader(k))).filter(item => item?.id && item.id !== sessionId);
      return [mine, ...headers].sort((a,b) => b.startedAt.localeCompare(a.startedAt));
    } catch (_) { return [mine]; }
  }
  function getReport(id) {
    if (!id || id === sessionId) return current();
    try {
      const key = slots.find(k => readJSON(slotHeader(k))?.id === id);
      const report = key ? readJSON(key) : null;
      return report?.sessionId === id ? report : null;
    } catch (_) { return null; }
  }
  function flush() {
    clearTimeout(saveTimer); saveTimer = 0;
    if (!slot) return false;
    try {
      const owner = readJSON(slotHeader(slot));
      if (owner?.id !== sessionId) {
        slot = null;
        storageStatus(false, 'SessionSlotReused');
        return false;
      }
      // Cap UTF-16 storage even when viewport/style snapshots are unusually
      // large. Keep the baseline and every accepted observation in a checkpoint.
      function encodeCheckpoint() {
        const report = current();
        report.storage = {available: true, lastError: null};
        return JSON.stringify(report);
      }
      let encoded = encodeCheckpoint();
      while (encoded.length > limits.checkpointChars && samples.length) {
        const excess = encoded.length - limits.checkpointChars;
        const count = Math.min(samples.length, Math.max(1, Math.ceil(excess / 2500)));
        samples.splice(0, count);
        dropped.samples += count;
        encoded = encodeCheckpoint();
      }
      if (encoded.length > limits.checkpointChars) {
        storageStatus(false, 'CheckpointBudgetExceeded');
        return false;
      }
      localStorage.setItem(slot, encoded);
      localStorage.setItem(slotHeader(slot), JSON.stringify({id: sessionId, startedAt, endedAt, profile, count: sequence}));
      storageStatus(true);
      return true;
    } catch (error) { storageError(error); return false; }
  }
  function scheduleSave() {
    if (!saveTimer && slot) saveTimer = setTimeout(flush, 1500);
  }
  function pushBounded(list, name, entry) {
    if (list.length >= limits[name]) { list.shift(); dropped[name]++; }
    list.push(entry);
    scheduleSave();
  }
  function capture(reason = 'manual') {
    const entry = snapshot(clip(reason, 96));
    lastMeasure = performance.now();
    pushBounded(samples, 'samples', entry);
    return entry;
  }
  function mark(label, previous) {
    if (!label || typeof label !== 'string') return null;
    if (observations.length >= limits.observations) { dropped.observations++; scheduleSave(); return null; }
    const entry = previous?.seq && previous?.viewport ? previous : snapshot('observation');
    observations.push({...stamp(), observation: clip(label, 160), snapshot: entry});
    flush();
    return entry;
  }
  function setDevice(input = {}) {
    device = {model: clip(input.model?.trim(), 80), os: clip(input.os?.trim(), 32)};
    try { localStorage.setItem(prefix + 'device', JSON.stringify(device)); }
    catch (error) { storageError(error); }
    flush();
  }
  function event(type, detail) {
    pushBounded(events, 'events', {...stamp(), type, ...(detail && {detail})});
  }
  function collectChanges() {
    measureTimer = 0;
    if (!changes.size) return;
    const reasons = Object.fromEntries(changes);
    changes.clear();
    const sample = capture('geometry');
    sample.reasons = reasons;
  }
  function queue(reason) {
    changes.set(reason, (changes.get(reason) || 0) + 1);
    if (!measureTimer) measureTimer = setTimeout(collectChanges, Math.max(0, 160 - (performance.now() - lastMeasure)));
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => capture('settled'), 450);
  }
  function edge(type, detail = null) {
    event(type, detail);
    capture(type);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => capture('settled'), 450);
  }

  window.LabRecorder = Object.freeze({sessionId, capture, mark, getReport, listSessions, flush, setDevice});
  baseline = snapshot('before-controls');
  flush();
  addEventListener('pageshow', e => { endedAt = null; edge('pageshow', {persisted: e.persisted}); });
  addEventListener('pagehide', e => {
    endedAt = e.persisted ? null : new Date().toISOString();
    clearTimeout(measureTimer); clearTimeout(settleTimer); collectChanges();
    event('pagehide', {persisted: e.persisted}); capture('pagehide'); flush();
  });
  document.addEventListener('visibilitychange', () => {
    edge('visibilitychange', {state: document.visibilityState});
    if (document.hidden) flush();
  });
  for (const type of ['online','offline','orientationchange']) addEventListener(type, () => edge(type));
  for (const type of ['focusin','focusout']) document.addEventListener(type, e => edge(type, {target: elementName(e.target)}));
  document.addEventListener('scroll', e => queue('scroll:' + elementName(e.target)), {capture: true, passive: true});
  addEventListener('resize', () => queue('resize'), {passive: true});
  for (const type of ['resize','scroll']) window.visualViewport?.addEventListener(type, () => queue('visualViewport:' + type), {passive:true});
  for (const type of ['input','selectionchange','compositionstart','compositionend']) {
    document.addEventListener(type, () => { if (elementName(document.activeElement) === 'editor') queue(type); });
  }
  navigator.virtualKeyboard?.addEventListener('geometrychange', () => edge('virtualKeyboard:geometrychange'));
  if ('ResizeObserver' in window) {
    const resize = new ResizeObserver(() => queue('resizeObserver'));
    for (const el of [root, ...Object.values(elements)]) if (el) resize.observe(el);
  }
  for (const query of ['(prefers-color-scheme: dark)','(prefers-reduced-motion: reduce)','(display-mode: standalone)']) {
    matchMedia(query).addEventListener('change', () => edge('mediaquery', {query}));
  }
  addEventListener('error', e => {
    // Native error messages and rejection reasons may include user-entered text.
    const resource = e.filename || (e.target instanceof Element ? e.target.src || e.target.href : null);
    event('error', {source:localScript(resource), line: num(e.lineno), column: num(e.colno), target: elementName(e.target)});
  }, true);
  addEventListener('unhandledrejection', () => event('unhandledrejection'));
  function workerEvent(reason, worker) {
    event(reason, {script:localScript(worker?.scriptURL), state: worker?.state ?? null});
  }
  const sw = navigator.serviceWorker;
  if (sw) {
    const observed = new WeakSet();
    const watch = (worker, source) => {
      if (!worker) return;
      workerEvent(source, worker);
      if (observed.has(worker)) return;
      observed.add(worker);
      worker.addEventListener('statechange', () => workerEvent('worker:state', worker));
    };
    watch(sw.controller, 'worker:initial-controller');
    sw.addEventListener('controllerchange', () => watch(sw.controller, 'worker:controllerchange'));
    sw.ready.then(registration => {
      watch(registration.active,'worker:active'); watch(registration.waiting, 'worker:waiting');
      registration.addEventListener('updatefound', () => watch(registration.installing, 'worker:installing'));
    }).catch(() => event('worker:registration-error'));
  }
  addEventListener('lab:offline', e => {
    readyState = {state: clip(e.detail?.state, 32), build: clip(e.detail?.build, 48), profile: clip(e.detail?.profile, 32)};
    edge('worker:offline-status', {...readyState});
  });
})();
