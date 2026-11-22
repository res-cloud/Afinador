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
  const noteName = (m) => NAMES[((m % 12) + 12) % 12];
  const octaveOf = (m) => Math.floor(m / 12) - 1;

  const TUNINGS = [
    { id: 'e',      group: '',                 name: 'Estándar (E A D G B E)',        notes: [40, 45, 50, 55, 59, 64] },
    { id: 'dropd',  group: 'Variaciones',      name: 'Drop D (D A D G B E)',          notes: [38, 45, 50, 55, 59, 64] },
    { id: 'eb',     group: 'Variaciones',      name: 'E♭ (medio tono abajo)',          notes: [39, 44, 49, 54, 58, 63] },
    { id: 'dropcs', group: 'Variaciones',      name: 'Drop C♯ (C♯ G♯ C♯ F♯ A♯ D♯)',   notes: [37, 44, 49, 54, 58, 63] },
    { id: 'd',      group: 'Variaciones',      name: 'D estándar (D G C F A D)',      notes: [38, 43, 48, 53, 57, 62] },
    { id: 'dropc',  group: 'Variaciones',      name: 'Drop C (C G C F A D)',          notes: [36, 43, 48, 53, 57, 62] },
    { id: 'c',      group: 'Variaciones',      name: 'C estándar (C F A♯ D♯ G C)',    notes: [36, 41, 46, 51, 55, 60] },
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
    $('stringTip').hidden = tuning.notes.length === 0;
    tuning.notes.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'string';
      const n = document.createElement('span'); n.textContent = noteName(m);
      const s = document.createElement('small'); s.textContent = (tuning.notes.length - i) + 'ª';
      b.append(n, s);
      let t = 0, long = false;
      b.addEventListener('pointerdown', () => { long = false; t = setTimeout(() => { long = true; playReference(m); }, 450); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => clearTimeout(t)));
      b.addEventListener('click', () => { if (long) return; locked = locked === i ? -1 : i; resetTrack(); markStrings(-1, false); showTarget(locked); });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      box.appendChild(b);
    });
    markStrings(-1, false);
    showTarget(locked);
  }
  function showTarget(idx) {
    if (!tuning.notes.length) { $('target').textContent = 'Modo cromático'; return; }
    if (idx < 0) { $('target').textContent = 'Toca cualquier cuerda'; return; }
    const m = tuning.notes[idx];
    $('target').textContent = (tuning.notes.length - idx) + 'ª cuerda · ' + midiToFreq(m).toFixed(1) + ' Hz' + (idx === locked ? ' · fijada' : '');
  }
  function markStrings(idx, ok) {
    const kids = $('strings').children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('locked', i === locked);
      kids[i].classList.toggle('auto', locked < 0 && i === idx);
      kids[i].classList.toggle('ok', ok && i === idx);
    }
  }
  tuningSel.addEventListener('change', () => {
    tuning = TUNINGS.find(t => t.id === tuningSel.value);
    locked = -1; store.set('tuning', tuning.id); resetTrack(); renderStrings();
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
  // clarity: cuán periódica debe ser la señal (1 = tono puro). Más bajo = más sensible.
  const SENS = { normal: 0.7, alta: 0.55, max: 0.45 };
  let sens = SENS[store.get('sens', 'alta')] ? store.get('sens', 'alta') : 'alta';
  let showDiag = !!store.get('diag', false);
  function setA4(v) { a4 = clamp(v, 415, 466); $('a4').textContent = a4 + ' Hz'; store.set('a4', a4); showTarget(locked); }
  function setSens(v) { sens = v; store.set('sens', v); for (const b of $('sensSeg').children) b.classList.toggle('on', b.dataset.v === v); }
  function setDiag(v) { showDiag = v; store.set('diag', v); $('diagChk').checked = v; $('diag').hidden = !v; }
  setA4(a4); setSens(sens); setDiag(showDiag);
  $('a4down').addEventListener('click', () => setA4(a4 - 1));
  $('a4up').addEventListener('click', () => setA4(a4 + 1));
  $('a4reset').addEventListener('click', () => setA4(440));
  for (const b of $('sensSeg').children) b.addEventListener('click', () => setSens(b.dataset.v));
  $('diagChk').addEventListener('change', (e) => setDiag(e.target.checked));
  $('calBtn').addEventListener('click', () => $('calDlg').showModal());
  $('calClose').addEventListener('click', () => $('calDlg').close());

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
  const tracker = window.Pitch.createTracker();
  let lastKey = '', displayIdx = -1, uiState = 'idle', needle = 0, needleV = 0, needleTarget = 0, lastFresh = 0, t0 = performance.now();

  function resetTrack() { tracker.reset(); lastKey = ''; }
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

  const disp = $('display');
  function setState(st) { if (disp.className !== 'display ' + st) disp.className = 'display ' + st; }
  function setText(id, v) { const el = $(id); if (el.textContent !== v) el.textContent = v; }

  function idle(msg) {
    uiState = 'idle';
    setState('idle');
    setText('note', '–'); setText('octave', '');
    setText('cents', '');
    needleTarget = 0;
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

    setText('note', noteName(target));
    setText('octave', String(octaveOf(target)));
    const cr = Math.round(c * 10) / 10 || 0;
    setText('cents', (cr > 0 ? '+' : '') + cr.toFixed(1) + ' cents · ' + freq.toFixed(2) + ' Hz');
    needleTarget = clamp(c, -50, 50);

    const st = nextState(uiState, c);
    if (st !== uiState.replace(' hold', '') || !uiState) {
      let msg;
      if (st === 'ok') msg = '✓ Afinada';
      else if (ac >= 60) {
        const flat = c < 0, semis = Math.round(ac / 100), m = Math.round(mf);
        msg = (flat ? '▲ Sube ' : '▼ Baja ') + (semis >= 1 ? semis + (semis === 1 ? ' semitono' : ' semitonos') : 'un poco') + ' (suena ' + noteName(m) + octaveOf(m) + ')';
        if (!flat) msg = '⚠ ' + msg + ': ¡no subas más!';
      } else msg = c < 0 ? '▲ Sube: aprieta la clavija' : '▼ Baja: afloja la clavija';
      setText('status', msg);
    } else if (ac >= 60) {
      // el número de semitonos puede cambiar sin cambiar de estado
      const flat = c < 0, semis = Math.round(ac / 100), m = Math.round(mf);
      let msg = (flat ? '▲ Sube ' : '▼ Baja ') + (semis >= 1 ? semis + (semis === 1 ? ' semitono' : ' semitonos') : 'un poco') + ' (suena ' + noteName(m) + octaveOf(m) + ')';
      if (!flat) msg = '⚠ ' + msg + ': ¡no subas más!';
      setText('status', msg);
    }
    uiState = st + (fresh ? '' : ' hold');
    setState(uiState);
    markStrings(idx, st === 'ok');
    showTarget(idx);
  }

  // Aguja con amortiguación tipo resorte (se mueve suave, sin temblar)
  function animateNeedle(dt) {
    const k = 120, d = 2 * Math.sqrt(k); // amortiguación crítica
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
    const db = 20 * Math.log10(r.rms + 1e-9);
    $('level').style.width = clamp((db + 90) / 70 * 100, 0, 100) + '%';

    const minClarity = SENS[sens];
    const out = tracker.update(r, (ts - t0) / 1000, minClarity);
    if (out) { show(out.freq, out.fresh); lastFresh = out.fresh; }
    else if (uiState !== 'idle') idle('Toca una cuerda…');

    if (showDiag) {
      setText('diag', 'entrada ' + db.toFixed(0) + ' dB · claridad ' + r.clarity.toFixed(2) + ' (mín ' + minClarity + ')' +
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
          autoGainControl: true, // la ganancia automática sube la señal débil; no altera la afinación
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
    detect = window.Pitch.createDetector(analyser.fftSize, ac.sampleRate, { minF: 30, maxF: 1500 });
    try {
      const s = trackSettings;
      micInfo = 'audio ' + (ac.sampleRate / 1000).toFixed(1) + ' kHz · mic ' + (s.sampleRate ? (s.sampleRate / 1000).toFixed(1) + ' kHz' : '?') + ' · AGC ' + (s.autoGainControl ? 'sí' : 'no') + ' · NS ' + (s.noiseSuppression ? 'sí' : 'no') + ' · EC ' + (s.echoCancellation ? 'sí' : 'no');
    } catch { micInfo = (ac.sampleRate / 1000).toFixed(1) + ' kHz'; }
    resetTrack();
    $('micBtn').textContent = 'Pausar micrófono';
    $('micBtn').classList.add('on');
    idle('Toca una cuerda…');
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
