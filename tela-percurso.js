(() => {
  'use strict';
  const root = document.documentElement;
  const study = root.dataset.page === 'estudo';
  const recorder = window.TrialRecorder;
  const controls = document.getElementById('trial-controls');
  const modeWarning = document.querySelector('[data-mode-warning]');
  const installedMedia = matchMedia('(display-mode: standalone)');
  const themeMedia = matchMedia('(prefers-color-scheme: dark)');
  const motionMedia = matchMedia('(prefers-reduced-motion: reduce)');

  function syncDisplay() {
    modeWarning.hidden = navigator.standalone === true || installedMedia.matches;
    root.dataset.theme = themeMedia.matches ? 'dark' : 'light';
    root.dataset.motion = motionMedia.matches ? 'paused' : 'playing';
    document.querySelector('meta[name="theme-color"]').content = themeMedia.matches ? '#17171f' : '#f8f8fa';
  }
  syncDisplay();
  for (const media of [installedMedia, themeMedia, motionMedia]) media.addEventListener('change', syncDisplay);
  window.addEventListener('pageshow', syncDisplay);

  const answers = {
    separada: 'Faixa separada',
    misturada: 'Faixa misturada ao cabeçalho',
    'aura-no-relogio': 'Aura atrás do relógio',
    'aura-abaixo': 'Aura abaixo da barra',
    'cor-difusa': 'Só cor ou desfoque',
    incerto: 'Não consegui distinguir'
  };
  const steps = [
    ['studyBefore', '1 · Estudo'],
    ['notes', '2 · Anotações'],
    ['studyAfter', '3 · Retorno ao estudo']
  ];
  const choices = study ? ['separada', 'misturada', 'incerto'] : ['aura-no-relogio', 'aura-abaixo', 'cor-difusa', 'incerto'];

  controls.innerHTML = `
    <section class="trial-ballot">
      <fieldset>
        <legend data-trip-prompt></legend>
        <p class="instruction"></p>
        <div class="choices"></div>
      </fieldset>
      <p data-trip-status class="feedback" role="status"></p>
    </section>
    <p class="warning" data-trip-warning role="status"></p>
    <section id="resultado" data-trip-report hidden aria-labelledby="result-title">
      <h2 id="result-title">Resultado do percurso</h2>
      <p data-trip-interpretation class="instruction"></p>
      <dl data-trip-summary></dl>
      <div class="result-actions">
        <button class="primary" type="button" data-trip-share>Compartilhar JSON</button>
        <button class="secondary" type="button" data-trip-download>Baixar JSON</button>
        <button class="secondary" type="button" data-trip-copy>Copiar JSON</button>
      </div>
      <p data-export-status class="feedback" role="status"></p>
      <label class="manual-copy" hidden>Selecione e copie o relatório
        <textarea readonly rows="5"></textarea>
      </label>
      <a class="new-trip" data-trip-new href="./estudo.html?iniciar=1">Começar novo percurso</a>
    </section>`;

  const optionList = controls.querySelector('.choices');
  for (const value of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tripObservation = value;
    button.textContent = answers[value];
    button.setAttribute('aria-pressed', 'false');
    optionList.append(button);
  }
  const ballot = controls.querySelector('.trial-ballot');
  const prompt = controls.querySelector('[data-trip-prompt]');
  const hint = ballot.querySelector('.instruction');
  const warning = controls.querySelector('[data-trip-warning]');
  const stepLabel = document.querySelector('[data-trip-step]');
  const stepFeedback = controls.querySelector('[data-trip-status]');
  const resultSection = controls.querySelector('[data-trip-report]');
  const resultSummary = controls.querySelector('[data-trip-summary]');
  const next = document.querySelector('[data-trip-next]');
  const resultsLink = document.querySelector('[data-trip-results-link]');
  const exportStatus = controls.querySelector('[data-export-status]');
  const manualCopy = controls.querySelector('.manual-copy');
  if (!recorder) {
    ballot.hidden = true;
    warning.textContent = 'O registro do percurso não carregou. Reabra o laboratório para registrar as três etapas.';
    return;
  }

  const resultValues = new Map();
  for (const [phase, label] of steps) {
    const row = document.createElement('div');
    const title = document.createElement('dt');
    const value = document.createElement('dd');
    title.textContent = label;
    row.append(title, value);
    resultSummary.append(row);
    resultValues.set(phase, value);
  }

  function describeResult(selected) {
    if (steps.some(([phase]) => !selected[phase])) return 'Cada etapa guarda a sua observação. Você também pode exportar um percurso parcial.';
    if (selected.studyBefore === 'separada' && selected.studyAfter === 'separada') {
      if (selected.notes === 'aura-no-relogio') return 'Você viu a aura atrás do relógio e a faixa separada nas duas visitas ao estudo.';
      if (selected.notes === 'aura-abaixo') return 'A faixa ficou separada nas duas visitas. Em Anotações, você viu a aura terminar abaixo da barra.';
    }
    return 'Compare a sua marca em Anotações com a aparência da faixa nas duas visitas ao estudo.';
  }

  function render() {
    const state = recorder.getState();
    const report = recorder.getReport();
    const current = report.visits.find(visit => visit.id === state.visitId);
    const lastChoice = current?.observation?.value;
    const progress = steps.find(([phase]) => phase === state.phase);
    stepLabel.textContent = progress ? progress[1] : (study ? 'Estudo' : 'Anotações');
    const onReturn = state.phase === 'studyAfter';
    prompt.textContent = study ? (onReturn ? 'Como está a faixa ao voltar?' : 'Como está a faixa do relógio?') : 'Até onde chega a aura?';
    hint.textContent = study
      ? (onReturn ? 'Observe a divisão entre o relógio e a data mais uma vez.' : 'Observe a divisão entre o relógio e a data. Marque o que você vê.')
      : 'Acompanhe a luz nos cantos ao lado da hora e da bateria. Marque o que você vê.';
    warning.textContent = state.warning || (state.phase === 'untracked'
      ? 'Esta página foi aberta fora da sequência. Volte ao estudo para começar a comparação.' : '');
    for (const button of optionList.children) {
      button.setAttribute('aria-pressed', String(button.dataset.tripObservation === lastChoice));
    }
    const message = lastChoice ? 'Observação registrada.' : '';
    if (stepFeedback.textContent !== message) stepFeedback.textContent = message;
    const showResult = onReturn || state.storage === 'memory';
    resultSection.hidden = !showResult;
    next.hidden = onReturn;
    resultsLink.hidden = !onReturn;
    if (showResult) {
      const selected = {};
      for (const visit of report.visits) {
        if (visit.observation) selected[visit.phase] = visit.observation.value;
      }
      for (const [phase] of steps) resultValues.get(phase).textContent = answers[selected[phase]] || 'Sem marcação';
      controls.querySelector('[data-trip-interpretation]').textContent = describeResult(selected);
    }
  }
  optionList.addEventListener('click', event => {
    const button = event.target.closest('[data-trip-observation]');
    if (!button) return;
    if (recorder.mark(button.dataset.tripObservation)) render();
    else stepFeedback.textContent = 'Reabra o percurso pelo estudo para registrar a observação.';
  });
  window.addEventListener('trial:change', render);
  window.addEventListener('pageshow', render);
  render();

  function exportData() {
    const report = recorder.getReport();
    const filename = 'percurso-' + root.dataset.profile + '-' + report.tripId + '.json';
    return {filename, json: JSON.stringify(report, null, 2)};
  }
  controls.querySelector('[data-trip-share]').addEventListener('click', async () => {
    const {filename, json} = exportData();
    try {
      const file = new File([json], filename, {type: 'application/json'});
      if (!navigator.canShare?.({files: [file]})) {
        exportStatus.textContent = 'Use Baixar JSON ou Copiar JSON neste navegador.';
        return;
      }
      await navigator.share({files: [file]});
      exportStatus.textContent = 'Relatório compartilhado.';
    } catch (error) {
      exportStatus.textContent = error.name === 'AbortError' ? 'Compartilhamento cancelado.' : 'Use Baixar JSON ou Copiar JSON para salvar o relatório.';
    }
  });
  controls.querySelector('[data-trip-download]').addEventListener('click', () => {
    const {filename, json} = exportData();
    const href = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
    exportStatus.textContent = 'Arquivo preparado para download.';
  });
  controls.querySelector('[data-trip-copy]').addEventListener('click', async () => {
    const {json} = exportData();
    try {
      await navigator.clipboard.writeText(json);
      manualCopy.hidden = true;
      exportStatus.textContent = 'Relatório copiado.';
    } catch (_) {
      manualCopy.hidden = false;
      const textarea = manualCopy.querySelector('textarea');
      textarea.value = json;
      textarea.focus();
      textarea.select();
      exportStatus.textContent = 'O texto do relatório está selecionado para copiar.';
    }
  });
})();
