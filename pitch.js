/* Detector de tono — método McLeod (NSDF) calculado con FFT.
 * Robusto con señales débiles y ruidosas (guitarra eléctrica sin enchufar)
 * y con fundamentales atenuadas por el micrófono del teléfono.
 */
'use strict';

(function (root) {
  function makeFFT(n) {
    const levels = Math.log2(n) | 0;
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b); rev[i] = r; }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    // FFT compleja in-place (inv = true para la inversa sin normalizar)
    return function fft(re, im, inv) {
      for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      const s = inv ? 1 : -1;
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j, b = a + half;
            const tr = re[b] * cos[k] - s * im[b] * sin[k];
            const ti = re[b] * s * sin[k] + im[b] * cos[k];
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          }
        }
      }
    };
  }

  function createDetector(N, sampleRate, opts) {
    const o = Object.assign({ minF: 30, maxF: 1500, k: 0.88 }, opts || {});
    const M = 1 << Math.ceil(Math.log2(N * 2));
    const fft = makeFFT(M);
    const re = new Float64Array(M), im = new Float64Array(M), nsdf = new Float64Array(N);
    const x = new Float64Array(N);
    // Para el refinado espectral (ventana de Hann)
    const hann = new Float64Array(N); for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const sre = new Float64Array(M), sim = new Float64Array(M);
    const mag = (k) => Math.log(Math.hypot(sre[k], sim[k]) + 1e-12);
    const tauMin = Math.max(2, Math.floor(sampleRate / o.maxF));
    const tauMax = Math.min(Math.floor(N * 0.7), Math.ceil(sampleRate / o.minF));

    // Devuelve { freq, clarity, rms } (freq = -1 si no hay tono claro)
    const detect = function (input) {
      let mean = 0;
      for (let i = 0; i < N; i++) mean += input[i];
      mean /= N;
      let energy = 0;
      for (let i = 0; i < N; i++) { const v = input[i] - mean; x[i] = v; energy += v * v; }
      const rms = Math.sqrt(energy / N);
      let ghostCands = null, ghostClar = 0;
      if (rms < 1e-6) return { freq: -1, clarity: 0, rms };

      // Autocorrelación por FFT
      re.fill(0); im.fill(0);
      for (let i = 0; i < N; i++) re[i] = x[i];
      fft(re, im, false);
      for (let i = 0; i < M; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
      fft(re, im, true);
      // NSDF: n(τ) = 2·r(τ) / m(τ)
      let m = 2 * energy;
      nsdf[0] = 1;
      for (let t = 1; t <= tauMax + 1; t++) {
        m -= x[t - 1] * x[t - 1] + x[N - t] * x[N - t];
        const r = re[t] / M;
        nsdf[t] = m > 1e-12 ? 2 * r / m : 0;
      }

      // Picos: el máximo de cada lóbulo positivo
      const peaks = [];
      let t = 1;
      while (t < tauMax && nsdf[t] > 0) t++;          // salir del lóbulo de τ = 0
      while (t < tauMax) {
        while (t < tauMax && nsdf[t] <= 0) t++;
        let best = t;
        while (t < tauMax && nsdf[t] > 0) { if (nsdf[t] > nsdf[best]) best = t; t++; }
        if (best >= tauMin && best < tauMax && nsdf[best] > 0) peaks.push(best);
      }
      if (!peaks.length) return { freq: -1, clarity: 0, rms };
      let maxV = 0;
      for (const p of peaks) if (nsdf[p] > maxV) maxV = nsdf[p];
      let tau = peaks[0];
      for (const p of peaks) if (nsdf[p] >= o.k * maxV) { tau = p; break; }
      // Evitar errores de octava hacia abajo: si hay un pico casi igual de fuerte en τ/2 o τ/3, la nota real es esa
      for (let changed = true; changed;) {
        changed = false;
        for (const div of [2, 3]) {
          const want = tau / div;
          for (const p of peaks) {
            if (p >= tau) break;
            if (Math.abs(p - want) <= Math.max(2, want * 0.03) && nsdf[p] >= 0.8 * nsdf[tau]) { tau = p; changed = true; break; }
          }
          if (changed) break;
        }
      }

      // Dos cuerdas sonando a la vez (p. ej. la 1ª aún vibra cuando tocas la 2ª) tienen un periodo común
      // mucho más largo: una "nota fantasma" grave (B3 + E4 → E2). Una cuerda real siempre tiene fuerza en su
      // fundamental o en su 2.º armónico; la fantasma no. Si es fantasma, se usa el periodo más corto y claro.
      if (o.ghost !== false) {
        sre.fill(0); sim.fill(0);
        for (let i = 0; i < N; i++) sre[i] = x[i] * hann[i];
        fft(sre, sim, false);
        const binHz = sampleRate / M;
        const level = (fk) => {
          const lo = Math.max(1, Math.floor(fk * 0.97 / binHz)), hi = Math.min(M / 2 - 1, Math.ceil(fk * 1.03 / binHz));
          let v = -Infinity; for (let k = lo; k <= hi; k++) v = Math.max(v, mag(k)); return v;
        };
        // Fantasma = sin fuerza en fundamental ni 2.º armónico Y con huecos en la serie de armónicos
        // (B3 + E4 sobre E2 solo da los armónicos 3, 4, 6, 8…; falta el 5 y el 7). Una cuerda grave real
        // sin amplificar puede tener débiles el 1.º y el 2.º, pero conserva la serie 3–8 completa.
        const isGhost = (f0) => {
          const L = [1, 2, 3, 4, 5, 6, 7, 8].map(k => f0 * k < 2000 ? level(f0 * k) : -Infinity);
          // Más grave que la cuerda más grave de la afinación (con margen): no puede ser una cuerda
          if (o.ghostBelow && f0 < o.ghostBelow) return true;
          const top = Math.max(...L.slice(2));
          if (!(Math.max(L[0], L[1]) < top - Math.log(10))) return false;
          const n = L.slice(2).filter(v => v > -Infinity).length;
          const present = L.slice(2).filter(v => v >= top - Math.log(o.ghostTol || 10)).length; // dentro de ~20 dB
          return present < n - 1;
        };
        const hasFund = (f0) => {
          const L = [1, 2, 3, 4].map(k => f0 * k < 2000 ? level(f0 * k) : -Infinity);
          return L[0] >= Math.max(L[1], L[2], L[3]) - Math.log(10);
        };
        if (isGhost(sampleRate / tau)) {
          // Candidatas: periodos más cortos con fundamental propia (cada una de las cuerdas que suenan)
          const list = peaks.filter(p => p <= tau * 0.6 && p >= tauMin && nsdf[p] > 0.3 && hasFund(sampleRate / p))
            .sort((p, q) => nsdf[q] - nsdf[p]);
          if (!list.length) return { freq: -1, clarity: 0, rms };
          ghostCands = list.slice(0, 4).map(p => {
            const a = nsdf[p - 1], b = nsdf[p], c = nsdf[p + 1], den = a - 2 * b + c;
            return sampleRate / (p + (den < 0 ? 0.5 * (a - c) / den : 0));
          });
          ghostClar = nsdf[tau]; // la mezcla sí es periódica: su claridad es la del periodo común
          tau = list[0];
        }
      }

      // Cuerda grave leída como su 2.º o 3.er armónico (p. ej. 6ª cuerda leída como B3): si los armónicos que
      // solo tendría la nota más grave (4/3·f y 5/3·f, o 3/2·f y 5/2·f) están presentes, la nota es la grave.
      if (o.sub === true && o.ghost !== false && !ghostCands) {
        const binHz = sampleRate / M;
        const level = (fk) => {
          const lo = Math.max(1, Math.floor(fk * 0.98 / binHz)), hi = Math.min(M / 2 - 1, Math.ceil(fk * 1.02 / binHz));
          let v = -Infinity; for (let k = lo; k <= hi; k++) v = Math.max(v, mag(k)); return v;
        };
        const f = sampleRate / tau, base = level(f);
        for (const [k, a, b] of [[3, 4 / 3, 5 / 3], [2, 3 / 2, 5 / 2]]) {
          const g = f / k;
          if (g < o.minF || g * b >= 2000) continue;
          const la = level(f * a), lb = level(f * b);
          if (la >= base - Math.log(6) && lb >= base - Math.log(6)) {
            const want = Math.round(tau * k);
            let p = 0; for (const q of peaks) if (Math.abs(q - want) <= Math.max(2, want * 0.03)) { p = q; break; }
            if (p && nsdf[p] > 0.3) { tau = p; break; }
          }
        }
      }

      // Interpolación parabólica
      const a = nsdf[tau - 1], b = nsdf[tau], c = nsdf[tau + 1];
      const den = a - 2 * b + c;
      let shift = 0, peakV = b;
      if (den < 0) { shift = 0.5 * (a - c) / den; peakV = b - 0.25 * (a - c) * shift; }
      let freq = sampleRate / (tau + shift);

      // Refinado espectral: en cuerdas de acero los armónicos altos suenan algo agudos (inarmonicidad) y
      // la periodicidad global sale unos cents alta. Medimos el pico del armónico más bajo que tenga fuerza
      // (fundamental o, si el micrófono del móvil la atenúa, el 2.º) y dividimos por su número.
      if (o.refine !== false) {
        if (o.ghost === false) {
          sre.fill(0); sim.fill(0);
          for (let i = 0; i < N; i++) sre[i] = x[i] * hann[i];
          fft(sre, sim, false);
        }
        const binHz = sampleRate / M;
        const peakNear = (fk) => {
          const lo = Math.max(2, Math.floor(fk * 0.97 / binHz)), hi = Math.min(M / 2 - 2, Math.ceil(fk * 1.03 / binHz));
          let b = lo; for (let k = lo; k <= hi; k++) if (mag(k) > mag(b)) b = k;
          if (b === lo || b === hi) return null;
          const a1 = mag(b - 1), a2 = mag(b), a3 = mag(b + 1), d = a1 - 2 * a2 + a3;
          const off = d < 0 ? 0.5 * (a1 - a3) / d : 0;
          return { f: (b + off) * binHz, m: a2 };
        };
        // Por debajo de ~90 Hz los filtros (y el micrófono del móvil) deforman el pico: se usa un armónico superior
        let parts = [1, 2, 3, 4].filter(k => freq * k >= 90).slice(0, 3).map(k => ({ k, p: peakNear(freq * k) })).filter(q => q.p);
        if (parts.length) {
          const best = Math.max(...parts.map(q => q.p.m));
          const use = parts.find(q => q.p.m >= best - Math.log(6)); // el más bajo dentro de ~15 dB del más fuerte
          const fr = use.p.f / use.k;
          if (Math.abs(1200 * Math.log2(fr / freq)) < 25) freq = fr;
        }
      }
      return { freq, clarity: Math.min(1, Math.max(peakV, ghostClar)), rms, cands: ghostCands, spec: spectrum(), near, binHz };
    };
    // Espectro lineal hasta 2 kHz (para detectar púas nuevas por el sonido que aparece)
    const binHz = sampleRate / M, nSpec = Math.min(M / 2 - 1, Math.ceil(2000 / binHz));
    function spectrum() {
      const a = new Float32Array(nSpec);
      for (let k = 0; k < nSpec; k++) a[k] = Math.hypot(sre[k], sim[k]);
      return a;
    }
    // Medir directamente una cuerda concreta en el espectro de este bloque, aunque suene otra a la vez:
    // busca sus armónicos cerca de f0·h (±win cents) y usa el más bajo con fuerza. Devuelve 0 si no está.
    function near(f0, win) {
      win = win || 100;
      const r = Math.pow(2, win / 1200);
      let noise = 0; { const v = []; for (let k = 3; k < nSpec; k += 3) v.push(mag(k)); v.sort((a, b) => a - b); noise = v[v.length >> 1]; }
      const parts = [];
      for (let h = 1; h <= 4; h++) {
        const fk = f0 * h; if (fk < 75 || fk * r >= 2000) continue;
        const lo = Math.max(2, Math.floor(fk / r / binHz)), hi = Math.min(nSpec - 2, Math.ceil(fk * r / binHz));
        let b = lo; for (let k = lo; k <= hi; k++) if (mag(k) > mag(b)) b = k;
        if (b === lo || b === hi) continue;
        const a1 = mag(b - 1), a2 = mag(b), a3 = mag(b + 1), d = a1 - 2 * a2 + a3;
        const off = d < 0 ? 0.5 * (a1 - a3) / d : 0;
        parts.push({ h, f: (b + off) * binHz / h, m: a2 });
      }
      if (!parts.length) return 0;
      const best = Math.max(...parts.map(q => q.m));
      if (best < noise + Math.log(10)) return 0; // ~20 dB sobre el fondo del espectro como mínimo
      const use = parts.find(q => q.m >= best - Math.log(6));
      // Los demás armónicos fuertes deben coincidir (si no, es otra cuerda la que cae en la ventana)
      const agree = parts.filter(q => q.m >= best - Math.log(10) && Math.abs(1200 * Math.log2(q.f / use.f)) < 20).length;
      const strong = parts.filter(q => q.m >= best - Math.log(10)).length;
      // Señal débil (cuerda grave, sin enchufar): vale si al menos 3 armónicos coinciden en la misma nota
      if (best < noise + Math.log(30) && agree < 3) return 0;
      return agree >= Math.max(1, strong - 1) ? use.f : 0;
    }
    detect.opts = o; // p. ej. detect.opts.ghostBelow = frecuencia mínima razonable para la afinación
    return detect;
  }

  /* Seguimiento estable de la nota a partir de las lecturas del detector.
   * - Puerta de ruido adaptativa: mide el ruido de fondo (música, tráfico, ambiente) y solo escucha
   *   cuando el sonido supera ese fondo en `gateDb` decibelios, es decir, cuando tocas una cuerda cerca.
   * - Detecta el ataque de cada cuerda y descarta sus primeros ~150 ms (la púa desafina un instante).
   * - Se fija en una nota cuando 3 lecturas coinciden; ignora lecturas sueltas y armónicos.
   * - `prior(f)` permite corregir u omitir lecturas (p. ej. elegir la octava de una cuerda de la afinación).
   * - La frecuencia mostrada es la media recortada de los últimos ~0,45 s.
   */
  function createTracker(o) {
    o = Object.assign({ attack: 0.12, window: 0.3, keep: 3, tol: 35, gateDb: 8 }, o || {});
    const c = (a, b) => 1200 * Math.log2(a / b);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
    let lock = 0, buf = [], cand = [], alt = [], far = [], farT = 0, prevLock = 0, lastAccept = -1e9, lastOnset = -1e9, env = 0, newPluck = false;
    let floorHist = [], floorDb = -75, peakDb = -75, open = false, openSince = 0;
    let lastDb = -75, softOpen = false, earlyLock = false, expectF = 0, ev = null, evId = 0, t0 = -1, lastT = -1, dtE = 0.03; const recentDb = [];
    // Cuántas lecturas equivalen a 'sec' segundos (el teléfono puede procesar a otro ritmo)
    const nFor = (sec) => Math.max(3, Math.round(sec / dtE));

    function trimmed() {
      const s = buf.map(b => b.f).sort((x, y) => x - y);
      const k = Math.floor(s.length * 0.2), part = s.slice(k, s.length - k || undefined);
      return part.reduce((a, b) => a + b, 0) / part.length;
    }
    function relock(arr, t) { const nl = med(arr); if (lock && Math.abs(c(nl, lock)) > 50) prevLock = lock; lock = nl; buf = arr.map(f => ({ f, t })); cand = []; alt = []; far = []; newPluck = false; expectF = 0; earlyLock = false; }
    // Umbral de apertura: por encima del ruido de fondo Y por encima de los picos del ambiente
    // (golpes de bajo de la música del vecino, carros…): solo abre una cuerda tocada cerca.
    function threshold() {
      // Los picos del ambiente solo cuentan con historia suficiente (~1,5 s); antes, solo el ruido de fondo
      if (floorHist.length < nFor(1.5)) return floorDb + o.gateDb + 2;
      return Math.max(floorDb + o.gateDb, Math.min(peakDb + (o.peakMargin == null ? 3 : o.peakMargin), floorDb + (o.cap || 12)));
    }
    function pushFloor(db, id) {
      floorHist.push({ db, id: id || 0 }); if (floorHist.length > (o.hist || 200)) floorHist.shift();
      recalc();
    }
    function recalc() {
      if (!floorHist.length) return;
      const s = floorHist.map(h => h.db).sort((x, y) => x - y);
      floorDb = s[Math.floor(s.length * (o.pct || 0.1))];
      peakDb = s[Math.floor(s.length * 0.95)];
    }

    return {
      get floorDb() { return floorDb; },
      get thresholdDb() { return threshold(); },
      get gateOpen() { return open; },
      get lockFreq() { return lock; },
      setGate(db) { o.gateDb = db; },
      // Púa nueva detectada por fuera (flujo espectral): olvidar la cuerda anterior y fijarse en la nueva
      // Púa suave detectada por el espectro (también en graves) con la puerta cerrada: candidata para la vía lenta
      softOnset(t, f) { if (!open && (!ev || t - ev.start > 0.25)) { ev = { id: ++evId, start: t, peak: lastDb, f: [], exp: f }; } },
      hint(t, drop, expect) { lastOnset = t; newPluck = true; expectF = expect || 0; cand = []; alt = []; far = []; if (drop && lock) { prevLock = lock; lock = 0; buf = []; } },
      reset() { prevLock = 0; lock = 0; buf = []; cand = []; alt = []; far = []; lastAccept = -1e9; newPluck = false; floorHist = []; floorDb = -75; peakDb = -75; open = false; ev = null; t0 = -1; recentDb.length = 0; },
      // r = { freq, clarity, rms }, t en segundos. Devuelve { freq, fresh } o null.
      update(r, t, minClarity, prior) {
        // Nivel para la puerta: si la app lo da, solo la banda de 250–2000 Hz con ventana corta.
        // Ahí la cuerda tocada cerca sube ~20 dB; el retumbe de la sala y el bajo que atraviesa paredes casi no llegan.
        if (lastT >= 0 && t > lastT) dtE = dtE * 0.9 + Math.min(0.15, Math.max(0.01, t - lastT)) * 0.1;
        lastT = t;
        const lv = r.level != null ? r.level : r.rms;
        const db = 20 * Math.log10(lv + 1e-9); lastDb = db;
        // Una púa cerca del micrófono es brillante: en el ataque la banda media pesa casi tanto como todo el sonido.
        // Un bajo lejano (o a través de la pared) es casi solo graves.
        const bright = r.level == null || 20 * Math.log10((r.level + 1e-9) / (r.rms + 1e-9)) >= (o.minRel == null ? -10 : o.minRel);
        // ---- Puerta de ruido ----
        // Ataque (subida brusca respecto a los últimos fotogramas)
        const prevMin = recentDb.length ? Math.min(...recentDb) : db;
        const attack = db - prevMin >= 6;
        recentDb.push(db); if (recentDb.length > 5) recentDb.shift();

        // Los primeros ~0,3 s solo se mide el ambiente
        if (t0 < 0) t0 = t;
        if ((floorHist.length < 4 || t - t0 < 0.3) && !ev) { open = false; if (attack) ev = { id: ++evId, start: t, peak: db, f: [] }; else pushFloor(db); }
        else if (!open) {
          if (db > threshold() && bright) { softOpen = false; open = true; openSince = t; lastOnset = t; newPluck = true; cand = []; ev = null; }
          else {
            // Vía lenta: una cuerda tocada suave (por debajo del umbral) se reconoce porque, tras su ataque,
            // mantiene la MISMA nota y se va apagando poco a poco. La música cambia de nota; el ruido no tiene nota.
            if (attack && (!ev || t - ev.start > 0.25)) ev = { id: ++evId, start: t, peak: db, f: [] };
            if (ev) {
              ev.peak = Math.max(ev.peak, db);
              if (t - ev.start > o.attack && r.freq > 0 && r.clarity >= minClarity) ev.f.push(r.freq);
              const fs = ev.f.slice(-16);
              if (t - ev.start >= (o.slowT || 0.6) && fs.length >= (o.slowN || 12)) {
                const m = med(fs);
                const stable = fs.filter(f => Math.abs(c(f, m)) < 25).length >= fs.length - 2;
                const decaying = db < ev.peak - 1.5;
                // (si vino del espectro, la nota tiene que ser la cuerda que se oyó al pulsar)
                const mp = ev.exp ? (prior ? prior(m) : m) : m, fitsExp = !ev.exp || (mp > 0 && Math.abs(c(mp, ev.exp)) < 80);
                if (stable && decaying && fitsExp) {
                  softOpen = !!ev.exp;
                  open = true; openSince = t; lastOnset = ev.start; newPluck = true; cand = [];
                  floorHist = floorHist.filter(h => h.id !== ev.id); recalc(); // no era ambiente
                  ev = null;
                }
              }
              if (ev && t - ev.start > 2.5) ev = null;
            }
            if (!open) pushFloor(db, ev ? ev.id : 0);
          }
        } else {
          if (db < floorDb + (softOpen ? 0.5 : Math.max(0, o.gateDb - (o.closeDrop || 5)))) open = false;
          // Una cuerda se apaga en pocos segundos; un sonido que sigue fuerte más de 5 s es ambiente
          else if (t - openSince > 5) { open = false; pushFloor(db); }
        }
        if (o.gateDb <= 0) open = true;
        // Nuevo ataque con la puerta ya abierta (cuerda tras cuerda)
        if (open && lv > env * (o.onsetRatio || 1.6) && env > 0 && t - lastOnset > 0.2) { lastOnset = t; newPluck = true; cand = []; }
        env = env * 0.6 + lv * 0.4;

        const inAttack = t - lastOnset < o.attack;
        // Solo se usan lecturas con la cuerda claramente por encima del fondo (si no, el fondo contamina la medida)
        const strong = o.gateDb <= 0 || db > floorDb + (softOpen ? 1 : o.gateDb - (o.strongDrop || 3));
        let f = (open && strong && !inAttack && r.freq > 0 && r.clarity >= minClarity) ? r.freq : 0;
        // Púa ya identificada (se sabe qué cuerda es): si la lectura cae en esa cuerda, sirve desde ya (respuesta rápida)
        let fast = false;
        if (!f && inAttack && expectF && open && strong && bright && floorHist.length >= nFor(1.5) && r.freq > 0 && r.clarity >= 0.8) {
          const g = prior ? prior(r.freq, lock) : r.freq;
          if (g && Math.abs(c(g, expectF)) < 60) { f = r.freq; fast = true; }
        }
        // Dos cuerdas a la vez: si una de ellas es la que ya se mostraba, la otra es la que acabas de tocar
        if (f && r.cands && lock) {
          const near = (g, ref) => { if (!ref) return false; for (const k of [1, 2, 0.5, 3, 1 / 3]) if (Math.abs(c(g / k, ref)) < 40) return true; return false; };
          // 1) una cuerda nueva (ni la actual ni la anterior) · 2) la actual · 3) la más clara
          const pick = r.cands.find(g => !near(g, lock) && !near(g, prevLock)) || r.cands.find(g => Math.abs(c(g, lock)) < 40);
          if (pick) f = pick;
        }
        if (f && prior) f = prior(f, lock) || 0;
        if (f) {
          if (!lock || newPluck) {
            cand.push(f); if (cand.length > 4) cand.shift();
            // 3 lecturas que coinciden (una suelta de más no impide fijar la nota)
            let done = false;
            if (expectF && cand.length >= 2 && Math.abs(c(cand[cand.length - 1], cand[cand.length - 2])) < 15 && Math.abs(c(cand[cand.length - 1], expectF)) < 60) { relock(cand.slice(-2), t); earlyLock = fast; done = true; }
            if (!done && cand.length >= 3) { const m = med(cand), ok = cand.filter(g => Math.abs(c(g, m)) < 13); if (ok.length >= 3) relock(ok, t); }
          } else if (earlyLock && !inAttack && Math.abs(c(f, lock)) <= 100) {
            // Nota fijada con el ataque (suele salir algo alta): en cuanto llega el sonido estable, se usa solo ese
            buf = buf.filter(b => b.late); buf.push({ f, t, late: true });
            if (buf.length >= 2) earlyLock = false;
            lock = trimmed();
          } else if (Math.abs(c(f, lock)) <= o.tol) {
            buf.push({ f, t }); alt = [];
            while (buf.length > 3 && t - buf[0].t > o.window) buf.shift();
            lock = trimmed();
          } else if (Math.abs(c(f, lock)) <= 150) {
            // Cambio moderado y consistente sin ataque nuevo = estás girando la clavija con la cuerda sonando.
            // Lo que esté más lejos sin un ataque nuevo (música, otra fuente, armónicos) se ignora.
            let harmonic = false;
            for (const k of [2, 0.5, 3, 1 / 3, 4, 0.25]) if (Math.abs(c(f / k, lock)) < 40) harmonic = true;
            const need = harmonic ? nFor(0.36) : nFor(0.18);
            alt.push(f); if (alt.length > need) alt.shift();
            if (alt.length === need && Math.abs(c(Math.max(...alt), Math.min(...alt))) < 25) relock(alt, t);
          } else {
            // Nota lejana sin ataque detectado: pasaste a otra cuerda mientras la anterior seguía sonando
            // (púa suave). Si la nueva nota se mantiene firme ~0,5 s, se cambia a ella. Un armónico de la
            // cuerda anterior necesita el doble de tiempo para no confundirse.
            let harmonic = false;
            for (const k of [2, 0.5, 3, 1 / 3, 4, 0.25, 1.5, 2 / 3]) if (Math.abs(c(f / k, lock)) < 30) harmonic = true;
            // Solo hacia una nota que sea una cuerda de la afinación (la música de fondo cae en cualquier nota)
            if (o.isString && !o.isString(f)) { far = []; lastAccept = t; return lock ? { freq: lock, fresh: t - lastAccept < 0.5 } : null; }
            const need = nFor(harmonic ? 0.72 : 0.48);
            if (far.length && (Math.abs(c(f, med(far))) > 30 || t - farT > 0.5)) far = [];
            farT = t;
            far.push(f); if (far.length > need) far.shift();
            if (far.length === need && Math.abs(c(Math.max(...far), Math.min(...far))) < 25) { relock(far, t); far = []; }
          }
          lastAccept = t;
        }
        if (t - lastAccept > o.keep) { lock = 0; buf = []; }
        return lock ? { freq: lock, fresh: t - lastAccept < 0.5 } : null;
      },
    };
  }

  // Nivel (RMS) de la banda 250–2000 Hz en los últimos ~43 ms: dos pasa-altos de 250 Hz sobre el final del bloque.
  function bandLevel(x, sr, len) {
    len = len || 2048; const pre = 512, s0 = Math.max(0, x.length - len - pre);
    const w = 2 * Math.PI * 250 / sr, al = Math.sin(w) / (2 * 0.7), c = Math.cos(w);
    const a0 = 1 + al, b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
    let p = 0, n = 0; const st = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = s0; i < x.length; i++) {
      let v = x[i];
      for (let k = 0; k < 2; k++) {
        const j = k * 4, y = b0 * v + b1 * st[j] + b2 * st[j + 1] - a1 * st[j + 2] - a2 * st[j + 3];
        st[j + 1] = st[j]; st[j] = v; st[j + 3] = st[j + 2]; st[j + 2] = y; v = y;
      }
      if (i >= x.length - len) { p += v * v; n++; }
    }
    return Math.sqrt(p / Math.max(1, n));
  }

  /* Detector de púas por el sonido nuevo (flujo espectral) e identificación de la cuerda tocada.
   * Funciona aunque la cuerda anterior siga sonando: solo mira la energía que APARECE en este instante.
   * update(spec, t, binHz, strings, active) → { onset, idx }  (idx = cuerda probable, -1 si no se sabe) */
  function createOnset(o) {
    o = Object.assign({ ratio: 0.35, factor: 2.5, refractory: 0.18, collect: 3, margin: 1.08 }, o || {});
    let prev = null, hist = [], last = -1e9, acc = null, pend = 0, lastD = null, ext = false;
    function score1(D, binHz, fk) {
      const lo = Math.max(1, Math.floor(fk * 0.975 / binHz)), hi = Math.min(D.length - 1, Math.ceil(fk * 1.025 / binHz));
      let m = 0; for (let k = lo; k <= hi; k++) if (D[k] > m) m = D[k];
      return Math.log(1 + m / (o._noise || 1e-9));
    }
    function score(D, binHz, f0) {
      let sum = 0, n = 0;
      const noise = o._noise || 1e-9;
      for (let h = 1; h <= 8; h++) {
        const fk = f0 * h; if (fk * 1.025 >= 2000) break;
        n++;
        const lo = Math.max(1, Math.floor(fk * 0.975 / binHz)), hi = Math.min(D.length - 1, Math.ceil(fk * 1.025 / binHz));
        let m = 0; for (let k = lo; k <= hi; k++) if (D[k] > m) m = D[k];
        sum += Math.log(1 + m / noise);
      }
      return sum; // sin normalizar: la cuerda grave real explica más armónicos que una aguda que coincide con algunos
    }
    return {
      reset() { prev = null; hist = []; acc = null; pend = 0; },
      update(spec, t, binHz, strings, active, prevF) {
        if (!spec) return { onset: false, idx: -1 };
        let out = { onset: false, idx: -1 };
        if (prev && prev.length === spec.length) {
          const lo = Math.floor(70 / binHz);
          const D = new Float32Array(spec.length);
          let flux = 0, tot = 0;
          const mid = Math.floor(250 / binHz); let fluxHi = 0;
          for (let k = lo; k < spec.length; k++) { const d = spec[k] - prev[k]; if (d > 0) { D[k] = d; flux += d; if (k >= mid) fluxHi += d; } tot += prev[k]; }
          const ratio = flux / (tot + 1e-9);
          const medFlux = hist.length ? [...hist].sort((a, b) => a - b)[hist.length >> 1] : flux;
          hist.push(flux); if (hist.length > 30) hist.shift();
          if (acc) { // seguir acumulando el sonido nuevo unos bloques (el ataque se reparte en la ventana)
            for (let k = 0; k < D.length; k++) acc[k] += D[k];
            if (--pend <= 0) {
              const v = [...acc].sort((a, b) => a - b); o._noise = v[v.length >> 1] + 1e-9;
              let bi = -1, bs = 0, second = 0, si = -1;
              strings.forEach((f, i) => { const sc = score(acc, binHz, f); if (sc > bs) { second = bs; si = bi; bs = sc; bi = i; } else if (sc > second) { second = sc; si = i; } });
              out.top = [bi, si];
              // ¿Es en realidad una cuerda más grave cuyo armónico coincide con esta? (6ª E♭2 → su 3.º es B♭3)
              // Se mira si también suenan los armónicos que SOLO tendría la grave.
              if (bi >= 0) {
                const meanOf = (f0, skip) => { let s = 0, n = 0; for (let h = 1; h <= 8; h++) { const fk = f0 * h; if (fk * 1.025 >= 2000) break; if (skip && h % skip === 0) continue; s += score1(acc, binHz, fk); n++; } return n ? s / n : 0; };
                const own = meanOf(strings[bi], 0);
                let low = bi;
                strings.forEach((f, j) => {
                  if (f >= strings[low]) return;
                  const k = Math.round(strings[bi] / f);
                  if (k < 2 || k > 4 || Math.abs(strings[bi] / f / k - 1) > 0.03) return;
                  const u = meanOf(f, k); if (o.debugLow) o.debugLow(strings[bi], f, u, own);
                  if (u >= (o.lowRatio || 0.57) * own) low = j;
                });
                if (low !== bi) { bi = low; second = 0; bs = Math.max(bs, o.minScore || 8) + 1; out.viaLow = true; }
                // Al revés: ganó una grave solo por los armónicos que comparte con una aguda (1.ª E♭4 = 4.º de la 6.ª,
                // 3.º de la 5.ª). Si los armónicos propios de la grave casi no aparecen, la púa fue la aguda.
                else {
                  const own0 = meanOf(strings[bi], 0); let up = -1, upS = 0;
                  strings.forEach((f, j) => {
                    if (f <= strings[bi]) return;
                    const k = Math.round(f / strings[bi]);
                    if (k < 2 || k > 4 || Math.abs(f / strings[bi] / k - 1) > 0.03) return;
                    const u = meanOf(strings[bi], k), oh = meanOf(f, 0);
                    if (u < (o.highRatio ?? 0.65) * oh && oh > upS) { up = j; upS = oh; }
                  });
                  if (up >= 0) { bi = up; second = 0; bs = Math.max(bs, o.minScore || 8) + 1; out.viaHigh = true; }
                }
              }
              out.idx = (ext ? bs > 12 && bs > second * 1.03 : bs > (o.minScore || 8) && bs > second * o.margin) ? bi : -1;
              // Dudosa: las cuerdas graves tardan más en aparecer en el espectro. Se sigue acumulando un poco más.
              if (out.idx < 0 && !ext && !globalThis.NOEXT) { ext = true; pend = o.extend || 4; out = { onset: false, idx: -1 }; }
              else { out.score = bs; out.t0 = last; acc = null; }
            }
          } else if (active && t - last > o.refractory && ratio > o.ratio && flux > o.factor * medFlux && fluxHi >= (o.hiShare == null ? 0.4 : o.hiShare) * flux) {
            // (una púa cercana es brillante: buena parte del sonido nuevo está por encima de 250 Hz; un bajo de fondo no)
            last = t; out.onset = true; acc = D; pend = o.collect; ext = false;
            if (lastD) for (let k = 0; k < D.length; k++) acc[k] += lastD[k];
          }
          lastD = D;
        }
        prev = spec;
        return out;
      },
    };
  }

  /* Afinador de guitarra: une el seguimiento (createTracker) con la detección de púas por sonido nuevo.
   * - En automático, cada púa nueva se identifica (qué cuerda es) y se suelta la anterior al instante.
   * - Mientras dura esa cuerda (o la cuerda fijada), si el detector general oye otra cuerda que sigue
   *   sonando, se mide directamente la cuerda elegida en el espectro.
   * o: { tracker: opciones, strings(): frecuencias nominales ([] = cromático), locked(): índice o -1 } */
  function createGuitar(o) {
    const tracker = createTracker(o.tracker), onset = createOnset(o.onset);
    const c = (a, b) => 1200 * Math.log2(a / b);
    const recent = []; let mask = null;
    let focus = -1, focusUntil = 0, focusT = -1e9, oldF = 0, force = true, dis = [], amb = null, ambMed = 0, ambT = 0, ambLastT = -1;
    function isAmbient(f, spec, binHz) {
      if (!ambMed || ambT++ % 30 === 0) { const v = [...amb].sort((a, b) => a - b); ambMed = v[v.length >> 1] + 1e-12; }
      const lo = Math.max(1, Math.floor(f * 0.98 / binHz)), hi = Math.min(amb.length - 1, Math.ceil(f * 1.02 / binHz));
      let a = 0, cur = 0; for (let k = lo; k <= hi; k++) { if (amb[k] > a) a = amb[k]; if (spec[k] > cur) cur = spec[k]; }
      // tono = pico estrecho del ambiente (no el retumbe grave general): comparar con sus vecinos (±15 %)
      const l2 = Math.max(1, Math.floor(f * 0.85 / binHz)), h2 = Math.min(amb.length - 1, Math.ceil(f * 1.15 / binHz));
      const nb = []; for (let k = l2; k <= h2; k++) if (k < lo || k > hi) nb.push(amb[k]);
      nb.sort((x, y) => x - y); const loc = nb.length ? nb[nb.length >> 1] : ambMed;
      return a > 6 * ambMed && a > (o.ambLocal ?? 2) * loc && cur < 2.5 * a;
    }
    return {
      tracker,
      get focus() { return focus; },
      reset() { tracker.reset(); onset.reset(); focus = -1; focusUntil = 0; amb = null; ambMed = 0; recent.length = 0; },
      update(r, t, minClarity, prior) {
        const S = o.strings(), L = o.locked();
        if (S.length && r.spec) {
          // La púa puede llegar un bloque antes de que abra la puerta: se detecta siempre y se usa solo si la puerta está abierta
          const on = onset.update(r.spec, t, r.binHz, S, true);
          if (!tracker.gateOpen && on.score != null) {
            // Puerta cerrada: puede ser una púa suave (la 6.ª casi no sube la banda media). Se pasa a la vía lenta,
            // que solo abre si después la MISMA cuerda se mantiene estable.
            if (on.idx >= 0 && L < 0) tracker.softOnset(t, S[on.idx]);
            else if (L >= 0) tracker.softOnset(t, S[L]);
            on.idx = -1; on.score = null;
          }
          // Empate entre dos cuerdas: se mira cuál de las dos suena de verdad cerca de su nota
          if (L < 0 && on.idx === -1 && on.score > 8 && on.top && on.top[1] >= 0 && r.near) {
            let ok = on.top.filter(i => r.near(S[i], 60) > 0);
            if (!ok.length) {
              // Ninguna de las dos: ¿hay UNA sola cuerda nueva (no la que ya se mostraba) que suene en su nota?
              const lf = tracker.lockFreq;
              ok = S.map((f, i) => i).filter(i => !(lf && Math.abs(c(lf, S[i])) < 100) && r.near(S[i], 60) > 0);
            }
            if (ok.length === 1) on.idx = ok[0];
          }
          // Púa dudosa que señala una cuerda grave cuyo armónico es justo la cuerda que sigue sonando clara:
          // suele ser un golpe o ruido sobre esa cuerda, no una púa nueva. Se ignora.
          if (L < 0 && on.idx >= 0 && on.score < 12) {
            const lf = tracker.lockFreq, k = lf > 0 ? Math.round(lf / S[on.idx]) : 0, fr = r.freq > 0 ? (prior ? prior(r.freq) || r.freq : r.freq) : 0;
            if (k >= 2 && k <= 4 && Math.abs(c(S[on.idx] * k, lf)) < 40 && fr && Math.abs(c(fr, lf)) < 40 && r.clarity >= 0.8) { on.idx = -1; on.score = null; }
          }
          if (L < 0 && on.idx >= 0) {
            const same = on.idx === focus && t < focusUntil;
            if (!same) oldF = tracker.lockFreq || oldF;
            focus = on.idx; focusUntil = t + 4; focusT = t; force = !on.viaLow;
            if (!recent.some(q => Math.abs(c(q.f, S[on.idx])) < 50)) recent.push({ f: S[on.idx], t }); else recent.find(q => Math.abs(c(q.f, S[on.idx])) < 50).t = t;
            // Si es claramente OTRA cuerda, se suelta ya la anterior; si hay duda, se mantiene a la vista hasta fijar la nueva
            const lf = tracker.lockFreq;
            tracker.hint(t, !same && force && lf > 0 && Math.abs(c(lf, S[on.idx])) > 150, force ? S[on.idx] : 0);
          } else if (L < 0 && on.idx === -1 && on.score != null) {
            // Púa nueva pero no se sabe qué cuerda: soltar la anterior y decidir con las lecturas
            oldF = tracker.lockFreq || oldF; focus = -1; focusUntil = 0; tracker.hint(t, false);
          }
        }
        // Tonos fijos del ambiente (zumbido eléctrico, nevera, motor…): se aprenden con la puerta cerrada
        // y se descartan las lecturas que caen justo en ellos sin que hayan subido.
        if (r.spec) {
          if (!amb || amb.length !== r.spec.length) amb = Float32Array.from(r.spec);
          else {
            const dt = ambLastT >= 0 ? Math.min(0.2, Math.max(0, t - ambLastT)) : 0.03; ambLastT = t;
            if (!tracker.gateOpen) {
              // No aprender como "ambiente" las cuerdas que acaban de sonar (siguen vibrando con la puerta cerrada):
              // se excluyen sus armónicos. Así el zumbido del cuarto se aprende, pero la guitarra no.
              const lf = tracker.lockFreq; if (lf > 0 && !recent.some(q => Math.abs(c(q.f, lf)) < 50)) recent.push({ f: lf, t });
              while (recent.length && (t - recent[0].t > 20 || recent.length > 6)) recent.shift();
              const w = 1 - Math.pow(0.96, dt / 0.03), bh = r.binHz;
              if (!mask || mask.length !== amb.length) mask = new Uint8Array(amb.length);
              mask.fill(0);
              // (también las cuerdas de la afinación: las que no tocas vibran por simpatía)
              const marks = recent.map(q => [q.f, 0.025]).concat(S.map(f => [f, 0.03]));
              for (const [f0, tol] of marks) for (let h = 1; h <= 12; h++) { const fk = f0 * h; if (fk > 2000) break; const lo = Math.max(0, Math.floor(fk * (1 - tol) / bh)), hi = Math.min(amb.length - 1, Math.ceil(fk * (1 + tol) / bh)); for (let k = lo; k <= hi; k++) mask[k] = 1; }
              for (let k = 0; k < amb.length; k++) if (!mask[k]) amb[k] = amb[k] * (1 - w) + r.spec[k] * w;
            }
          }
          if (r.freq > 0) { const fp = prior ? prior(r.freq) : r.freq; if (isAmbient(r.freq, r.spec, r.binHz) && (!fp || isAmbient(fp, r.spec, r.binHz))) r = Object.assign({}, r, { freq: -1, cands: null }); }
        }
        const fi = L >= 0 ? L : (t < focusUntil ? focus : -1);
        let rr = r;
        if (fi >= 0 && r.near && r.rms > 0) {
          const f = r.freq > 0 ? (prior ? prior(r.freq) : r.freq) : 0;
          const nom = S[fi];
          const fits = f > 0 && !r.cands && Math.abs(c(f, nom)) < (L >= 0 ? 400 : 150);
          // En automático solo se fuerza la cuerda elegida si lo que oye el detector es la cuerda ANTERIOR
          // (que sigue vibrando) o una mezcla; si oye claramente otra cuerda distinta, se le hace caso.
          // Si la cuerda elegida es dudosa (vino de "quizá es la grave"), se respeta una lectura clara de otra cuerda
          const clearOther = !force && f > 0 && !r.cands && r.clarity >= 0.8 && S.some(x => Math.abs(c(f, x)) < 60);
          let isOld = L >= 0 || (!clearOther && (!f || r.cands || !force || t - focusT < 0.6));
          if (!isOld && force && oldF) for (const k of [1, 2, 0.5]) if (Math.abs(c(f / k, oldF)) < 60) isOld = true;
          // Si el detector insiste en otra cuerda (no la anterior) con lecturas claras y coherentes, la elegida estaba mal
          let other = f > 0 && !r.cands && !fits && L < 0 && r.clarity >= 0.6 && S.some(x => Math.abs(c(f, x)) < 60);
          if (other && oldF) for (const k of [1, 2, 0.5]) if (Math.abs(c(f / k, oldF)) < 60) other = false;
          if (other) { if (dis.length && Math.abs(c(f, dis[dis.length - 1])) > 30) dis = []; dis.push(f); } else dis = [];
          if (dis.length >= 6) { focus = -1; focusUntil = 0; dis = []; isOld = false; }
          if (!fits && isOld) {
            const g = r.near(nom, 100);
            if (g) { rr = Object.assign({}, r, { freq: g, clarity: Math.max(r.clarity, 0.8), cands: null }); if (L < 0) focusUntil = t + 4; }
          } else {
            if (L < 0) focusUntil = t + 4;
            // La cuerda elegida suena pero la lectura general es poco clara (típico de la 6.ª, grave y débil):
            // se mide directamente esa cuerda en el espectro y, si coincide, se usa con confianza.
            if (fits && r.clarity < 0.65 && !globalThis.NOBOOST) {
              const g = r.near(nom, 100);
              if (g && Math.abs(c(g, f)) < 40) rr = Object.assign({}, r, { freq: g, clarity: 0.8, cands: null });
            }
          }
        }
        return tracker.update(rr, t, minClarity, prior);
      },
    };
  }

  root.Pitch = { createDetector, createTracker, bandLevel, createOnset, createGuitar };
})(typeof self !== 'undefined' ? self : globalThis);
