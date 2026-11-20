/* The route experiment spans documents. Keep its compact reports separate from
   the single-page recorder, whose four session slots belong to the original lab. */
(() => {
  'use strict';
  const root = document.documentElement;
  const {profile, page} = root.dataset;
  if (!['padrao', 'translucido'].includes(profile) || !['estudo', 'anotacoes'].includes(page)) return;

  const build = document.querySelector('meta[name="app-version"]')?.content;
  const type = 'ios-pwa-lab-percurso';
  const createId = () => crypto.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const now = () => new Date().toISOString();
  const url = new URL(location.href);
  const requestedId = url.searchParams.has('iniciar') ? null : url.searchParams.get('percurso');
  const navigation = performance.getEntriesByType('navigation')[0]?.type;
  const prefix = 'ios-pwa-lab:percurso:v1:' + profile + ':';
  const keys = Array.from({length: 4}, (_, i) => prefix + i);
  const stores = [];
  let trip = null;
  let storage = 'memory';
  let visitId;
  let settleTimer;

  function read(store, key) {
    const raw = store.getItem(key);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data?.type === type && data.profile === profile && Array.isArray(data.visits) ? data : null;
    } catch (_) { return null; }
  }

  for (const name of ['local', 'session']) {
    try {
      const area = window[name + 'Storage'];
      const records = keys.map(key => ({key, record: read(area, key)}));
      const match = records.find(({record}) => requestedId && record?.tripId === requestedId);
      if (match && (!trip || match.record.revision > trip.revision)) trip = match.record;
      const slot = match || records.find(({record}) => !record) ||
        records.sort((a, b) => a.record.startedAt.localeCompare(b.record.startedAt))[0];
      stores.push({name, area, key: slot.key, owner: slot.record?.tripId});
    } catch (_) { /* Some iOS contexts expose storage but deny access. */ }
  }

  const missingRun = Boolean(requestedId && !trip);
  if (!trip) {
    trip = {type, schemaVersion: 1, tripId: createId(), profile, build, startedAt: now(), revision: 0,
      userAgent: navigator.userAgent, visits: [], omittedVisits: 0};
  }

  function refresh() {
    for (const {area, key} of stores) {
      try {
        const latest = read(area, key);
        if (latest?.tripId === trip.tripId && latest.revision > trip.revision) trip = latest;
      } catch (_) { /* Keep the current document's measurements. */ }
    }
  }

  function persist() {
    trip.revision++;
    const data = JSON.stringify(trip);
    storage = 'memory';
    for (const slot of stores) {
      try {
        const occupant = read(slot.area, slot.key)?.tripId;
        // A tab restored from history must not reclaim an evicted run's slot.
        if (occupant && occupant !== trip.tripId && occupant !== slot.owner) continue;
        slot.area.setItem(slot.key, data);
        slot.owner = trip.tripId;
        if (storage === 'memory') storage = slot.name;
      } catch (_) { /* Try the other storage area. */ }
    }
    window.dispatchEvent(new Event('trial:change'));
  }

  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;overflow:hidden;contain:strict;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)';
  const dynamic = document.createElement('div');
  dynamic.style.height = '100dvh';
  probe.append(dynamic);
  document.body.append(probe);
  const num = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  function edges(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {top: num(rect.top), bottom: num(rect.bottom)};
  }

  function snapshot() {
    const css = getComputedStyle(probe);
    const visual = window.visualViewport;
    return {
      at: now(), hrefPath: location.pathname, build,
      statusBarStyle: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content ?? null,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
      themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
      standalone: typeof navigator.standalone === 'boolean' ? navigator.standalone : null,
      displayModeStandalone: matchMedia('(display-mode: standalone)').matches,
      screen: {width: screen.width, height: screen.height, dpr: devicePixelRatio},
      innerWidth, innerHeight, clientHeight: root.clientHeight, scrollY: num(scrollY),
      visualViewport: visual ? {height: num(visual.height), offsetTop: num(visual.offsetTop), scale: num(visual.scale)} : null,
      dynamicHeight: CSS.supports('height', '100dvh') ? num(dynamic.getBoundingClientRect().height) : null,
      safeAreas: {top: num(parseFloat(css.paddingTop)), bottom: num(parseFloat(css.paddingBottom))},
      fixed: edges(probe), studyBand: edges(document.getElementById('study-band')), studyDate: edges(document.querySelector('.study-heading p')),
      title: edges(document.getElementById('route-page-title')), aura: edges(document.getElementById('aura')),
      dock: edges(document.getElementById('dock')), auraPhase: num(window.LabAura?.phase?.()),
      motion: root.dataset.motion || null, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      online: navigator.onLine, offline: window.LabOffline?.state ?? null, workerBuild: window.LabOffline?.build ?? null
    };
  }

  const currentVisit = () => trip.visits.find(visit => visit.id === visitId);

  function nextPhase() {
    if (page === 'anotacoes') return trip.visits.some(v => v.phase === 'studyBefore') ? 'notes' : 'untracked';
    return trip.visits.some(v => v.phase === 'notes') ? 'studyAfter' : 'studyBefore';
  }

  function openVisit(kind) {
    refresh();
    const remembered = history.state?.labTrip;
    const previous = kind === 'reload' && remembered?.tripId === trip.tripId &&
      trip.visits.find(v => v.id === remembered.visitId && v.page === page);
    if (previous) {
      visitId = previous.id;
      previous.reloads = (previous.reloads || 0) + 1;
    } else {
      visitId = createId();
      trip.visits.push({id: visitId, page, phase: nextPhase(), arrivedAt: now(), navigation: kind,
        arrival: snapshot(), settled: null, observation: null});
      // Keep the first before/notes/after comparison and a bounded tail of revisits.
      if (trip.visits.length > 24) {
        const keep = new Set(['studyBefore','notes','studyAfter'].map(phase =>
          trip.visits.find(v => v.phase === phase && v.observation)?.id || trip.visits.find(v => v.phase === phase)?.id));
        const index = trip.visits.findIndex(v => !keep.has(v.id) && v.id !== visitId);
        trip.visits.splice(index, 1);
        trip.omittedVisits++;
      }
    }
    url.searchParams.delete('iniciar');
    url.searchParams.set('percurso', trip.tripId);
    try { history.replaceState({...history.state, labTrip: {tripId: trip.tripId, visitId}}, '', url); }
    catch (_) { /* Linking between pages still works when history is restricted. */ }
    for (const link of document.querySelectorAll('a[data-trip-next]')) {
      const target = new URL(link.href);
      target.searchParams.set('percurso', trip.tripId);
      link.href = target.href;
    }
    persist();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      refresh();
      const visit = currentVisit();
      if (visit) { visit.settled = snapshot(); persist(); }
    }, 500);
  }

  function state() {
    const phases = ['studyBefore', 'notes', 'studyAfter'];
    let warning = missingRun ? 'O percurso anterior não foi encontrado neste perfil.' : null;
    if (storage === 'session') warning = 'O relatório está disponível nesta janela. Exporte antes de fechá-la.';
    if (storage === 'memory') warning = 'Armazenamento indisponível. Exporte o registro de cada tela antes de sair dela.';
    return {phase: currentVisit()?.phase, visitId, storage, warning,
      hasReturn: trip.visits.some(v => v.phase === 'studyAfter'),
      completed: phases.every(phase => trip.visits.some(v => v.phase === phase && v.observation))};
  }
  function mark(value) {
    const allowed = page === 'estudo' ? ['separada', 'misturada', 'incerto'] :
      ['aura-no-relogio', 'aura-abaixo', 'cor-difusa', 'incerto'];
    if (!allowed.includes(value)) return false;
    refresh();
    const visit = currentVisit();
    if (!visit) return false;
    visit.observation = {value, recordedAt: now(), view: snapshot()};
    persist();
    return true;
  }
  function getReport() {
    const {revision, ...report} = trip;
    return JSON.parse(JSON.stringify({...report, exportedAt: now(), storage, completed: state().completed,
      limitation: 'O alcance da aura e o aspecto da faixa do relógio dependem da observação no iPhone.'}));
  }

  window.TrialRecorder = Object.freeze({getReport, getState: state, mark});
  openVisit(navigation || 'navigate');
  // Back/forward cache resumes the same JS instance. A return to the study
  // must be a new observation, even when the old page and its DOM survive.
  window.addEventListener('pageshow', event => { if (event.persisted) openVisit('bfcache'); });
  window.addEventListener('pagehide', () => clearTimeout(settleTimer));
})();
