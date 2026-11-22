# Afinador y metrónomo — v1

App web instalable (PWA) para el teléfono. Funciona sin conexión una vez instalada.

## Qué hace
- **Afinador cromático**: nota, octava, desviación en cents (±50), frecuencia en Hz. Verde = afinada (±3 ¢).
- **Afinaciones**: Estándar, Drop D, E♭, Drop C♯, D estándar, Drop C, C estándar, Drop B, 7 cuerdas (B, Drop A, A estándar), bajo 4 cuerdas (E y Drop D). Detecta desde ~35 Hz.
- Toca una cuerda en pantalla para oír su **nota de referencia**.
- **La (A4)** ajustable de 415 a 466 Hz.
- **Metrónomo**: 30–300 BPM, tap tempo, compases 2/4–7/8, subdivisiones (corcheas, tresillos, semicorcheas), acento en el 1.
- Mantiene la pantalla encendida mientras se usa.

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
