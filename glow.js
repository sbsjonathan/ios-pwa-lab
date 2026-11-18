(() => {
  'use strict';

  const root = document.documentElement;
  const aura = document.getElementById('aura');
  const canvas = aura.querySelector('canvas');
  const ink = canvas.getContext('2d');
  const turn = 2 * Math.PI;
  const cycleMs = 12400;
  const frameMs = 1000 / 30;
  let elapsed = 0;
  let startedAt = null;
  let frame = 0;
  let lastPaint = -Infinity;
  let lastShape = '';

  // Each stop is a position clockwise from twelve o’clock and a color of the glass.
  const spectrum = [
    [0, '#926bff'], [.105, '#bf6df6'], [.173, '#e58ce7'],
    [.245, '#ffac46'], [.29, '#ffb15d'], [.344, '#d68fe8'],
    [.405, '#9261ff'], [.505, '#c379fa'], [.616, '#ff94b7'],
    [.705, '#ff467d'], [.764, '#f143a2'], [.818, '#a375f4'],
    [.905, '#429aff'], [.952, '#558dff'], [1, '#926bff']
  ];

  function updateContour() {
    const width = aura.clientWidth;
    const height = aura.clientHeight;
    if (!width || !height) return;
    const key = [width, height, root.dataset.corners, root.dataset.theme].join('/');
    if (key === lastShape) return;
    lastShape = key;

    const radius = Math.min(62, width * .137, height * .137);
    const top = root.dataset.corners === 'square' ? 0 : radius;
    // Continuous-looking corners meet each straight edge with a gentle tangent.
    const shoulder = .36;
    const b = radius * shoulder;
    const t = top * shoulder;
    const outline = [
      'M', top, 0, 'H', width - top, 'C', width - t, 0, width, t, width, top,
      'V', height - radius, 'C', width, height - b, width - b, height, width - radius, height,
      'H', radius, 'C', b, height, 0, height - b, 0, height - radius,
      'V', top, 'C', 0, t, t, 0, top, 0, 'Z'
    ].join(' ');

    // Rasterize the optical falloff only on resize or an appearance change.
    // The thin saturated lip and diffuse inner reflection share one silhouette.
    const dark = root.dataset.theme === 'dark';
    const layers = dark
      ? [[57, 9, .10], [29, 5.5, .23], [13, 3.2, .54], [5.2, 1.2, .88], [1.7, .35, .97]]
      : [[53, 8, .12], [28, 5.1, .32], [14, 3.1, .66], [6, 1.15, .94], [2, .4, 1]];
    const filters = layers.map(([, blur], i) =>
      '<filter id="b' + i + '" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="' + blur + '"/></filter>'
    ).join('');
    const strokes = layers.map(([weight, , opacity], i) =>
      '<use href="#rim" xlink:href="#rim" stroke-width="' + weight + '" opacity="' + opacity + '" filter="url(#b' + i + ')"/>'
    ).join('');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + width + ' ' + height + '">' +
      '<defs><path id="rim" d="' + outline + '"/><clipPath id="glass"><path d="' + outline + '"/></clipPath>' + filters + '</defs>' +
      '<g clip-path="url(#glass)" stroke="white" stroke-linejoin="round" fill="none">' + strokes + '</g></svg>';
    canvas.style.setProperty('--edge-mask', 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")');
  }

  function phase(now = performance.now()) {
    const activeMs = startedAt === null ? 0 : now - startedAt;
    return ((elapsed + activeMs) % cycleMs) / cycleMs;
  }

  function draw(now) {
    if (!ink) return;
    const angle = turn * phase(now);
    const center = canvas.width / 2;
    // The color map stretches with the viewport. Painting it at low resolution
    // keeps the animation cheap while the independent mask stays full resolution.
    const cx = center * (1 + .11 * Math.sin(angle * 2));
    const cy = center * (1 + .09 * Math.sin(angle * 3));
    const drift = angle + .38 * Math.sin(angle * 2) + .16 * Math.sin(angle * 3);
    const gradient = ink.createConicGradient(drift - Math.PI / 2, cx, cy);
    for (const [position, color] of spectrum) {
      // Pin the seam but let neighboring pools expand and contract independently.
      const offset = position + .034 * Math.sin(Math.PI * position) * Math.sin(turn * position * 2 - angle * 2);
      gradient.addColorStop(offset, color);
    }
    ink.fillStyle = gradient;
    ink.fillRect(0, 0, canvas.width, canvas.height);
  }

  function tick(now) {
    if (now - lastPaint >= frameMs - 1) {
      draw(now);
      lastPaint = now;
    }
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    updateContour();
    const now = performance.now();
    const playing = !document.hidden && root.dataset.motion !== 'paused' && root.dataset.surface === 'notes';
    if (!playing && startedAt !== null) {
      elapsed = (elapsed + now - startedAt) % cycleMs;
      startedAt = null;
      cancelAnimationFrame(frame);
    }
    if (playing && startedAt === null) {
      startedAt = now;
      lastPaint = now;
      frame = requestAnimationFrame(tick);
    }
    if (!document.hidden && root.dataset.surface === 'notes') draw(now);
  }

  window.LabAura = {phase: () => root.dataset.surface === 'notes' ? phase() : null};
  new MutationObserver(sync).observe(root, {
    attributes: true, attributeFilter: ['data-theme', 'data-motion', 'data-surface', 'data-corners']
  });
  if (window.ResizeObserver) new ResizeObserver(updateContour).observe(aura);
  else window.addEventListener('resize', updateContour);
  document.addEventListener('visibilitychange', sync);
  sync();
})();
