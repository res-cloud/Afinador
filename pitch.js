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

  root.Pitch = { createDetector };
})(typeof self !== 'undefined' ? self : globalThis);
