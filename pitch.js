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

      // Interpolación parabólica
      const a = nsdf[tau - 1], b = nsdf[tau], c = nsdf[tau + 1];
      const den = a - 2 * b + c;
      let shift = 0, peakV = b;
      if (den < 0) { shift = 0.5 * (a - c) / den; peakV = b - 0.25 * (a - c) * shift; }
      return { freq: sampleRate / (tau + shift), clarity: Math.min(1, peakV), rms };
    };
  }

  /* Seguimiento estable de la nota a partir de las lecturas del detector.
   * - Detecta el ataque de cada cuerda y descarta sus primeros ~150 ms (la púa desafina un instante).
   * - Se fija en una nota cuando 3 lecturas coinciden y a partir de ahí ignora lecturas sueltas,
   *   armónicos (saltos de octava) y cuerdas que vibran por simpatía.
   * - La frecuencia mostrada es la media recortada de los últimos ~0,6 s: precisión de décimas de cent.
   * - Mantiene la última lectura mientras la cuerda se apaga.
   */
  function createTracker(o) {
    o = Object.assign({ attack: 0.15, window: 0.45, keep: 4, tol: 35 }, o || {});
    const c = (a, b) => 1200 * Math.log2(a / b);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
    let lock = 0, buf = [], cand = [], alt = [], lastAccept = -1e9, lastOnset = -1e9, env = 0, floor = 1, newPluck = false;

    function trimmed() {
      const s = buf.map(b => b.f).sort((x, y) => x - y);
      const k = Math.floor(s.length * 0.2), part = s.slice(k, s.length - k || undefined);
      return part.reduce((a, b) => a + b, 0) / part.length;
    }
    function relock(arr, t) { lock = med(arr); buf = arr.map(f => ({ f, t })); cand = []; alt = []; newPluck = false; }

    return {
      reset() { lock = 0; buf = []; cand = []; alt = []; lastAccept = -1e9; newPluck = false; },
      // r = { freq, clarity, rms }, t en segundos. Devuelve { freq, fresh } o null.
      update(r, t, minClarity) {
        // Ataque: subida brusca de volumen
        if (r.rms > Math.max(env * 1.5, floor * 2.5) && t - lastOnset > 0.2) { lastOnset = t; newPluck = true; cand = []; }
        env = env * 0.6 + r.rms * 0.4;
        floor = Math.min(floor * 1.01 + 1e-7, Math.max(r.rms, 1e-6));

        const inAttack = t - lastOnset < o.attack;
        if (!inAttack && r.freq > 0 && r.clarity >= minClarity) {
          let f = r.freq;
          if (!lock || newPluck) {
            // Nota nueva: fijarse solo cuando 3 lecturas seguidas coinciden
            cand.push(f); if (cand.length > 3) cand.shift();
            if (cand.length === 3 && Math.abs(c(Math.max(...cand), Math.min(...cand))) < 25) relock(cand, t);
          } else if (Math.abs(c(f, lock)) <= o.tol) {
            buf.push({ f, t }); alt = [];
            while (buf.length > 3 && t - buf[0].t > o.window) buf.shift();
            lock = trimmed();
          } else {
            // Lectura lejana: solo cambia si se repite de forma consistente (p. ej. al girar la clavija rápido)
            // Una octava o quinta exacta de la nota fijada sin ataque nuevo es un armónico, no otra cuerda
            let harmonic = false;
            for (const k of [2, 0.5, 3, 1 / 3, 4, 0.25]) if (Math.abs(c(f / k, lock)) < 40) harmonic = true;
            if (harmonic) { lastAccept = t; return { freq: lock, fresh: true }; }
            alt.push(f); if (alt.length > 6) alt.shift();
            if (alt.length === 6 && Math.abs(c(Math.max(...alt), Math.min(...alt))) < 25) relock(alt, t);
          }
          lastAccept = t;
        }
        if (t - lastAccept > o.keep) { lock = 0; buf = []; }
        return lock ? { freq: lock, fresh: t - lastAccept < 0.5 } : null;
      },
    };
  }

  root.Pitch = { createDetector, createTracker };
})(typeof self !== 'undefined' ? self : globalThis);
