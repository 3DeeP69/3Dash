# Leaflet 1.9.4 (vendored, BSD-2-Clause)

From the npm package leaflet@1.9.4. Bundled so the Spy Tools live map loads inside the
Windows/Android apps with no runtime CDN dependency. Point the loader at:
  ./vendor/leaflet/leaflet.css
  ./vendor/leaflet/leaflet.js
Marker/layer images are in ./vendor/leaflet/images/ (Leaflet finds them relative to leaflet.css).
Tiles are keyless (OpenStreetMap / CARTO basemaps) — no API key needed.
