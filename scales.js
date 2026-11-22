/* Escalas, relativas, acordes, progresiones y círculo de quintas. Sin red, sin datos. */
'use strict';

(function (root) {
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];

  // Tónicas con su ortografía habitual
  const TONICS = ['C', 'C♯', 'D♭', 'D', 'D♯', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A♭', 'A', 'B♭', 'B'];

  // Escalas. hept = intervalos de 7 notas; pick = qué grados mostrar (escalas de 5/6 notas), extra = notas añadidas
  const SCALES = [
    { id: 'minor',    name: 'Menor natural (eólica)',   hept: [0, 2, 3, 5, 7, 8, 10], kind: 'minor' },
    { id: 'major',    name: 'Mayor (jónica)',           hept: [0, 2, 4, 5, 7, 9, 11], kind: 'major' },
    { id: 'harmonic', name: 'Menor armónica',           hept: [0, 2, 3, 5, 7, 8, 11], kind: 'minor' },
    { id: 'pentmin',  name: 'Pentatónica menor',        hept: [0, 2, 3, 5, 7, 8, 10], pick: [0, 2, 3, 4, 6], kind: 'minor' },
    { id: 'pentmaj',  name: 'Pentatónica mayor',        hept: [0, 2, 4, 5, 7, 9, 11], pick: [0, 1, 2, 4, 5], kind: 'major' },
    { id: 'blues',    name: 'Blues (pentatónica + ♭5)', hept: [0, 2, 3, 5, 7, 8, 10], pick: [0, 2, 3, 4, 6], blue: true, kind: 'minor' },
    { id: 'dorian',   name: 'Dórica',                   hept: [0, 2, 3, 5, 7, 9, 10], kind: 'minor' },
    { id: 'phrygian', name: 'Frigia',                   hept: [0, 1, 3, 5, 7, 8, 10], kind: 'minor' },
    { id: 'phrygdom', name: 'Frigia dominante',         hept: [0, 1, 4, 5, 7, 8, 10], kind: 'major' },
    { id: 'mixo',     name: 'Mixolidia',                hept: [0, 2, 4, 5, 7, 9, 10], kind: 'major' },
  ];
  const SCALE_TIP = {
    minor: 'La base del heavy, power y metal melódico.',
    major: 'Brillante y abierta: rock, baladas, coros épicos.',
    harmonic: 'Sonido neoclásico (Malmsteen, power metal): el 7.º grado sube medio tono.',
    pentmin: 'La de los solos de rock y blues: 5 notas, nunca suena mal.',
    pentmaj: 'Rock alegre, country-rock, solos melódicos.',
    blues: 'Pentatónica menor con la «blue note» (♭5).',
    dorian: 'Menor con 6.ª mayor: más luminosa (Santana, algo de prog).',
    phrygian: 'Menor oscura con ♭2: metal extremo, thrash, djent.',
    phrygdom: 'Exótica, «oriental»: muy usada en metal (Metallica, Megadeth).',
    mixo: 'Mayor con ♭7: hard rock (AC/DC, Van Halen).',
  };

  function parse(name) {
    const L = LETTERS.indexOf(name[0]);
    const acc = name.includes('♯') ? 1 : name.includes('♭') ? -1 : 0;
    return { L, pc: (LETTER_PC[L] + acc + 12) % 12 };
  }
  function spell(L, pc) {
    L = ((L % 7) + 7) % 7;
    let d = ((pc - LETTER_PC[L]) % 12 + 12) % 12;
    if (d > 6) d -= 12;
    const acc = d === 0 ? '' : d === 1 ? '♯' : d === 2 ? '𝄪' : d === -1 ? '♭' : d === -2 ? '𝄫' : '?';
    return LETTERS[L] + acc;
  }
  // Nota del grado (1–7) con alteración relativa a la escala mayor (−1 = ♭)
  function degreeNote(tonic, deg, acc) {
    const t = parse(tonic);
    return { name: spell(t.L + deg - 1, (t.pc + MAJOR[deg - 1] + acc + 12) % 12), pc: (t.pc + MAJOR[deg - 1] + acc + 12) % 12 };
  }
  const DEG_LABEL = ['1', '2', '3', '4', '5', '6', '7'];
  function accLabel(a) { return a === -1 ? '♭' : a === 1 ? '♯' : a === -2 ? '𝄫' : ''; }

  function scaleNotes(tonic, sc) {
    const t = parse(tonic);
    const hept = sc.hept.map((iv, i) => ({ name: spell(t.L + i, (t.pc + iv) % 12), pc: (t.pc + iv) % 12, deg: accLabel(iv - MAJOR[i]) + DEG_LABEL[i], i }));
    let notes = sc.pick ? sc.pick.map(i => hept[i]) : hept.slice();
    if (sc.blue) notes.splice(3, 0, { name: spell(t.L + 4, (t.pc + 6) % 12), pc: (t.pc + 6) % 12, deg: '♭5', blue: true });
    return { hept, notes };
  }

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  function triads(tonic, sc) {
    const { hept } = scaleNotes(tonic, sc);
    return hept.map((n, i) => {
      const third = (sc.hept[(i + 2) % 7] - sc.hept[i] + 12) % 12;
      const fifth = (sc.hept[(i + 4) % 7] - sc.hept[i] + 12) % 12;
      let q = '', rn = ROMAN[i], sfx = '';
      if (third === 4 && fifth === 7) { q = ''; }
      else if (third === 3 && fifth === 7) { q = 'm'; rn = rn.toLowerCase(); }
      else if (third === 3 && fifth === 6) { q = 'dim'; rn = rn.toLowerCase(); sfx = '°'; }
      else if (third === 4 && fifth === 8) { q = 'aug'; sfx = '+'; }
      else q = '?';
      const acc = accLabel(sc.hept[i] - MAJOR[i]);
      return { roman: acc + rn + sfx, name: n.name + q, root: n.name, pc: n.pc };
    });
  }

  // Progresiones: [grado, alteración, calidad]
  const PROGS = {
    major: [
      { n: 'I – V – vi – IV', tip: 'Rock/pop, baladas power', c: [[1, 0, ''], [5, 0, ''], [6, 0, 'm'], [4, 0, '']] },
      { n: 'I – IV – V', tip: 'Rock clásico', c: [[1, 0, ''], [4, 0, ''], [5, 0, '']] },
      { n: 'I – ♭VII – IV', tip: 'Hard rock (prestado de mixolidia)', c: [[1, 0, ''], [7, -1, ''], [4, 0, '']] },
      { n: 'vi – IV – I – V', tip: 'Épico, coros de estadio', c: [[6, 0, 'm'], [4, 0, ''], [1, 0, ''], [5, 0, '']] },
    ],
    minor: [
      { n: 'i – ♭VI – ♭VII', tip: 'Power / heavy épico', c: [[1, 0, 'm'], [6, -1, ''], [7, -1, '']] },
      { n: 'i – ♭VII – ♭VI – ♭VII', tip: 'Heavy clásico (Iron Maiden)', c: [[1, 0, 'm'], [7, -1, ''], [6, -1, ''], [7, -1, '']] },
      { n: 'i – ♭VI – ♭III – ♭VII', tip: 'Metal melódico', c: [[1, 0, 'm'], [6, -1, ''], [3, -1, ''], [7, -1, '']] },
      { n: 'i – iv – V', tip: 'Neoclásico (menor armónica)', c: [[1, 0, 'm'], [4, 0, 'm'], [5, 0, '']] },
      { n: 'i – ♭II', tip: 'Frigio: oscuro, thrash/djent', c: [[1, 0, 'm'], [2, -1, '']] },
      { n: 'i – iv – ♭VII – ♭III', tip: 'Rock/metal con aire de power ballad', c: [[1, 0, 'm'], [4, 0, 'm'], [7, -1, ''], [3, -1, '']] },
    ],
    phrygdom: [
      { n: 'I – ♭II – I', tip: 'Riff exótico, muy metal', c: [[1, 0, ''], [2, -1, ''], [1, 0, '']] },
      { n: 'iv – ♭III – ♭II – I', tip: 'Cadencia andaluza: dramática, flamenco-metal', c: [[4, 0, 'm'], [3, -1, ''], [2, -1, ''], [1, 0, '']] },
    ],
  };

  // Círculo de quintas: mayores y sus relativas menores
  const CIRCLE = [['C', 'A'], ['G', 'E'], ['D', 'B'], ['A', 'F♯'], ['E', 'C♯'], ['B', 'G♯'], ['F♯', 'D♯'], ['D♭', 'B♭'], ['A♭', 'F'], ['E♭', 'C'], ['B♭', 'G'], ['F', 'D']];
  const ACCS = ['', '1♯', '2♯', '3♯', '4♯', '5♯', '6♯', '5♭', '4♭', '3♭', '2♭', '1♭'];

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const SVG = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs) { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  function init(opts) {
    const $ = (id) => document.getElementById(id);
    const store = opts.store;
    let tonic = TONICS.includes(store.get('sc.tonic', 'E')) ? store.get('sc.tonic', 'E') : 'E';
    let scId = SCALES.some(s => s.id === store.get('sc.scale', 'minor')) ? store.get('sc.scale', 'minor') : 'minor';
    const tonicSel = $('scTonic'), scaleSel = $('scScale');
    for (const t of TONICS) { const o = el('option', null, t); o.value = t; tonicSel.appendChild(o); }
    for (const s of SCALES) { const o = el('option', null, s.name); o.value = s.id; scaleSel.appendChild(o); }

    function set(t, s) {
      tonic = t; scId = s; tonicSel.value = t; scaleSel.value = s;
      store.set('sc.tonic', t); store.set('sc.scale', s); render();
    }
    tonicSel.addEventListener('change', () => set(tonicSel.value, scId));
    scaleSel.addEventListener('change', () => set(tonic, scaleSel.value));

    // Normaliza una tónica a una de la lista (p. ej. G♯ menor → se mantiene; D♯ → E♭)
    function norm(name) {
      if (TONICS.includes(name)) return name;
      const pc = parse(name).pc;
      return TONICS.find(t => parse(t).pc === pc);
    }

    function render() {
      const sc = SCALES.find(s => s.id === scId);
      const { notes } = scaleNotes(tonic, sc);
      $('scTitle').textContent = tonic + ' ' + sc.name.split(' (')[0].toLowerCase();
      $('scTip').textContent = SCALE_TIP[sc.id];

      const box = $('scNotes'); box.textContent = '';
      notes.forEach((n, i) => {
        const b = el('button', 'scNote' + (i === 0 ? ' root' : '') + (n.blue ? ' blue' : ''));
        b.append(el('b', null, n.name), el('small', null, n.deg));
        b.addEventListener('click', () => opts.play([48 + n.pc + (n.pc < parse(tonic).pc ? 12 : 0)]));
        box.appendChild(b);
      });

      // Relativa
      const rel = $('scRel'); rel.textContent = '';
      // [grado, alteración, escala destino, etiqueta, explicación]
      const REL = {
        minor:    [3, -1, 'major',    'Relativa mayor', 'Mismas notas; la relativa mayor empieza en el ♭3.'],
        harmonic: [3, -1, 'major',    'Relativa mayor', 'Comparte casi todas las notas (salvo el 7.º, que en la armónica sube).'],
        pentmin:  [3, -1, 'pentmaj',  'Relativa mayor', 'Mismas 5 notas; la mayor empieza en el ♭3.'],
        blues:    [3, -1, 'pentmaj',  'Relativa mayor', 'La pentatónica mayor relativa empieza en el ♭3.'],
        major:    [6,  0, 'minor',    'Relativa menor', 'Mismas notas; la relativa menor empieza en el 6.º grado.'],
        pentmaj:  [6,  0, 'pentmin',  'Relativa menor', 'Mismas 5 notas; la menor empieza en el 6.º grado.'],
        dorian:   [7, -1, 'major',    'Escala madre',   'La dórica es la mayor de esta nota empezando en su 2.º grado.'],
        phrygian: [6, -1, 'major',    'Escala madre',   'La frigia es la mayor de esta nota empezando en su 3.er grado.'],
        mixo:     [4,  0, 'major',    'Escala madre',   'La mixolidia es la mayor de esta nota empezando en su 5.º grado.'],
        phrygdom: [4,  0, 'harmonic', 'Escala madre',   'La frigia dominante es el 5.º modo de esta menor armónica.'],
      }[sc.id];
      const relT = norm(degreeNote(tonic, REL[0], REL[1]).name), relS = REL[2];
      const relName = SCALES.find(x => x.id === relS).name.split(' (')[0].toLowerCase();
      const rb = el('button', 'relBtn');
      rb.append(el('span', null, REL[3] + ': '), el('b', null, relT + ' ' + relName), el('span', 'go', ' →'));
      rb.addEventListener('click', () => set(relT, relS));
      rel.appendChild(rb);
      rel.appendChild(el('p', 'muted', REL[4]));

      // Acordes de la tonalidad (de la escala de 7 notas madre)
      const ch = $('scChords'); ch.textContent = '';
      triads(tonic, sc).forEach(t => {
        const c = el('div', 'chord');
        c.append(el('small', null, t.roman), el('b', null, t.name));
        ch.appendChild(c);
      });

      // Progresiones
      const pr = $('scProgs'); pr.textContent = '';
      const t0 = norm(tonic);
      for (const p of PROGS[sc.id === 'phrygdom' ? 'phrygdom' : sc.kind]) {
        const names = p.c.map(([d, a, q]) => degreeNote(t0, d, a).name + q);
        const power = p.c.map(([d, a]) => degreeNote(t0, d, a).name + '5');
        const row = el('div', 'prog');
        const top = el('div', 'progTop'); top.append(el('b', null, names.join(' – ')), el('span', 'muted', p.n));
        row.append(top, el('div', 'muted', p.tip + ' · en power chords: ' + power.join(' ')));
        row.addEventListener('click', () => opts.playChords(p.c.map(([d, a, q]) => {
          const r = degreeNote(t0, d, a).pc; return [r, r + (q === 'm' ? 3 : 4), r + 7];
        })));
        pr.appendChild(row);
      }

      drawFretboard(notes, parse(tonic).pc);
      // En los modos, el círculo marca la tonalidad madre (su armadura)
      const modal = ['dorian', 'phrygian', 'mixo', 'phrygdom'].includes(sc.id);
      drawCircle(modal ? parse(relT).pc : parse(tonic).pc, modal ? relS !== 'major' : sc.kind === 'minor');
    }

    function drawFretboard(notes, rootPc) {
      const svg = $('scFret'); svg.textContent = '';
      const strings = opts.getStrings().slice().reverse(); // aguda arriba
      const frets = 12, W = 360, left = 22, right = 6, top = 10, rowH = 18;
      const H = top * 2 + rowH * (strings.length - 1) + 16;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const fw = (W - left - right) / (frets + 0.6);
      const x = (f) => left + fw * (f === 0 ? 0 : f + 0.6) - (f === 0 ? 0 : fw / 2);
      // trastes
      for (let f = 0; f <= frets; f++) {
        const xx = left + fw * 0.6 + fw * f;
        svg.appendChild(sv('line', { x1: xx, x2: xx, y1: top, y2: top + rowH * (strings.length - 1), class: f === 0 ? 'nut' : 'fret' }));
      }
      [3, 5, 7, 9, 12].forEach(f => { const t = sv('text', { x: left + fw * 0.6 + fw * (f - 0.5), y: H - 2, class: 'fnum' }); t.textContent = String(f); svg.appendChild(t); });
      const set = new Set(notes.map(n => n.pc));
      strings.forEach((m, si) => {
        const y = top + rowH * si;
        svg.appendChild(sv('line', { x1: left, x2: W - right, y1: y, y2: y, class: 'str' }));
        const lab = sv('text', { x: 4, y: y + 4, class: 'slab' }); lab.textContent = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][m % 12]; svg.appendChild(lab);
        for (let f = 0; f <= frets; f++) {
          const pc = (m + f) % 12;
          if (!set.has(pc)) continue;
          svg.appendChild(sv('circle', { cx: f === 0 ? left + fw * 0.3 : x(f), cy: y, r: 6.5, class: pc === rootPc ? 'dot root' : 'dot' }));
        }
      });
    }

    function drawCircle(tpc, isMinor) {
      const svg = $('scCircle'); svg.textContent = '';
      const C = 150, R1 = 140, R2 = 98, R3 = 62;
      svg.setAttribute('viewBox', '0 0 300 300');
      const idx = CIRCLE.findIndex(([M, m]) => parse(isMinor ? m : M).pc === tpc);
      CIRCLE.forEach(([M, m], i) => {
        const a0 = (i - 0.5) / 12 * 2 * Math.PI - Math.PI / 2, a1 = (i + 0.5) / 12 * 2 * Math.PI - Math.PI / 2;
        const near = idx >= 0 && (i === (idx + 1) % 12 || i === (idx + 11) % 12);
        const seg = (ro, ri, cls, label, onClick, fs) => {
          const p = ['M', C + ro * Math.cos(a0), C + ro * Math.sin(a0), 'A', ro, ro, 0, 0, 1, C + ro * Math.cos(a1), C + ro * Math.sin(a1),
            'L', C + ri * Math.cos(a1), C + ri * Math.sin(a1), 'A', ri, ri, 0, 0, 0, C + ri * Math.cos(a0), C + ri * Math.sin(a0), 'Z'].join(' ');
          const path = sv('path', { d: p, class: cls });
          const am = i / 12 * 2 * Math.PI - Math.PI / 2, rm = (ro + ri) / 2;
          const t = sv('text', { x: C + rm * Math.cos(am), y: C + rm * Math.sin(am) + fs * 0.35, class: 'clab', 'font-size': fs }); t.textContent = label;
          const g = sv('g', { class: 'cseg' }); g.append(path, t); g.addEventListener('click', onClick); svg.appendChild(g);
        };
        seg(R1, R2, 'ring' + (i === idx && !isMinor ? ' sel' : i === idx ? ' selrel' : near ? ' near' : ''), M, () => set(norm(M), 'major'), 17);
        seg(R2, R3, 'ring in' + (i === idx && isMinor ? ' sel' : i === idx ? ' selrel' : near ? ' near' : ''), m + 'm', () => set(norm(m), 'minor'), 13);
      });
      const t = sv('text', { x: C, y: C - 4, class: 'cmid' }); t.textContent = idx >= 0 ? (ACCS[idx] || 'sin alteraciones') : '';
      const t2 = sv('text', { x: C, y: C + 14, class: 'cmid sm' }); t2.textContent = 'armadura';
      svg.append(t, t2);
    }

    set(tonic, scId);
    return { refresh: render };
  }

  root.Escalas = { init, _test: { scaleNotes, triads, degreeNote, SCALES } };
})(typeof self !== 'undefined' ? self : globalThis);
