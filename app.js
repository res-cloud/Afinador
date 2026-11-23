/* Afinador cromático + metrónomo — v3
 * Todo corre en el dispositivo: sin red, sin cuentas, sin analítica.
 * El audio del micrófono se analiza en memoria y se descarta; nunca se graba.
 */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- Preferencias (nada personal) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('afinador.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('afinador.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  // ---------- Audio compartido ----------
  let ctx = null, master = null;
  const buffers = {};
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }
  async function freshContext(rate) {
    if (ctx) { try { await ctx.close(); } catch { /* nada */ } }
    ctx = null; master = null;
    for (const k of Object.keys(buffers)) delete buffers[k];
    const AC = window.AudioContext || window.webkitAudioContext;
    try { ctx = rate ? new AC({ sampleRate: rate, latencyHint: 'interactive' }) : new AC({ latencyHint: 'interactive' }); }
    catch { ctx = new AC({ latencyHint: 'interactive' }); }
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* nada */ } }
    return ctx;
  }
  // iOS: 'playback' suena por el altavoz e ignora el interruptor de silencio; 'play-and-record' es para el micrófono.
  function setSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* no soportado */ } }

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { /* no soportado */ }
  }

  // ================= AFINADOR =================
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  let a4 = clamp(Number(store.get('a4', 440)) || 440, 415, 466);
  const midiToFreq = (m) => a4 * Math.pow(2, (m - 69) / 12);
  const freqToMidi = (f) => 69 + 12 * Math.log2(f / a4);
  const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const noteName = (m) => ((tuning && tuning.flats) ? FLATS : NAMES)[((m % 12) + 12) % 12];
  const octaveOf = (m) => Math.floor(m / 12) - 1;

  const TUNINGS = [
    { id: 'e',      group: '',                 name: 'Estándar (E A D G B E)',        notes: [40, 45, 50, 55, 59, 64] },
    { id: 'dropd',  group: 'Variaciones',      name: 'Drop D (D A D G B E)',          notes: [38, 45, 50, 55, 59, 64] },
    { id: 'eb',     group: 'Variaciones',      name: 'E♭ (medio tono abajo)',          notes: [39, 44, 49, 54, 58, 63], flats: true },
    { id: 'dropcs', group: 'Variaciones',      name: 'Drop C♯ (C♯ G♯ C♯ F♯ A♯ D♯)',   notes: [37, 44, 49, 54, 58, 63] },
    { id: 'd',      group: 'Variaciones',      name: 'D estándar (D G C F A D)',      notes: [38, 43, 48, 53, 57, 62] },
    { id: 'dropc',  group: 'Variaciones',      name: 'Drop C (C G C F A D)',          notes: [36, 43, 48, 53, 57, 62] },
    { id: 'c',      group: 'Variaciones',      name: 'C estándar (C F B♭ E♭ G C)',    notes: [36, 41, 46, 51, 55, 60], flats: true },
    { id: 'dropb',  group: 'Variaciones',      name: 'Drop B (B F♯ B E G♯ C♯)',       notes: [35, 42, 47, 52, 56, 61] },
    { id: '7b',     group: '7 cuerdas',        name: '7 cuerdas (B E A D G B E)',     notes: [35, 40, 45, 50, 55, 59, 64] },
    { id: '7a',     group: '7 cuerdas',        name: '7 cuerdas Drop A',              notes: [33, 40, 45, 50, 55, 59, 64] },
    { id: '7as',    group: '7 cuerdas',        name: '7 cuerdas A (A D G C F A D)',   notes: [33, 38, 43, 48, 53, 57, 62] },
    { id: 'bass',   group: 'Bajo',             name: 'Bajo (E A D G)',                notes: [28, 33, 38, 43] },
    { id: 'bassd',  group: 'Bajo',             name: 'Bajo Drop D (D A D G)',         notes: [26, 33, 38, 43] },
    { id: 'chromatic', group: 'Libre',         name: 'Cromático (cualquier nota)',    notes: [] },
  ];

  const tuningSel = $('tuning');
  {
    const groups = {};
    for (const t of TUNINGS) {
      const o = document.createElement('option'); o.value = t.id; o.textContent = t.name;
      if (!t.group) { tuningSel.appendChild(o); continue; }
      if (!groups[t.group]) { groups[t.group] = document.createElement('optgroup'); groups[t.group].label = t.group; tuningSel.appendChild(groups[t.group]); }
      groups[t.group].appendChild(o);
    }
  }
  const savedT = store.get('tuning', 'e');
  tuningSel.value = TUNINGS.some(t => t.id === savedT) ? savedT : 'e';
  let tuning = TUNINGS.find(t => t.id === tuningSel.value);
  let locked = -1; // cuerda fijada; -1 = automático

  function renderStrings() {
    const box = $('strings');
    box.textContent = '';
    $('stringTip').hidden = true;
    if (tuning.notes.length) {
      // AUTO: reconoce cualquier cuerda en cualquier orden. Tocar una cuerda la fija; tocar AUTO la suelta.
      const ab = document.createElement('button');
      ab.className = 'string autoBtn'; ab.id = 'autoBtn'; ab.setAttribute('aria-label', 'Automático');
      const an = document.createElement('span'); an.textContent = 'A';
      const as = document.createElement('small'); as.textContent = 'auto';
      ab.append(an, as);
      ab.addEventListener('click', () => { locked = -1; resetTrack(); markStrings(-1, false); showTarget(locked); });
      box.appendChild(ab);
    }
    tuning.notes.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'string';
      const n = document.createElement('span'); n.textContent = noteName(m);
      const s = document.createElement('small'); s.textContent = (tuning.notes.length - i) + 'ª';
      b.append(n, s);
      let t = 0, long = false;
      b.addEventListener('pointerdown', () => { long = false; t = setTimeout(() => { long = true; playReference(m); }, 450); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => clearTimeout(t)));
      b.addEventListener('click', () => {
        if (long) return;
        // Con ♪ activo: tocar una cuerda la hace sonar y la fija (otro toque la vuelve a sonar)
        if (refMode) { playReference(m); if (locked !== i) { locked = i; resetTrack(); } }
        else { locked = locked === i ? -1 : i; resetTrack(); }
        markStrings(-1, false); showTarget(locked);
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      box.appendChild(b);
    });
    markStrings(-1, false);
    showTarget(locked);
  }
  function showTarget(idx) {
    if (!tuning.notes.length || idx < 0 || !showDiag) { $('target').textContent = ''; return; }
    const m = tuning.notes[idx];
    $('target').textContent = 'Objetivo: ' + noteName(m) + octaveOf(m) + ' · ' + (tuning.notes.length - idx) + 'ª cuerda · ' + midiToFreq(m).toFixed(1) + ' Hz' + (idx === locked ? ' · fijada' : '');
  }
  function markStrings(idx, ok) {
    const kids = [...$('strings').children].filter(k => !k.classList.contains('autoBtn'));
    for (let i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('locked', i === locked);
      kids[i].classList.toggle('auto', locked < 0 && i === idx);
      kids[i].classList.toggle('ok', ok && i === idx);
    }
    const ab = $('autoBtn'); if (ab) ab.classList.toggle('on', locked < 0);
  }
  tuningSel.addEventListener('change', () => {
    tuning = TUNINGS.find(t => t.id === tuningSel.value);
    locked = -1; store.set('tuning', tuning.id); resetTrack(); renderStrings(); setGhostBelow();
  });

  (() => {
    const t = $('ticks');
    for (let c = -50; c <= 50; c += 5) {
      const i = document.createElement('i');
      if (c === 0) i.className = 'c'; else if (Math.abs(c) <= 5) i.className = 'g'; else if (c % 25 === 0) i.className = 'mid';
      t.appendChild(i);
    }
  })();

  // ---------- Ajustes ----------
  // Claridad mínima de la señal (1 = tono puro). Fija: la puerta de ruido adaptativa hace el resto.
  const MIN_CLARITY = 0.5;
  let showDiag = !!store.get('diag', false);
  function setA4(v) { a4 = clamp(v, 415, 466); $('a4').textContent = a4 + ' Hz'; store.set('a4', a4); showTarget(locked); }
  function setDiag(v) { showDiag = v; store.set('diag', v); $('diagChk').checked = v; $('diag').hidden = !v; document.querySelector('.level').hidden = !v; }
  setA4(a4); setDiag(showDiag);
  $('a4down').addEventListener('click', () => setA4(a4 - 1));
  $('a4up').addEventListener('click', () => setA4(a4 + 1));
  $('a4reset').addEventListener('click', () => setA4(440));
  $('diagChk').addEventListener('change', (e) => setDiag(e.target.checked));
  $('calBtn').addEventListener('click', () => $('calDlg').showModal());
  $('calClose').addEventListener('click', () => $('calDlg').close());

  let refMode = !!store.get('refMode', false);
  function setRefMode(v) { refMode = v; store.set('refMode', v); $('refBtn').setAttribute('aria-pressed', String(v)); }
  setRefMode(refMode);
  $('refBtn').addEventListener('click', () => setRefMode(!refMode));

  function playReference(m) {
    const ac = audio();
    if (!stream) setSession('playback');
    const t = ac.currentTime, f = midiToFreq(m);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    g.connect(ac.destination);
    [[1, 1], [2, 0.6], [3, 0.4], [4, 0.25], [5, 0.12]].forEach(([h, a]) => {
      const o = ac.createOscillator(), og = ac.createGain();
      o.frequency.value = f * h; og.gain.value = a;
      o.connect(og).connect(g); o.start(t); o.stop(t + 2.3);
    });
  }

  // ---------- Detección ----------
  let stream = null, source = null, analyser = null, chain = [], buf = null, detect = null, raf = 0, lastRun = 0, micInfo = '';
  // Afinador de guitarra: seguimiento estable + detección de cada púa nueva (suelta la cuerda anterior al instante)
  const guitar = window.Pitch.createGuitar({
    tracker: {
      gateDb: 8, peakMargin: 5, cap: 18,
      // Cambio de cuerda sin ataque claro: solo hacia una nota que sea una cuerda de la afinación
      isString: (f) => !tuning.notes.length || tuning.notes.some(m => Math.abs(1200 * Math.log2(f / midiToFreq(m))) < 60),
    },
    strings: () => tuning.notes.map(midiToFreq),
    locked: () => locked,
  });
  const tracker = guitar.tracker;
  let rate = 48000;
  let lastKey = '', playedKey = '', displayIdx = -1, uiState = 'idle', needle = 0, needleV = 0, needleTarget = 0, lastFresh = 0, t0 = performance.now();

  function resetTrack() { guitar.reset(); lastKey = ''; playedKey = ''; }

  // ---------- Historial (gráfico de los últimos segundos) ----------
  const HIST_S = 6, hist = []; let curCents = null, histCol = null;
  const histCv = $('hist'), histCx = histCv.getContext('2d');
  function histPush(t) { hist.push({ t, c: curCents }); while (hist.length && t - hist[0].t > HIST_S + 0.5) hist.shift(); }
  function histDraw(t) {
    const dpr = window.devicePixelRatio || 1, w = Math.round(histCv.clientWidth * dpr), h = Math.round(histCv.clientHeight * dpr);
    if (!w || !h) return;
    if (histCv.width !== w || histCv.height !== h) { histCv.width = w; histCv.height = h; }
    if (!histCol) { const cs = getComputedStyle(document.documentElement); histCol = ['--green', '--amber', '--red', '--line'].map(v => cs.getPropertyValue(v).trim()); }
    const [G, A, R, L] = histCol, cx = histCx, y = (c) => h / 2 - Math.max(-25, Math.min(25, c)) / 25 * (h / 2 - 4 * dpr);
    cx.clearRect(0, 0, w, h);
    cx.globalAlpha = 0.18; cx.fillStyle = G; cx.fillRect(0, y(3), w, y(-3) - y(3)); cx.globalAlpha = 1;
    cx.fillStyle = L; cx.fillRect(0, Math.round(h / 2) - dpr / 2, w, dpr);
    cx.lineWidth = 3 * dpr; cx.lineCap = 'round'; cx.lineJoin = 'round';
    const x = (p) => w - (t - p.t) / HIST_S * w;
    for (let i = 1; i < hist.length; i++) {
      const a = hist[i - 1], b = hist[i];
      if (a.c == null || b.c == null) continue;
      const m = Math.abs(b.c);
      cx.strokeStyle = m <= 3 ? G : m <= 11 ? A : R;
      cx.beginPath(); cx.moveTo(x(a), y(a.c)); cx.lineTo(x(b), y(b.c)); cx.stroke();
    }
  }
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

  const disp = $('display');
  function setState(st) { if (disp.className !== 'display ' + st) disp.className = 'display ' + st; }
  function setText(id, v) { const el = $(id); if (el.textContent !== v) el.textContent = v; }

  function idle(msg) {
    uiState = 'idle';
    setState('idle');
    setText('note', '–'); setText('octave', '');
    setText('cents', '');
    needleTarget = 0; curCents = null;
    setText('status', msg);
    displayIdx = -1; lastKey = '';
    markStrings(-1, false); showTarget(locked);
  }

  function chooseString(mf) {
    if (locked >= 0) return locked;
    let idx = 0, best = Infinity;
    tuning.notes.forEach((m, i) => {
      // Histéresis: la cuerda que ya se muestra tiene preferencia (evita saltos)
      const dd = Math.abs(mf - m) - (i === displayIdx ? 0.6 : 0);
      if (dd < best) { best = dd; idx = i; }
    });
    return idx;
  }

  // Estado de color/mensaje con histéresis: no parpadea en los bordes
  function nextState(prev, c) {
    const a = Math.abs(c);
    const base = prev.replace(' hold', '');
    if (base === 'ok' && a <= 3.5) return 'ok';
    if (a <= 2) return 'ok';
    const side = c < 0 ? 'flat' : 'sharp';
    const wasNear = base.startsWith('near') || base === 'ok';
    if (a <= 8 || (wasNear && a <= 11)) return 'near ' + side;
    return side;
  }

  // Por debajo de la cuerda más grave (−3 semitonos) un periodo sin fundamental es mezcla de cuerdas, no una nota
  function setGhostBelow() { if (detect) detect.opts.ghostBelow = tuning.notes.length ? midiToFreq(Math.min(...tuning.notes) - 3) : 0; }

  function show(freq, fresh) {
    const mf = freqToMidi(freq);
    let target, idx = -1;
    if (tuning.notes.length) { idx = chooseString(mf); target = tuning.notes[idx]; }
    else {
      const cur = Number(lastKey);
      target = (lastKey !== '' && Math.abs(mf - cur) < 0.65) ? cur : Math.round(mf); // histéresis de nota
    }
    displayIdx = idx;
    lastKey = String(target);
    const c = (mf - target) * 100, ac = Math.abs(c);
    // La nota grande es SIEMPRE la que realmente suena (con histéresis para que no parpadee)
    const pk = Number(playedKey);
    const played = (playedKey !== '' && Math.abs(mf - pk) < 0.65) ? pk : Math.round(mf);
    playedKey = String(played);

    setText('note', noteName(played));
    setText('octave', String(octaveOf(played)));
    const cr = Math.round(c * 10) / 10 || 0;
    setText('cents', showDiag ? (cr > 0 ? '+' : '') + cr.toFixed(1) + ' cents · ' + freq.toFixed(2) + ' Hz' : (Math.round(c) > 0 ? '+' : '') + Math.round(c));
    needleTarget = clamp(c, -50, 50);
    curCents = c;

    const st = nextState(uiState, c);
    // Solo símbolos: ✓ afinada · ▲ subir · ▼ bajar · doble flecha = lejos (con la nota a la que hay que llegar)
    let msg;
    if (st === 'ok') msg = '✓';
    else if (ac >= 60) msg = (c < 0 ? '▲▲ ' : '▼▼ ') + noteName(target) + octaveOf(target);
    else msg = c < 0 ? '▲' : '▼';
    setText('status', msg);
    uiState = st + (fresh ? '' : ' hold');
    setState(uiState);
    markStrings(idx, st === 'ok');
    showTarget(idx);
  }

  // Lectura pensada para guitarra: una cuerda de acero (sobre todo sin enchufar) a veces "suena" más en su
  // 2º, 3º o 4º armónico que en la fundamental, y el detector puede dar ese armónico. Aquí cada lectura se
  // lleva a la cuerda que de verdad está sonando: se prueba la frecuencia tal cual, sus divisiones (armónicos)
  // y el doble (error de octava hacia abajo). Un armónico solo se acepta si cae casi exacto sobre una cuerda.
  // Con una cuerda fijada, lo que no pueda ser esa cuerda (otra cuerda vibrando, ruido) se descarta.
  const FOLD = [[1, 0], [1 / 2, 60], [1 / 3, 90], [1 / 4, 110], [2, 120]];
  function stringPrior(f) {
    const cand = locked >= 0 ? [tuning.notes[locked]] : tuning.notes;
    // 1.ª pasada: armónicos a menos de ~1 semitono. 2.ª (si nada encaja): cuerda muy desafinada, hasta 1,5 semitonos.
    // Una lectura a más de 3 semitonos de toda cuerda no es una cuerda: se descarta (no se muestra una nota absurda).
    for (const hTol of [90, 150]) {
      let best = 0, bd = Infinity;
      for (const [k, pen] of FOLD) {
        const g = f * k;
        for (const m of cand) {
          const d = Math.abs(1200 * Math.log2(g / midiToFreq(m)));
          const max = k === 1 ? (locked >= 0 ? 400 : 300) : hTol;
          if (d <= max && d + pen < bd) { bd = d + pen; best = g; }
        }
      }
      if (best) return best;
    }
    return 0;
  }

  // Aguja con amortiguación tipo resorte (se mueve suave, sin temblar)
  function animateNeedle(dt) {
    const k = 260, d = 2 * Math.sqrt(k); // amortiguación crítica (rápida)
    const acc = k * (needleTarget - needle) - d * needleV;
    needleV += acc * dt; needle += needleV * dt;
    if (Math.abs(needleTarget - needle) < 0.05 && Math.abs(needleV) < 0.05) { needle = needleTarget; needleV = 0; }
    $('needle').style.left = (50 + needle) + '%';
  }

  let lastFrame = 0;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - (lastFrame || ts)) / 1000); lastFrame = ts;
    animateNeedle(dt);
    if (ts - lastRun < 30) return;
    lastRun = ts;
    analyser.getFloatTimeDomainData(buf);
    const r = detect(buf);
    r.level = window.Pitch.bandLevel(buf, rate); // la puerta mira la banda media, donde suena la cuerda
    const db = 20 * Math.log10(r.level + 1e-9);
    $('level').style.width = clamp((db + 90) / 70 * 100, 0, 100) + '%';

    const minClarity = MIN_CLARITY;
    const out = guitar.update(r, (ts - t0) / 1000, minClarity, tuning.notes.length ? stringPrior : null);
    const gateDb = tracker.thresholdDb;
    $('gateMark').style.left = clamp((gateDb + 90) / 70 * 100, 0, 100) + '%';
    $('level').classList.toggle('open', tracker.gateOpen);
    if (out) { show(out.freq, out.fresh); lastFresh = out.fresh; }
    else if (uiState !== 'idle') idle('');
    histPush(ts / 1000); histDraw(ts / 1000);

    if (showDiag) {
      setText('diag', 'entrada ' + db.toFixed(0) + ' dB · fondo ' + tracker.floorDb.toFixed(0) + ' dB · puerta ' + (tracker.gateOpen ? 'abierta' : 'cerrada') + ' · claridad ' + r.clarity.toFixed(2) +
        ' · ' + (r.freq > 0 ? r.freq.toFixed(1) + ' Hz' : '—') + (out && out.fresh ? ' ✓' : '') + '\n' + micInfo);
    }
  }

  async function startMic() {
    stopMetro();
    setSession('play-and-record');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false, noiseSuppression: false,
          autoGainControl: false, // ganancia fija: la puerta de ruido necesita niveles estables
          channelCount: 1,
        },
        video: false,
      });
    } catch {
      stream = null;
      idle('Sin permiso de micrófono. Actívalo en los ajustes del navegador.');
      setSession('playback');
      return;
    }
    // Importante en iPhone: si el contexto de audio se creó antes del micrófono, puede quedarse con otra
    // frecuencia de muestreo (44,1 vs 48 kHz) y todas las notas se leen ~1,5 semitonos más bajas.
    // Por eso se crea un contexto nuevo ahora, a la frecuencia real del micrófono.
    const trackSettings = (() => { try { return stream.getAudioTracks()[0].getSettings() || {}; } catch { return {}; } })();
    const ac = await freshContext(trackSettings.sampleRate);
    source = ac.createMediaStreamSource(stream);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.7;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000; lp.Q.value = 0.7;
    analyser = ac.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0;
    source.connect(hp).connect(lp).connect(analyser); // no va a los altavoces; no se guarda nada
    chain = [hp, lp];
    buf = new Float32Array(analyser.fftSize);
    rate = ac.sampleRate;
    detect = window.Pitch.createDetector(analyser.fftSize, ac.sampleRate, { minF: 30, maxF: 1500 });
    setGhostBelow();
    try {
      const s = trackSettings;
      micInfo = 'audio ' + (ac.sampleRate / 1000).toFixed(1) + ' kHz · mic ' + (s.sampleRate ? (s.sampleRate / 1000).toFixed(1) + ' kHz' : '?') + ' · AGC ' + (s.autoGainControl ? 'sí' : 'no') + ' · NS ' + (s.noiseSuppression ? 'sí' : 'no') + ' · EC ' + (s.echoCancellation ? 'sí' : 'no');
    } catch { micInfo = (ac.sampleRate / 1000).toFixed(1) + ' kHz'; }
    resetTrack();
    $('micBtn').textContent = 'Pausar micrófono';
    $('micBtn').classList.add('on');
    idle('');
    keepAwake(true);
    raf = requestAnimationFrame(loop);
  }

  function stopMic() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (source) source.disconnect();
    chain.forEach(n => n.disconnect());
    stream = source = analyser = null; chain = [];
    resetTrack();
    $('micBtn').textContent = 'Empezar a afinar';
    $('micBtn').classList.remove('on');
    $('level').style.width = '0';
    idle('Micrófono en pausa');
    setSession('playback');
    keepAwake(playing);
  }
  $('micBtn').addEventListener('click', () => (stream ? stopMic() : startMic()));

  // ================= METRÓNOMO =================
  let bpm = clamp(Number(store.get('bpm', 120)) || 120, 30, 300);
  let subdiv = [1, 2, 3, 4].includes(store.get('subdiv', 1)) ? store.get('subdiv', 1) : 1;
  let sound = ['beep', 'clic', 'madera'].includes(store.get('sound', 'clic')) ? store.get('sound', 'clic') : 'clic';
  let vol = clamp(Number(store.get('vol', 100)), 0, 100);
  let pattern = store.get('pattern', [2, 1, 1, 1]); // 2 = acento, 1 = pulso, 0 = silencio
  if (!Array.isArray(pattern) || !pattern.length || pattern.length > 12) pattern = [2, 1, 1, 1];
  let playing = false, nextTime = 0, step = 0, timer = 0, drawRaf = 0;
  const queue = [];

  // Sonidos limpios (sin saturación): senos con ataque suave y caída exponencial.
  // Frecuencias de 1,5–3 kHz: donde el altavoz del móvil y el oído rinden más.
  function render(kind, level) {
    const sr = ctx.sampleRate, key = kind + level;
    if (buffers[key]) return buffers[key];
    const P = {
      clic:   { f: [2600, 2000, 1500], parts: [[1, 1], [2.02, 0.25]], tau: 0.007, dur: 0.05 },
      beep:   { f: [1760, 1320, 990],  parts: [[1, 1]],               tau: 0.03,  dur: 0.09 },
      madera: { f: [1400, 1050, 800],  parts: [[1, 1], [2.76, 0.35]], tau: 0.014, dur: 0.07 },
    }[kind];
    const f = P.f[level === 2 ? 0 : level === 1 ? 1 : 2];
    const n = Math.floor(sr * P.dur), b = ctx.createBuffer(1, n, sr), x = b.getChannelData(0);
    const attack = sr * 0.0015;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (const [r, a] of P.parts) v += a * Math.sin(2 * Math.PI * f * r * t);
      const env = Math.min(1, i / attack) * Math.exp(-t / P.tau) * Math.min(1, (n - i) / (sr * 0.003));
      x[i] = v * env;
    }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
    const target = level === 2 ? 0.95 : level === 1 ? 0.75 : 0.4; // acento > pulso > subdivisión
    for (let i = 0; i < n; i++) x[i] *= target / (peak || 1);
    return (buffers[key] = b);
  }

  function ensureMaster() {
    if (master) return;
    master = ctx.createGain();
    master.connect(ctx.destination);
    setVol(vol);
  }
  function setVol(v) {
    vol = v; store.set('vol', v); $('vol').value = String(v);
    if (master) master.gain.value = Math.pow(v / 100, 1.5); // máximo 1.0: nunca satura
  }

  function click(time, level) {
    const s = ctx.createBufferSource();
    s.buffer = render(sound, level);
    s.connect(master); s.start(time);
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + 0.12) {
      const n = pattern.length, s = step % (n * subdiv);
      const isBeat = s % subdiv === 0, bi = Math.floor(s / subdiv);
      const st = pattern[bi];
      if (st > 0) click(nextTime, isBeat ? st : 3);
      if (isBeat) queue.push({ time: nextTime, beat: bi });
      nextTime += 60 / bpm / subdiv;
      step++;
    }
  }

  function draw() {
    drawRaf = requestAnimationFrame(draw);
    let cur = null;
    while (queue.length && queue[0].time <= ctx.currentTime) cur = queue.shift();
    if (!cur) return;
    const dots = $('beats').children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('lit', i === cur.beat);
    if (pattern[cur.beat] === 2) { const v = $('metro'); v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash'); }
  }

  function renderBeats() {
    const box = $('beats');
    box.textContent = '';
    pattern.forEach((st, i) => {
      const b = document.createElement('button');
      b.className = 'beat s' + st;
      b.setAttribute('aria-label', 'Tiempo ' + (i + 1));
      b.addEventListener('click', () => {
        pattern[i] = pattern[i] === 2 ? 1 : pattern[i] === 1 ? 0 : 2;
        b.className = 'beat s' + pattern[i];
        store.set('pattern', pattern);
      });
      box.appendChild(b);
    });
    $('beatsOut').textContent = String(pattern.length);
  }
  function setBeats(n) {
    n = clamp(n, 1, 12);
    while (pattern.length < n) pattern.push(1);
    pattern.length = n;
    store.set('pattern', pattern); renderBeats();
  }

  const TEMPI = [[40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'], [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto'], [999, 'Prestissimo']];
  function setBpm(v) {
    bpm = Math.round(clamp(v, 30, 300));
    $('bpm').textContent = String(bpm); $('bpmRange').value = String(bpm);
    $('tempoName').textContent = 'BPM · ' + TEMPI.find(([m]) => bpm < m)[1];
    store.set('bpm', bpm);
  }

  function startMetro() {
    if (stream) stopMic();
    setSession('playback');
    try { const u = $('unlock'); u.volume = 0.01; const p = u.play(); if (p) p.catch(() => {}); } catch { /* nada */ }
    audio(); ensureMaster();
    playing = true; step = 0; queue.length = 0;
    nextTime = ctx.currentTime + 0.08;
    scheduler();
    timer = setInterval(scheduler, 25);
    drawRaf = requestAnimationFrame(draw);
    $('playBtn').textContent = 'Detener'; $('playBtn').classList.add('on');
    keepAwake(true);
  }
  function stopMetro() {
    if (!playing) return;
    playing = false;
    clearInterval(timer); cancelAnimationFrame(drawRaf);
    try { $('unlock').pause(); } catch { /* nada */ }
    for (const d of $('beats').children) d.classList.remove('lit');
    $('playBtn').textContent = 'Iniciar'; $('playBtn').classList.remove('on');
    keepAwake(!!stream);
  }
  $('playBtn').addEventListener('click', () => (playing ? stopMetro() : startMetro()));

  function hold(el, fn) {
    let t1 = 0, t2 = 0;
    const end = () => { clearTimeout(t1); clearInterval(t2); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); t1 = setTimeout(() => { t2 = setInterval(fn, 60); }, 400); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, end));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  hold($('bpmDown'), () => setBpm(bpm - 1));
  hold($('bpmUp'), () => setBpm(bpm + 1));
  $('beatsDown').addEventListener('click', () => setBeats(pattern.length - 1));
  $('beatsUp').addEventListener('click', () => setBeats(pattern.length + 1));
  $('bpmRange').addEventListener('input', (e) => setBpm(Number(e.target.value)));
  $('subdiv').value = String(subdiv);
  $('subdiv').addEventListener('change', (e) => { subdiv = Number(e.target.value); store.set('subdiv', subdiv); step = 0; });
  $('sound').value = sound;
  $('sound').addEventListener('change', (e) => { sound = e.target.value; store.set('sound', sound); });
  $('vol').addEventListener('input', (e) => setVol(Number(e.target.value)));

  const taps = [];
  $('tapBtn').addEventListener('pointerdown', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now); if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      let sum = 0; for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
      setBpm(60000 / (sum / (taps.length - 1)));
    }
  });

  setBpm(bpm); setVol(vol); renderBeats();
  renderStrings();

  // ================= ESCALAS =================
  function tone(ac, f, t, dur, vol) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(ac.destination);
    [[1, 1], [2, 0.45], [3, 0.25], [4, 0.1]].forEach(([h, a]) => {
      const o = ac.createOscillator(), og = ac.createGain();
      o.frequency.value = f * h; og.gain.value = a; o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.05);
    });
  }
  const pcFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12); // escalas siempre a 440
  const scalesUI = window.Escalas.init({
    store,
    getStrings: () => (tuning.notes.length ? tuning.notes : [40, 45, 50, 55, 59, 64]),
    play: (midis) => { setSession('playback'); const ac = audio(); let t = ac.currentTime + 0.05; for (const m of midis) { tone(ac, pcFreq(m), t, 0.9, 0.3); t += 0.32; } },
    playChords: (chords) => {
      setSession('playback'); const ac = audio(); let t = ac.currentTime + 0.05;
      for (const pcs of chords) { for (const pc of pcs) tone(ac, pcFreq(48 + pc), t, 1.1, 0.12); tone(ac, pcFreq(36 + (pcs[0] % 12)), t, 1.1, 0.14); t += 0.9; }
    },
  });
  $('scPlay').addEventListener('click', () => {
    const notes = [...document.querySelectorAll('#scNotes .scNote b')].map(b => b.textContent);
    const PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const pcOf = (n) => (PCS[n[0]] + (n.includes('♯') ? 1 : 0) - (n.includes('♭') ? 1 : 0) + (n.includes('𝄪') ? 2 : 0) - (n.includes('𝄫') ? 2 : 0) + 12) % 12;
    const root = pcOf(notes[0]); const ms = notes.map(n => { const pc = pcOf(n); return 48 + root + ((pc - root + 12) % 12); });
    ms.push(60 + root);
    if (stream) stopMic();
    const ac = audio(); let t = ac.currentTime + 0.05; setSession('playback');
    for (const m of ms) { tone(ac, pcFreq(m), t, 0.5, 0.3); t += 0.28; }
  });
  tuningSel.addEventListener('change', () => scalesUI.refresh());
  idle('Toca «Empezar a afinar»');

  // Si el permiso del micrófono ya está concedido, empezar a escuchar directamente
  try {
    navigator.permissions.query({ name: 'microphone' }).then((p) => { if (p.state === 'granted' && !stream) startMic(); }).catch(() => {});
  } catch { /* no soportado */ }

  // ================= Pestañas y ciclo de vida =================
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === tab.dataset.view));
    if (tab.dataset.view !== 'tuner' && stream) stopMic();
  }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && stream) stopMic();
    if (document.visibilityState === 'visible' && (stream || playing)) keepAwake(true);
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !stream && !playing) { reloaded = true; location.reload(); }
    });
  }
})();
