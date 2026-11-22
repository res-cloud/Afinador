/* Afinador cromático + metrónomo — v1
 * Todo corre en el dispositivo: sin red, sin cuentas, sin analítica.
 * El audio del micrófono se analiza en memoria y se descarta; nunca se graba.
 */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- Ajustes (solo preferencias, nada personal) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('afinador.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('afinador.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento: no pasa nada */ } },
  };

  // ---------- Notas ----------
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const ES = { 'C': 'Do', 'D': 'Re', 'E': 'Mi', 'F': 'Fa', 'G': 'Sol', 'A': 'La', 'B': 'Si' };
  let a4 = clamp(store.get('a4', 440), 415, 466);
  const midiToFreq = (m) => a4 * Math.pow(2, (m - 69) / 12);
  const freqToMidi = (f) => 69 + 12 * Math.log2(f / a4);
  const noteName = (m) => NAMES[((m % 12) + 12) % 12];
  const octaveOf = (m) => Math.floor(m / 12) - 1;
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // Afinaciones (de grave a aguda, en números MIDI)
  const TUNINGS = [
    { id: 'chromatic', name: 'Cromático libre', notes: [] },
    { id: 'e',     name: 'Estándar (E A D G B E)',          notes: [40, 45, 50, 55, 59, 64] },
    { id: 'dropd', name: 'Drop D (D A D G B E)',            notes: [38, 45, 50, 55, 59, 64] },
    { id: 'eb',    name: 'Medio tono abajo (E♭)',            notes: [39, 44, 49, 54, 58, 63] },
    { id: 'dropcs',name: 'Drop C♯ (C♯ G♯ C♯ F♯ A♯ D♯)',    notes: [37, 44, 49, 54, 58, 63] },
    { id: 'd',     name: 'D estándar (D G C F A D)',        notes: [38, 43, 48, 53, 57, 62] },
    { id: 'dropc', name: 'Drop C (C G C F A D)',            notes: [36, 43, 48, 53, 57, 62] },
    { id: 'c',     name: 'C estándar (C F A♯ D♯ G C)',      notes: [36, 41, 46, 51, 55, 60] },
    { id: 'dropb', name: 'Drop B (B F♯ B E G♯ C♯)',         notes: [35, 42, 47, 52, 56, 61] },
    { id: '7b',    name: '7 cuerdas (B E A D G B E)',       notes: [35, 40, 45, 50, 55, 59, 64] },
    { id: '7a',    name: '7 cuerdas Drop A (A E A D G B E)',notes: [33, 40, 45, 50, 55, 59, 64] },
    { id: '7as',   name: '7 cuerdas A estándar (A D G C F A D)', notes: [33, 38, 43, 48, 53, 57, 62] },
    { id: 'bass',  name: 'Bajo 4 cuerdas (E A D G)',        notes: [28, 33, 38, 43] },
    { id: 'bassd', name: 'Bajo Drop D (D A D G)',           notes: [26, 33, 38, 43] },
  ];

  // ================= AFINADOR =================
  const tuningSel = $('tuning');
  for (const t of TUNINGS) {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    tuningSel.appendChild(o);
  }
  tuningSel.value = TUNINGS.some(t => t.id === store.get('tuning', 'e')) ? store.get('tuning', 'e') : 'e';
  let tuning = TUNINGS.find(t => t.id === tuningSel.value);

  function renderStrings() {
    const box = $('strings');
    box.textContent = '';
    tuning.notes.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'string';
      b.dataset.midi = String(m);
      b.title = 'Escuchar nota de referencia';
      const n = document.createElement('span');
      n.textContent = noteName(m);
      const s = document.createElement('small');
      s.textContent = (tuning.notes.length - i) + 'ª';
      b.append(n, s);
      b.addEventListener('click', () => playReference(m));
      box.appendChild(b);
    });
  }
  renderStrings();
  tuningSel.addEventListener('change', () => {
    tuning = TUNINGS.find(t => t.id === tuningSel.value);
    store.set('tuning', tuning.id);
    renderStrings();
  });

  function setA4(v) { a4 = clamp(v, 415, 466); $('a4').textContent = String(a4); store.set('a4', a4); }
  setA4(a4);
  $('a4down').addEventListener('click', () => setA4(a4 - 1));
  $('a4up').addEventListener('click', () => setA4(a4 + 1));

  // ---------- Audio compartido ----------
  let ctx = null;
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playReference(m) {
    const ac = audio();
    const t = ac.currentTime;
    const f = midiToFreq(m);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    g.connect(ac.destination);
    // Fundamental + armónicos para que se oiga incluso en altavoces de teléfono
    [[1, 1], [2, 0.5], [3, 0.3], [4, 0.15]].forEach(([h, a]) => {
      const o = ac.createOscillator();
      const og = ac.createGain();
      o.type = 'sine'; o.frequency.value = f * h; og.gain.value = a;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + 2.3);
    });
  }

  // ---------- Detección de tono (YIN) ----------
  const MIN_F = 35, MAX_F = 1400;
  let stream = null, analyser = null, source = null, buf = null, yinBuf = null, raf = 0, lastRun = 0;
  const history = [];
  let smoothCents = 0, lastHeard = 0, wakeLock = null;

  function yin(x, sr) {
    const W = x.length >> 1;
    const tauMin = Math.max(2, Math.floor(sr / MAX_F));
    const tauMax = Math.min(W - 1, Math.ceil(sr / MIN_F));
    const d = yinBuf;
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const v = x[j] - x[j + tau]; s += v * v; }
      running += s;
      d[tau] = running > 0 ? s * tau / running : 1;
    }
    const TH = 0.12;
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < TH) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t; break;
      }
    }
    if (tau < 0) {
      // Sin cruce del umbral: usar el mínimo global si es razonablemente claro
      let best = tauMin;
      for (let t = tauMin; t <= tauMax; t++) if (d[t] < d[best]) best = t;
      if (d[best] > 0.25) return -1;
      tau = best;
    }
    // Interpolación parabólica
    let betterTau = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a + c - 2 * b;
      if (den !== 0) betterTau = tau + (a - c) / (2 * den);
    }
    return sr / betterTau;
  }

  function median(arr) { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1]; }

  const meterEl = document.querySelector('.meter');
  function show(freq) {
    if (freq <= 0) {
      if (performance.now() - lastHeard > 1200) {
        meterEl.classList.remove('in-tune', 'close', 'off');
        $('needle').style.opacity = '.25';
        $('hint').textContent = 'Toca una cuerda…';
        highlight(null);
      }
      return;
    }
    lastHeard = performance.now();
    const midiF = freqToMidi(freq);
    const midi = Math.round(midiF);
    const cents = (midiF - midi) * 100;
    // Suavizado; se reinicia si cambia de nota
    if (show.lastMidi !== midi) smoothCents = cents; else smoothCents += (cents - smoothCents) * 0.35;
    show.lastMidi = midi;
    const c = smoothCents;

    $('note').textContent = noteName(midi);
    $('octave').textContent = String(octaveOf(midi));
    const cr = Math.round(c) || 0;
    $('cents').textContent = (cr > 0 ? '+' : '') + cr + ' ¢';
    $('freq').textContent = freq.toFixed(1) + ' Hz';
    const n = $('needle');
    n.style.opacity = '1';
    n.style.left = (50 + clamp(c, -50, 50)) + '%';
    const ac = Math.abs(c);
    meterEl.classList.toggle('in-tune', ac <= 3);
    meterEl.classList.toggle('close', ac > 3 && ac <= 12);
    meterEl.classList.toggle('off', ac > 12);
    $('hint').textContent = ac <= 3 ? 'Afinada' : c < 0 ? 'Sube (aprieta)' : 'Baja (afloja)';
    highlight(midi);
  }

  function highlight(midi) {
    for (const b of $('strings').children) b.classList.toggle('active', midi !== null && Number(b.dataset.midi) === midi);
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (ts - lastRun < 40) return; // ~25 análisis por segundo
    lastRun = ts;
    analyser.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    let f = -1;
    if (rms > 0.006) f = yin(buf, ctx.sampleRate);
    if (f > MIN_F && f < MAX_F) {
      history.push(f);
      if (history.length > 5) history.shift();
      show(median(history));
    } else {
      history.length = 0;
      show(-1);
    }
  }

  async function startMic() {
    const ac = audio();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    } catch (e) {
      $('hint').textContent = 'Sin permiso de micrófono. Actívalo en los ajustes del navegador.';
      return;
    }
    source = ac.createMediaStreamSource(stream);
    analyser = ac.createAnalyser();
    analyser.fftSize = 4096;
    source.connect(analyser); // no se conecta a la salida: nada se reproduce ni se guarda
    buf = new Float32Array(analyser.fftSize);
    yinBuf = new Float32Array(analyser.fftSize >> 1);
    $('micBtn').textContent = 'Detener micrófono';
    $('micBtn').classList.add('on');
    $('hint').textContent = 'Toca una cuerda…';
    keepAwake(true);
    raf = requestAnimationFrame(loop);
  }

  function stopMic() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (source) source.disconnect();
    stream = source = analyser = null;
    history.length = 0;
    $('micBtn').textContent = 'Activar micrófono';
    $('micBtn').classList.remove('on');
    $('hint').textContent = 'Micrófono apagado';
    meterEl.classList.remove('in-tune', 'close', 'off');
    $('needle').style.opacity = '.25';
    highlight(null);
    keepAwake(playing);
  }

  $('micBtn').addEventListener('click', () => (stream ? stopMic() : startMic()));

  // Mantener la pantalla encendida mientras se usa
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { /* no soportado */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (stream || playing)) keepAwake(true);
    // Al salir de la app se apaga el micrófono
    if (document.visibilityState === 'hidden' && stream) stopMic();
  });

  // ================= METRÓNOMO =================
  let bpm = clamp(store.get('bpm', 120), 30, 300);
  let beatsPerBar = store.get('meter', 4);
  let subdiv = store.get('subdiv', 1);
  let playing = false, nextTime = 0, step = 0, timer = 0, drawRaf = 0;
  const queue = [];

  $('meterSel').value = String(beatsPerBar);
  $('subdiv').value = String(subdiv);

  function setBpm(v) {
    bpm = Math.round(clamp(v, 30, 300));
    $('bpm').textContent = String(bpm);
    $('bpmRange').value = String(bpm);
    store.set('bpm', bpm);
  }
  setBpm(bpm);

  function renderBeats() {
    const box = $('beats');
    box.textContent = '';
    const n = beatsPerBar === 1 ? 4 : beatsPerBar;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'beat' + (i === 0 && beatsPerBar !== 1 ? ' accent' : '');
      box.appendChild(d);
    }
  }
  renderBeats();

  function click(time, kind) {
    const ac = ctx;
    const o = ac.createOscillator();
    const g = ac.createGain();
    const f = kind === 'accent' ? 1760 : kind === 'beat' ? 1100 : 800;
    const vol = kind === 'accent' ? 0.9 : kind === 'beat' ? 0.6 : 0.3;
    o.type = 'square';
    o.frequency.setValueAtTime(f, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    o.connect(g).connect(ac.destination);
    o.start(time); o.stop(time + 0.05);
  }

  function scheduler() {
    const ahead = 0.12;
    while (nextTime < ctx.currentTime + ahead) {
      const beatsShown = beatsPerBar === 1 ? 4 : beatsPerBar;
      const stepsPerBar = beatsShown * subdiv;
      const s = step % stepsPerBar;
      const isBeat = s % subdiv === 0;
      const beatIdx = Math.floor(s / subdiv);
      const kind = !isBeat ? 'sub' : (beatIdx === 0 && beatsPerBar !== 1) ? 'accent' : 'beat';
      click(nextTime, kind);
      if (isBeat) queue.push({ time: nextTime, beat: beatIdx });
      nextTime += 60 / bpm / subdiv;
      step++;
    }
  }

  function draw() {
    drawRaf = requestAnimationFrame(draw);
    let cur = null;
    while (queue.length && queue[0].time <= ctx.currentTime) cur = queue.shift();
    if (cur) {
      const dots = $('beats').children;
      for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('lit', i === cur.beat);
      setTimeout(() => { if (dots[cur.beat]) dots[cur.beat].classList.remove('lit'); }, Math.min(120, 30000 / bpm));
    }
  }

  function start() {
    audio();
    playing = true;
    step = 0; queue.length = 0;
    nextTime = ctx.currentTime + 0.06;
    scheduler();
    timer = setInterval(scheduler, 25);
    drawRaf = requestAnimationFrame(draw);
    $('playBtn').textContent = 'Detener';
    $('playBtn').classList.add('on');
    keepAwake(true);
  }
  function stop() {
    playing = false;
    clearInterval(timer); cancelAnimationFrame(drawRaf);
    for (const d of $('beats').children) d.classList.remove('lit');
    $('playBtn').textContent = 'Iniciar';
    $('playBtn').classList.remove('on');
    keepAwake(!!stream);
  }
  $('playBtn').addEventListener('click', () => (playing ? stop() : start()));

  // Mantener pulsado +/− acelera
  function holdButton(el, delta) {
    let t1 = 0, t2 = 0;
    const end = () => { clearTimeout(t1); clearInterval(t2); };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setBpm(bpm + delta);
      t1 = setTimeout(() => { t2 = setInterval(() => setBpm(bpm + delta), 60); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, end));
  }
  holdButton($('bpmDown'), -1);
  holdButton($('bpmUp'), 1);
  $('bpmRange').addEventListener('input', (e) => setBpm(Number(e.target.value)));

  $('meterSel').addEventListener('change', (e) => {
    beatsPerBar = Number(e.target.value); store.set('meter', beatsPerBar); renderBeats(); step = 0;
  });
  $('subdiv').addEventListener('change', (e) => {
    subdiv = Number(e.target.value); store.set('subdiv', subdiv); step = 0;
  });

  // Tap tempo
  const taps = [];
  $('tapBtn').addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      setBpm(60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length));
    }
  });

  // ================= Pestañas =================
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === tab.dataset.view));
  }));

  // ================= Offline =================
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
