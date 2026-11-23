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
    return function detect(input) {
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
        const isGhost = (f0) => {
          const L = [1, 2, 3, 4, 5, 6].map(k => f0 * k < 2000 ? level(f0 * k) : -Infinity);
          return Math.max(L[0], L[1]) < Math.max(L[2], L[3], L[4], L[5]) - Math.log(10);
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
      return { freq, clarity: Math.min(1, Math.max(peakV, ghostClar)), rms, cands: ghostCands };
    };
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
    o = Object.assign({ attack: 0.15, window: 0.45, keep: 3, tol: 35, gateDb: 8 }, o || {});
    const c = (a, b) => 1200 * Math.log2(a / b);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
    let lock = 0, buf = [], cand = [], alt = [], far = [], farT = 0, prevLock = 0, lastAccept = -1e9, lastOnset = -1e9, env = 0, newPluck = false;
    let floorHist = [], floorDb = -75, peakDb = -75, open = false, openSince = 0;
    let ev = null, evId = 0; const recentDb = [];

    function trimmed() {
      const s = buf.map(b => b.f).sort((x, y) => x - y);
      const k = Math.floor(s.length * 0.2), part = s.slice(k, s.length - k || undefined);
      return part.reduce((a, b) => a + b, 0) / part.length;
    }
    function relock(arr, t) { const nl = med(arr); if (lock && Math.abs(c(nl, lock)) > 50) prevLock = lock; lock = nl; buf = arr.map(f => ({ f, t })); cand = []; alt = []; far = []; newPluck = false; }
    // Umbral de apertura: por encima del ruido de fondo Y por encima de los picos del ambiente
    // (golpes de bajo de la música del vecino, carros…): solo abre una cuerda tocada cerca.
    function threshold() { return Math.max(floorDb + o.gateDb, Math.min(peakDb + (o.peakMargin == null ? 3 : o.peakMargin), floorDb + (o.cap || 12))); }
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
      setGate(db) { o.gateDb = db; },
      reset() { prevLock = 0; lock = 0; buf = []; cand = []; alt = []; far = []; lastAccept = -1e9; newPluck = false; floorHist = []; floorDb = -75; peakDb = -75; open = false; ev = null; recentDb.length = 0; },
      // r = { freq, clarity, rms }, t en segundos. Devuelve { freq, fresh } o null.
      update(r, t, minClarity, prior) {
        // Nivel para la puerta: si la app lo da, solo la banda de 250–2000 Hz con ventana corta.
        // Ahí la cuerda tocada cerca sube ~20 dB; el retumbe de la sala y el bajo que atraviesa paredes casi no llegan.
        const lv = r.level != null ? r.level : r.rms;
        const db = 20 * Math.log10(lv + 1e-9);
        // Una púa cerca del micrófono es brillante: en el ataque la banda media pesa casi tanto como todo el sonido.
        // Un bajo lejano (o a través de la pared) es casi solo graves.
        const bright = r.level == null || 20 * Math.log10((r.level + 1e-9) / (r.rms + 1e-9)) >= (o.minRel == null ? -10 : o.minRel);
        // ---- Puerta de ruido ----
        // Ataque (subida brusca respecto a los últimos fotogramas)
        const prevMin = recentDb.length ? Math.min(...recentDb) : db;
        const attack = db - prevMin >= 6;
        recentDb.push(db); if (recentDb.length > 5) recentDb.shift();

        // Los primeros ~0,3 s solo se mide el ambiente
        if (floorHist.length < 10 && !ev) { pushFloor(db); open = false; if (attack) ev = { id: ++evId, start: t, peak: db, f: [] }; }
        else if (!open) {
          if (db > threshold() && bright) { open = true; openSince = t; lastOnset = t; newPluck = true; cand = []; ev = null; }
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
                if (stable && decaying) {
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
          if (db < floorDb + Math.max(0, o.gateDb - (o.closeDrop || 5))) open = false;
          // Una cuerda se apaga en pocos segundos; un sonido que sigue fuerte más de 5 s es ambiente
          else if (t - openSince > 5) { open = false; pushFloor(db); }
        }
        if (o.gateDb <= 0) open = true;
        // Nuevo ataque con la puerta ya abierta (cuerda tras cuerda)
        if (open && lv > env * (o.onsetRatio || 1.6) && env > 0 && t - lastOnset > 0.2) { lastOnset = t; newPluck = true; cand = []; }
        env = env * 0.6 + lv * 0.4;

        const inAttack = t - lastOnset < o.attack;
        // Solo se usan lecturas con la cuerda claramente por encima del fondo (si no, el fondo contamina la medida)
        const strong = o.gateDb <= 0 || db > floorDb + o.gateDb - (o.strongDrop || 3);
        let f = (open && strong && !inAttack && r.freq > 0 && r.clarity >= minClarity) ? r.freq : 0;
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
            cand.push(f); if (cand.length > 3) cand.shift();
            if (cand.length === 3 && Math.abs(c(Math.max(...cand), Math.min(...cand))) < 25) relock(cand, t);
          } else if (Math.abs(c(f, lock)) <= o.tol) {
            buf.push({ f, t }); alt = [];
            while (buf.length > 3 && t - buf[0].t > o.window) buf.shift();
            lock = trimmed();
          } else if (Math.abs(c(f, lock)) <= 150) {
            // Cambio moderado y consistente sin ataque nuevo = estás girando la clavija con la cuerda sonando.
            // Lo que esté más lejos sin un ataque nuevo (música, otra fuente, armónicos) se ignora.
            let harmonic = false;
            for (const k of [2, 0.5, 3, 1 / 3, 4, 0.25]) if (Math.abs(c(f / k, lock)) < 40) harmonic = true;
            const need = harmonic ? 12 : 6;
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
            const need = harmonic ? (o.farHarm || 24) : (o.far || 16);
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

  root.Pitch = { createDetector, createTracker, bandLevel };
})(typeof self !== 'undefined' ? self : globalThis);
