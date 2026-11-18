(() => {
  'use strict';

  const root = document.documentElement;
  const byId = id => document.getElementById(id);
  const recorder = window.LabRecorder;
  const panel = byId('panel');
  const dock = byId('dock');
  const sheet = panel.querySelector('.sheet');
  const themeMedia = matchMedia('(prefers-color-scheme: dark)');
  const motionMedia = matchMedia('(prefers-reduced-motion: reduce)');
  const standaloneMedia = matchMedia('(display-mode: standalone)');
  let hasChosenTheme = false;
  let hasChosenMotion = false;
  let pendingMoment = null;
  let openingButton = null;
  let noticeTimer = 0;

  function syncOptions() {
    for (const key of ['theme', 'corners', 'surface']) {
      for (const button of panel.querySelectorAll('[id^="' + key + '-"]')) {
        button.setAttribute('aria-pressed', String(button.id === key + '-' + root.dataset[key]));
      }
    }
    const paused = root.dataset.motion === 'paused';
    byId('motion').textContent = paused ? 'Animar a luz' : 'Pausar a luz';
    byId('motion').disabled = root.dataset.surface === 'solid';
  }

  function useTheme(value) {
    root.dataset.theme = value;
    document.querySelector('meta[name="theme-color"]').content = value === 'dark' ? '#17171f' : '#f8f8fa';
    syncOptions();
  }

  function updateMode() {
    const installed = navigator.standalone === true || standaloneMedia.matches;
    byId('launch-mode').textContent = installed ? 'Tela de Início' : 'Navegador';
  }

  function presentNotice(text) {
    byId('toast').textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { byId('toast').textContent = ''; }, 2600);
  }

  function makeMoment() {
    pendingMoment = recorder.capture('before-observation-panel');
  }

  function displaySessionInfo() {
    const report = recorder.getReport(byId('session-select').value);
    const info = byId('session-info');
    if (!report) {
      info.textContent = 'Essa sessão já saiu do histórico.';
      return;
    }
    const observations = report.observations?.length || 0;
    const markerText = observations === 1 ? '1 momento marcado' : observations + ' momentos marcados';
    info.textContent = report.storage?.available === false
      ? markerText + '. Armazenamento indisponível. Exporte antes de fechar.'
      : markerText + '.';
    byId('manual-export').hidden = true;
    byId('manual-json').value = '';
    byId('report-status').textContent = '';
  }

  function listReports() {
    recorder.flush();
    const list = byId('session-select');
    list.replaceChildren();
    for (const entry of recorder.listSessions()) {
      const current = entry.id === recorder.sessionId;
      const date = new Date(entry.startedAt);
      const stamp = Number.isFinite(date.getTime())
        ? date.toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})
        : String(entry.startedAt);
      const option = new Option((current ? 'Atual · ' : '') + stamp, entry.id);
      list.add(option);
    }
    if (!Array.from(list.options).some(option => option.value === recorder.sessionId)) {
      list.add(new Option('Sessão atual', recorder.sessionId));
    }
    list.value = recorder.sessionId;
    displaySessionInfo();
  }

  function openPanel(view, trigger) {
    if (view === 'mark') {
      if (!pendingMoment) makeMoment();
    } else {
      recorder.capture('before-' + view + '-panel');
    }
    openingButton = trigger;
    const titles = {mark:'Marcar momento', tools:'Ferramentas', reports:'Relatórios'};
    byId('panel-title').textContent = titles[view];
    for (const key of Object.keys(titles)) byId('view-' + key).hidden = key !== view;
    if (view === 'reports') listReports();
    if (view === 'tools') {
      const {device} = recorder.getReport();
      byId('device-model').value = device?.model || '';
      byId('device-os').value = device?.os || '';
      byId('device-feedback').textContent = '';
    }
    byId('workspace').inert = true;
    dock.inert = true;
    panel.hidden = false;
    sheet.scrollTop = 0;
    byId('panel-close').focus({preventScroll:true});
  }

  function closePanel() {
    panel.hidden = true;
    dock.inert = false;
    byId('workspace').inert = false;
    openingButton?.focus({preventScroll:true});
    pendingMoment = null;
  }

  function getExport() {
    const report = recorder.getReport(byId('session-select').value);
    if (!report) throw new Error('Sessão indisponível.');
    const json = JSON.stringify(report, null, 2);
    const filename = 'ios-pwa-' + root.dataset.profile + '-' + report.sessionId + '.json';
    return {json, file: new File([json], filename, {type:'application/json'})};
  }

  function showManual(json, text) {
    byId('manual-export').hidden = false;
    const textarea = byId('manual-json');
    textarea.value = json;
    textarea.focus({preventScroll:true});
    textarea.select();
    byId('report-status').textContent = text;
  }

  async function exportReport(action) {
    let payload;
    const status = byId('report-status');
    try {
      payload = getExport();
      if (action === 'share') {
        if (!navigator.canShare?.({files:[payload.file]})) {
          status.textContent = 'Neste navegador, use Baixar JSON ou Copiar JSON.';
          return;
        }
        await navigator.share({files:[payload.file]});
        status.textContent = 'Relatório compartilhado.';
      } else if (action === 'download') {
        const href = URL.createObjectURL(payload.file);
        const link = document.createElement('a');
        link.href = href;
        link.download = payload.file.name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60000);
        status.textContent = 'Arquivo JSON preparado.';
      } else {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(payload.json);
          status.textContent = 'Relatório copiado.';
        } else {
          showManual(payload.json, 'Copie o texto selecionado.');
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (payload && action === 'copy') showManual(payload.json, 'Copie o texto selecionado.');
      else status.textContent = 'Não foi possível exportar. Tente outra opção.';
    }
  }

  function updateOffline(detail) {
    const state = detail?.state || 'preparing';
    const labels = {preparing:'Preparando uso offline…', ready:'Disponível offline', unavailable:'Uso offline indisponível'};
    byId('offline-state').textContent = labels[state] || labels.unavailable;
    byId('offline-state').parentNode.dataset.state = state;
  }

  const feedback = document.createElement('p');
  feedback.id = 'device-feedback';
  feedback.setAttribute('role', 'status');
  byId('save-device').after(feedback);
  useTheme(themeMedia.matches ? 'dark' : 'light');
  root.dataset.motion = motionMedia.matches ? 'paused' : 'playing';
  syncOptions();
  updateMode();
  updateOffline(window.LabOffline);
  themeMedia.addEventListener('change', () => { if (!hasChosenTheme) useTheme(themeMedia.matches ? 'dark' : 'light'); });
  motionMedia.addEventListener('change', () => {
    if (!hasChosenMotion) root.dataset.motion = motionMedia.matches ? 'paused' : 'playing';
    syncOptions();
  });
  standaloneMedia.addEventListener('change', updateMode);
  window.addEventListener('lab:offline', event => updateOffline(event.detail));
  function updateStorage(status) {
    byId('storage-warning').hidden = status?.available !== false;
    if (!panel.hidden && !byId('view-reports').hidden) displaySessionInfo();
  }
  window.addEventListener('lab:storage', event => updateStorage(event.detail));
  updateStorage(recorder.getReport().storage);
  for (const name of ['mark', 'tools', 'reports']) {
    byId(name).addEventListener('click', () => openPanel(name, byId(name)));
  }
  // Capture before focus leaves the editor or a panel changes the viewport.
  byId('mark').addEventListener('pointerdown', makeMoment);
  byId('mark').addEventListener('pointercancel', () => { pendingMoment = null; });
  byId('mark').addEventListener('keydown', event => {
    if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) makeMoment();
  });
  byId('panel-close').addEventListener('click', closePanel);
  panel.addEventListener('click', event => {
    if (event.target === panel) closePanel();
  });
  document.addEventListener('keydown', event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
    } else if (event.key === 'Tab') {
      const items = Array.from(panel.querySelectorAll('button:not(:disabled), input, select, summary, textarea')).filter(item => item.getClientRects().length);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  });
  for (const button of panel.querySelectorAll('[data-observation]')) {
    button.addEventListener('click', () => {
      const observation = recorder.mark(button.dataset.observation, pendingMoment);
      closePanel();
      presentNotice(observation ? 'Momento registrado.' : 'Limite de momentos atingido.');
    });
  }
  for (const value of ['light', 'dark']) byId('theme-' + value).addEventListener('click', () => {
    hasChosenTheme = true;
    useTheme(value);
    recorder.capture('theme-' + value);
  });
  for (const [key, values] of [['corners', ['rounded', 'square']], ['surface', ['notes', 'solid']]]) {
    for (const value of values) byId(key + '-' + value).addEventListener('click', () => {
      root.dataset[key] = value;
      syncOptions();
      recorder.capture(key + '-' + value);
    });
  }
  byId('motion').addEventListener('click', () => {
    hasChosenMotion = true;
    root.dataset.motion = root.dataset.motion === 'playing' ? 'paused' : 'playing';
    syncOptions();
    recorder.capture('motion-' + root.dataset.motion);
  });
  byId('save-device').addEventListener('click', () => {
    recorder.setDevice({model:byId('device-model').value.trim(), os:byId('device-os').value.trim()});
    feedback.textContent = 'Identificação registrada.';
  });
  byId('session-select').addEventListener('change', displaySessionInfo);
  for (const action of ['share', 'download', 'copy']) byId(action).addEventListener('click', () => exportReport(action));
  byId('return-top').addEventListener('click', () => window.scrollTo({top:0, behavior:motionMedia.matches ? 'auto' : 'smooth'}));
  recorder.capture('test-ui-ready');
})();
