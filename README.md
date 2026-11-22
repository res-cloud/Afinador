# Afinador, metrónomo y escalas — v6

App web instalable (PWA) para el teléfono. Funciona sin conexión una vez instalada.

## Qué hace
- **Afinador**: nota objetivo grande, aguja de ±50 cents y flechas **SUBE / BAJA**. Rojo = lejos, ámbar = cerca, verde = afinada (±3 ¢). Si la cuerda está a semitonos de distancia, lo indica («SUBE 2 semitonos · suena D2»).
- Detecta la cuerda automáticamente o puedes fijarla tocándola en pantalla. Mantén pulsada una cuerda para oír su nota.
- Detector McLeod (NSDF) con ventana de 170 ms, filtro de banda, corrección de octava y filtro de estabilidad: solo muestra una nota cuando 3 lecturas seguidas coinciden, así ignora ruidos y golpes. Precisión de décimas de cent.
- **Sensibilidad** Normal / Alta / Máxima en ⚙. Alta (por defecto) para eléctrica sin enchufar.
- **Diagnóstico** opcional en ⚙: nivel de entrada, claridad, frecuencia y estado del micrófono.
- **Afinaciones**: Estándar, Drop D, E♭, Drop C♯, D estándar, Drop C, C estándar, Drop B, 7 cuerdas (B, Drop A, A estándar), bajo 4 cuerdas (E y Drop D). Detecta desde ~35 Hz.
- **Referencia La = 440 Hz** (estándar), ajustable de 415 a 466 Hz en el botón «La 440 Hz».
- **Metrónomo**: 30–300 BPM, tap tempo, 1–12 tiempos con acento / pulso / silencio en cada uno, subdivisiones, 3 sonidos limpios (sin saturación) y volumen por el altavoz (también con el interruptor de silencio del iPhone activado).
- Mantiene la pantalla encendida mientras se usa.

- **Escalas**: elige tónica y escala (menor natural, mayor, menor armónica, pentatónicas, blues, dórica, frigia, frigia dominante, mixolidia). Muestra notas y grados, relativa mayor/menor (o escala madre en los modos), el mástil con la afinación del afinador, los acordes de la tonalidad, progresiones sugeridas para rock/metal (con su versión en power chords, se pueden escuchar) y un círculo de quintas táctil.

## Privacidad y seguridad
- Sin cuentas, sin anuncios, sin analítica, sin librerías externas. Cero peticiones a terceros.
- El micrófono se analiza en memoria y se descarta; no se graba ni se envía. Se apaga solo al salir de la app.
- Política de seguridad de contenido (CSP) estricta: solo puede cargar sus propios archivos y no puede conectarse a ningún otro sitio.
- Solo guarda en el teléfono tus preferencias (afinación, A4, BPM, compás).
- Nadie puede alterarla: el código está en un sitio que solo tú controlas.

## Archivos
`index.html`, `app.css`, `app.js`, `sw.js` (modo sin conexión), `manifest.webmanifest`, iconos.
Necesita servirse por **https** (el navegador exige https para usar el micrófono).

## Instalar en el teléfono
Una vez publicada en una dirección https:
- **Android (Chrome)**: menú ⋮ → «Instalar app» / «Añadir a pantalla de inicio».
- **iPhone (Safari)**: botón Compartir → «Añadir a pantalla de inicio».
