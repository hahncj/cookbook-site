# Brand

- `540-kitchen-logo.png`: the owner's original 540 Kitchen logo (1254×1254). Source file only; it isn't served.
- Served versions live in `public/brand/` (generated with `sips -z <size> <size> 540-kitchen-logo.png --out …`):
  - `logo-96.png`, `logo-144.png`: header logo at 48 px (2× and 3× screens)
  - `logo-32.png`: browser tab icon
  - `apple-touch-icon.png` (180 px): iPhone and iPad Home Screen
  - `logo-192.png`, `logo-512.png`: web app manifest (`public/site.webmanifest`) and Android
- Logo background color: `#b35534` (used as the manifest theme and splash color).

To change the logo, replace the source file and regenerate the sizes above.
