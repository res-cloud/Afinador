/* Afinador cromático + metrónomo — v2
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
  let ctx = null;
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }
  // iOS: 'playback' suena por el altavoz a todo volumen e ignora el interruptor de silencio;
  // 'play-and-record' es necesario para el micrófono.
  function setSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* no soportado */ } }

  // Mantener la pantalla encendida
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
    { id: 'chromatic', name: 'Cromático', notes: [] },
    { id: 'e',      name: 'Estándar · E A D G B E',        notes: [40, 45, 50, 55, 59, 64] },
    { id: 'dropd',  name: 'Drop D · D A D G B E',          notes: [38, 45, 50, 55, 59, 64] },
    { id: 'eb',     name: 'E♭ · medio tono abajo',          notes: [39, 44, 49, 54, 58, 63] },
    { id: 'dropcs', name: 'Drop C♯ · C♯ G♯ C♯ F♯ A♯ D♯',   notes: [37, 44, 49, 54, 58, 63] },
    { id: 'd',      name: 'D estándar · D G C F A D',      notes: [38, 43, 48, 53, 57, 62] },
    { id: 'dropc',  name: 'Drop C · C G C F A D',          notes: [36, 43, 48, 53, 57, 62] },
    { id: 'c',      name: 'C estándar · C F A♯ D♯ G C',    notes: [36, 41, 46, 51, 55, 60] },
    { id: 'dropb',  name: 'Drop B · B F♯ B E G♯ C♯',       notes: [35, 42, 47, 52, 56, 61] },
    { id: '7b',     name: '7 cuerdas · B E A D G B E',     notes: [35, 40, 45, 50, 55, 59, 64] },
    { id: '7a',     name: '7 cuerdas Drop A · A E A D G B E', notes: [33, 40, 45, 50, 55, 59, 64] },
    { id: '7as',    name: '7 cuerdas A · A D G C F A D',   notes: [33, 38, 43, 48, 53, 57, 62] },
    { id: 'bass',   name: 'Bajo · E A D G',                notes: [28, 33, 38, 43] },
    { id: 'bassd',  name: 'Bajo Drop D · D A D G',         notes: [26, 33, 38, 43] },
  ];

  const tuningSel = $('tuning');
  for (const t of TUNINGS) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; tuningSel.appendChild(o); }
  const savedT = store.get('tuning', 'e');
  tuningSel.value = TUNINGS.some(t => t.id === savedT) ? savedT : 'e';
  let tuning = TUNINGS.find(t => t.id === tuningSel.value);
  let locked = -1; // índice de cuerda fijada, -1 = automático

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
      // Toque corto: fijar/soltar cuerda. Pulsación larga: escuchar nota.
      let t = 0, long = false;
      b.addEventListener('pointerdown', () => { long = false; t = setTimeout(() => { long = true; playReference(m); }, 450); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => clearTimeout(t)));
      b.addEventListener('click', () => { if (long) return; locked = locked === i ? -1 : i; updateTargetLabel(); markStrings(-1, false); });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      box.appendChild(b);
    });
    updateTargetLabel();
  }
  function updateTargetLabel() {
    if (!tuning.notes.length) $('target').textContent = 'Modo cromático';
    else if (locked >= 0) $('target').textContent = 'Cuerda ' + (tuning.notes.length - locked) + 'ª fijada';
    else $('target').textContent = 'Detección automática de cuerda';
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
    locked = -1; store.set('tuning', tuning.id); renderStrings();
  });
  renderStrings();

  // Marcas del medidor (-50…+50 cents, cada 5)
  (() => {
    const t = $('ticks');
    for (let c = -50; c <= 50; c += 5) {
      const i = document.createElement('i');
      if (c === 0) i.className = 'c'; else if (Math.abs(c) <= 5) i.className = 'g'; else if (c % 25 === 0) i.className = 'mid';
      t.appendChild(i);
    }
  })();

  // ---------- Ajustes (A4 y sensibilidad) ----------
  const SENS = { normal: { gate: 0.004, th: 0.12 }, alta: { gate: 0.0005, th: 0.15 }, max: { gate: 0.0002, th: 0.18 } };
  let sens = SENS[store.get('sens', 'alta')] ? store.get('sens', 'alta') : 'alta';
  function setA4(v) { a4 = clamp(v, 415, 466); $('a4').textContent = a4 + ' Hz'; $('a4label').textContent = String(a4); store.set('a4', a4); }
  function setSens(v) { sens = v; store.set('sens', v); for (const b of $('sensSeg').children) b.classList.toggle('on', b.dataset.v === v); }
  setA4(a4); setSens(sens);
  $('a4down').addEventListener('click', () => setA4(a4 - 1));
  $('a4up').addEventListener('click', () => setA4(a4 + 1));
  $('a4reset').addEventListener('click', () => setA4(440));
  for (const b of $('sensSeg').children) b.addEventListener('click', () => setSens(b.dataset.v));
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

  // ---------- Detección de tono (YIN con corrección de octava) ----------
  const MIN_F = 35, MAX_F = 1400;
  let stream = null, analyser = null, source = null, chain = [], buf = null, yinBuf = null, raf = 0, lastRun = 0;
  const hist = [];
  let smooth = 0, lastKey = '', lastHeard = 0, noiseFloor = 0.001;

  function yin(x, sr, th) {
    const W = x.length >> 1;
    const tauMin = Math.max(2, Math.floor(sr / MAX_F));
    const tauMax = Math.min(W - 1, Math.ceil(sr / MIN_F));
    const d = yinBuf;
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const v = x[j] - x[j + tau]; s += v * v; }
      run += s;
      d[tau] = run > 0 ? s * tau / run : 1;
    }
    const localMin = (t) => { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; return t; };
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) if (d[t] < th) { tau = localMin(t); break; }
    if (tau < 0) {
      let best = tauMin;
      for (let t = tauMin; t <= tauMax; t++) if (d[t] < d[best]) best = t;
      if (d[best] > 0.3) return -1;
      tau = best;
    }
    // Corrección de octava: cuerdas graves sin amplificar tienen la fundamental débil
    for (let k = 0; k < 2; k++) {
      const t2 = tau * 2;
      if (t2 + 2 > tauMax) break;
      let m = t2 - 2; for (let t = t2 - 2; t <= t2 + 2; t++) if (d[t] < d[m]) m = t;
      m = localMin(m);
      if (d[m] < d[tau] * 0.55) tau = m; else break;
    }
    let bt = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a + c - 2 * b;
      if (den > 0) bt = tau + (a - c) / (2 * den);
    }
    return sr / bt;
  }
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

  const disp = $('display');
  function setState(st) { disp.className = 'display ' + st; }

  function idle(msg) {
    setState('idle');
    $('note').textContent = '–'; $('octave').textContent = '';
    $('cents').textContent = '— ¢'; $('freq').textContent = '— Hz';
    $('needle').style.left = '50%';
    $('status').textContent = msg;
    markStrings(-1, false);
  }

  function show(freq) {
    lastHeard = performance.now();
    const mf = freqToMidi(freq);
    let target, idx = -1;
    if (tuning.notes.length) {
      if (locked >= 0) idx = locked;
      else { let best = Infinity; tuning.notes.forEach((m, i) => { const dd = Math.abs(mf - m); if (dd < best) { best = dd; idx = i; } }); }
      target = tuning.notes[idx];
    } else target = Math.round(mf);

    const raw = (mf - target) * 100;
    const key = target + '|' + idx;
    if (key !== lastKey || Math.abs(raw - smooth) > 60) smooth = raw; else smooth += (raw - smooth) * 0.3;
    lastKey = key;
    const c = smooth, ac = Math.abs(c);

    $('note').textContent = noteName(target);
    $('octave').textContent = String(octaveOf(target));
    const cr = Math.round(c) || 0;
    $('cents').textContent = (cr > 0 ? '+' : '') + cr + ' ¢';
    $('freq').textContent = freq.toFixed(1) + ' Hz · ' + midiToFreq(target).toFixed(1) + ' Hz';
    $('needle').style.left = (50 + clamp(c, -50, 50)) + '%';

    let st, msg;
    if (ac <= 3) { st = 'ok'; msg = '✓ AFINADA'; }
    else {
      const dirFlat = c < 0;
      st = (ac <= 10 ? 'near ' : '') + (dirFlat ? 'flat' : 'sharp');
      if (ac >= 50) {
        const semis = Math.round(ac / 100);
        const tocas = noteName(Math.round(mf)) + octaveOf(Math.round(mf));
        msg = (dirFlat ? '▲ SUBE ' : '▼ BAJA ') + (semis >= 1 ? semis + (semis === 1 ? ' semitono' : ' semitonos') : '') + ' · suena ' + tocas;
      } else msg = dirFlat ? '▲ SUBE · aprieta' : '▼ BAJA · afloja';
    }
    setState(st);
    $('status').textContent = msg;
    markStrings(idx, st === 'ok');
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (ts - lastRun < 40) return; // ~25 análisis/segundo
    lastRun = ts;
    analyser.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    const db = 20 * Math.log10(rms + 1e-9);
    $('level').style.width = clamp((db + 80) / 70 * 100, 0, 100) + '%';

    const cfg = SENS[sens];
    const gate = Math.max(cfg.gate, noiseFloor * 2.2);
    let f = -1;
    if (rms > gate) f = yin(buf, ctx.sampleRate, cfg.th);
    if (f > MIN_F && f < MAX_F) {
      hist.push(f); if (hist.length > 5) hist.shift();
      show(median(hist));
    } else {
      // Estimar el ruido de fondo cuando no hay nota
      noiseFloor = noiseFloor * 0.95 + Math.min(rms, 0.05) * 0.05;
      hist.length = 0;
      const since = performance.now() - lastHeard;
      if (since > 2500) idle('Toca una cuerda…');
      else if (since > 300) disp.classList.add('hold');
    }
  }

  async function startMic() {
    stopMetro();
    setSession('play-and-record');
    const ac = audio();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    } catch {
      idle('Sin permiso de micrófono. Actívalo en los ajustes del navegador.');
      setSession('playback');
      return;
    }
    source = ac.createMediaStreamSource(stream);
    // Filtro de banda de guitarra/bajo para quitar zumbidos y ruido agudo
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.7;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.7;
    analyser = ac.createAnalyser(); analyser.fftSize = 4096;
    source.connect(hp).connect(lp).connect(analyser); // no va a los altavoces; no se guarda nada
    chain = [hp, lp];
    buf = new Float32Array(analyser.fftSize);
    yinBuf = new Float32Array(analyser.fftSize >> 1);
    noiseFloor = 0.001; lastHeard = 0;
    $('micBtn').textContent = 'Detener micrófono';
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
    hist.length = 0;
    $('micBtn').textContent = 'Activar micrófono';
    $('micBtn').classList.remove('on');
    $('level').style.width = '0';
    idle('Micrófono apagado');
    setSession('playback');
    keepAwake(playing);
  }
  $('micBtn').addEventListener('click', () => (stream ? stopMic() : startMic()));
  idle('Activa el micrófono para empezar');

  // ================= METRÓNOMO =================
  let bpm = clamp(Number(store.get('bpm', 120)) || 120, 30, 300);
  let subdiv = [1, 2, 3, 4].includes(store.get('subdiv', 1)) ? store.get('subdiv', 1) : 1;
  let sound = ['beep', 'clic', 'madera'].includes(store.get('sound', 'beep')) ? store.get('sound', 'beep') : 'beep';
  let vol = clamp(Number(store.get('vol', 100)), 0, 100);
  let pattern = store.get('pattern', [2, 1, 1, 1]); // 2 = acento, 1 = pulso, 0 = silencio
  if (!Array.isArray(pattern) || !pattern.length || pattern.length > 12) pattern = [2, 1, 1, 1];
  let playing = false, nextTime = 0, step = 0, timer = 0, drawRaf = 0, master = null;
  const queue = [];
  const buffers = {};

  // Sonidos pre-generados: transitorio fuerte en 1–4 kHz (donde el altavoz del móvil rinde más) y saturados para máximo volumen
  function render(kind, level) {
    const sr = ctx.sampleRate, key = kind + level;
    if (buffers[key]) return buffers[key];
    const dur = kind === 'madera' ? 0.07 : kind === 'clic' ? 0.03 : 0.06;
    const n = Math.floor(sr * dur), b = ctx.createBuffer(1, n, sr), x = b.getChannelData(0);
    const hi = level === 2;
    for (let i = 0; i < n; i++) {
      const t = i / sr, att = Math.min(1, i / (sr * 0.0006));
      let v;
      if (kind === 'beep') {
        const f = hi ? 2000 : level === 1 ? 1500 : 1000;
        v = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.7 + Math.sin(2 * Math.PI * f * 2 * t) * 0.3;
        v *= Math.exp(-t / (dur * 0.6));
      } else if (kind === 'clic') {
        const f = hi ? 3400 : level === 1 ? 2600 : 1900;
        v = (Math.sin(2 * Math.PI * f * t) + (Math.random() * 2 - 1) * 0.6) * Math.exp(-t / 0.006);
      } else {
        const f = hi ? 1650 : level === 1 ? 1200 : 900;
        v = (Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * f * 2.76 * t)) * Math.exp(-t / 0.018);
      }
      x[i] = Math.tanh(v * 4) * att; // saturación = más volumen percibido
    }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
    const g = (level === 3 ? 0.5 : 1) * 0.99 / (peak || 1);
    for (let i = 0; i < n; i++) x[i] *= g;
    return (buffers[key] = b);
  }

  function ensureMaster() {
    if (master) return;
    master = ctx.createGain();
    const lim = ctx.createDynamicsCompressor(); // limitador para no distorsionar al subir volumen
    lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.05;
    master.connect(lim).connect(ctx.destination);
    setVol(vol);
  }
  function setVol(v) {
    vol = v; store.set('vol', v); $('vol').value = String(v);
    if (master) master.gain.value = Math.pow(v / 100, 1.6) * 1.6; // curva perceptual con empuje extra arriba
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
      if (st > 0) click(nextTime, isBeat ? st : 3); // 3 = subdivisión (más suave)
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
    if (!pattern.includes(2) && n > 1 && pattern[0] === 1) pattern[0] = 2;
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
    // Desbloqueo de audio en iPhone antiguos: un audio silencioso hace que suene aunque el interruptor esté en silencio
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
  $('subdiv').addEventListener('change', (e) => { subdiv = Number(e.target.value); store.set('subdiv', subdiv); step = Math.floor(step / subdiv) * subdiv; });
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

  // ================= Pestañas y ciclo de vida =================
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === tab.dataset.view));
    if (tab.dataset.view !== 'tuner' && stream) stopMic(); // el micrófono solo vive en el afinador
  }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && stream) stopMic();
    if (document.visibilityState === 'visible' && (stream || playing)) keepAwake(true);
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // Al publicar una versión nueva, recargar una vez para usarla
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !stream && !playing) { reloaded = true; location.reload(); }
    });
  }
})();
