// Spy Tools — LIVE MAP. One map, many layers, filter toggles to cut off any of them:
//   ✈ aircraft (public ADS-B)   ⚑ police (gov/police aircraft + UK incident open data)
//   ⦿ ALPR cameras (DeFlock/OSM)   ◻ other cameras (OSM CCTV)   ⌖ you
// Leaflet is bundled with the app (web/vendor/leaflet), so the map always loads with no CDN
// or API key; the unpkg URLs are only a fallback for the plain browser preview. Map tiles are
// free, keyless OpenStreetMap/CARTO rasters. Returns a cleanup function. Performance: canvas
// renderer, capped marker counts, a single ~15 s aircraft refresh while the map is visible.
import * as SRC from "./sources.js";

const LEAFLET_LOCAL_CSS = new URL("../../../vendor/leaflet/leaflet.css", import.meta.url).href;
const LEAFLET_LOCAL_JS = new URL("../../../vendor/leaflet/leaflet.js", import.meta.url).href;
const LEAFLET_CDN_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_CDN_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const KEY = "turd_ops_map";          // {lat, lon, z, layers:{}}
const DEF = { lat: 35.05, lon: -89.95, z: 11 }; // Memphis / north-MS metro; replaced by your location / last view

let leafletP = null;
function addScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = () => res(window.L); s.onerror = () => rej(new Error("load failed: " + src));
    document.head.appendChild(s);
  });
}
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = (async () => {
    if (!document.getElementById("leaflet-css")) {
      const l = document.createElement("link"); l.id = "leaflet-css"; l.rel = "stylesheet";
      l.href = LEAFLET_LOCAL_CSS; l.onerror = () => { l.href = LEAFLET_CDN_CSS; };
      document.head.appendChild(l);
    }
    // bundled copy first; fall back to the CDN only if it isn't there (browser preview)
    try { return await addScript(LEAFLET_LOCAL_JS); }
    catch (e) {
      try { return await addScript(LEAFLET_CDN_JS); }
      catch (e2) { throw new Error("map library unavailable (no connection?)"); }
    }
  })();
  return leafletP;
}

const DEG = Math.PI / 180;
// nm radius that covers the current map view, so we only pull aircraft we can see
function viewRadiusNm(map) {
  const c = map.getCenter(), b = map.getBounds();
  const dLat = (b.getNorth() - c.lat), dLon = (b.getEast() - c.lng) * Math.cos(c.lat * DEG);
  const km = Math.sqrt(dLat * dLat + dLon * dLon) * 111;
  return Math.max(5, Math.min(250, Math.round(km / 1.852)));
}
const planeSVG = (gov, emg) => {
  const col = emg ? "#ff4d4d" : gov ? "#ffd23f" : "#39d0ff";
  return `<svg viewBox="0 0 24 24" width="22" height="22" style="filter:drop-shadow(0 0 4px ${col})">
    <path fill="${col}" stroke="#04121a" stroke-width="1" d="M12 2l1.6 7.3 7.4 3.2v1.8l-7.4-1.6-.4 4.6 2.4 1.6v1.3L12 20l-3.6 1.8v-1.3l2.4-1.6-.4-4.6L3 15.3v-1.8l7.4-3.2z"/></svg>`;
};

export function mountMap(el, ctx) {
  const { esc, toast, head } = ctx;
  const http = ctx.http;
  const saved = Object.assign({}, DEF, ctx.LS.get(KEY, {}));
  const flags = Object.assign({ air: true, police: true, alpr: true, cam: true, me: true, milOnly: false, region: "memphis" }, saved.layers || {});
  const openExt = url => { const N = window.TURD_NATIVE; if (N && N.openExternal) N.openExternal(url); else window.open(url, "_blank", "noopener"); };

  el.innerHTML = head("Live Map", "MAP", "aircraft · police · cameras") + `
    <div class="ops-map-wrap">
      <div class="ops-map-bar">
        ${toggle("air", "✈", "Aircraft", flags.air)}
        ${toggle("police", "⚑", "Police", flags.police)}
        ${toggle("alpr", "⦿", "ALPR cams", flags.alpr)}
        ${toggle("cam", "◻", "Other cams", flags.cam)}
        ${toggle("me", "⌖", "You", flags.me)}
        <label class="ops-src" title="Police incident source">⚑
          <select id="opsRegion">
            ${Object.entries(SRC.usSources()).map(([k, v]) => `<option value="${k}" ${flags.region === k ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
            <option value="uk" ${flags.region === "uk" ? "selected" : ""}>UK (data.police.uk)</option>
          </select></label>
        <button class="t-btn sm" id="opsScanners" title="Live scanner audio feeds">📻 SCANNERS</button>
        <span class="ops-map-sp"></span>
        ${toggle("milOnly", "★", "Gov/police only", flags.milOnly, "alt")}
        <button class="t-btn sm" id="opsLocate" title="Centre on my location">⌖ LOCATE</button>
        <button class="t-btn sm" id="opsRefresh" title="Refresh now">⟲</button>
      </div>
      <div id="opsScanPanel" class="ops-scan-panel" hidden></div>
      <div id="opsMap" class="ops-map"></div>
      <div class="ops-map-foot"><span id="opsMapStat" class="mono">loading map…</span>
        <span class="ops-map-legend"><i class="lg air"></i>aircraft <i class="lg gov"></i>gov/police <i class="lg alpr"></i>ALPR <i class="lg cam"></i>CCTV <i class="lg inc"></i>incident</span></div>
    </div>`;

  function toggle(k, ic, lbl, on, cls) {
    return `<button class="ops-tg ${cls || ""} ${on ? "on" : ""}" data-tg="${k}" aria-pressed="${!!on}"><span class="i">${ic}</span>${esc(lbl)}</button>`;
  }

  const stat = el.querySelector("#opsMapStat");
  const setStat = m => { if (stat) stat.textContent = m; };
  let map = null, L = null, layers = {}, timer = null, dead = false, busy = false;

  const save = () => {
    if (!map) return;
    const c = map.getCenter();
    ctx.LS.set(KEY, { lat: c.lat, lon: c.lng, z: map.getZoom(), layers: flags });
  };

  loadLeaflet().then(_L => {
    if (dead) return;
    L = _L;
    map = L.map("opsMap", { preferCanvas: true, zoomControl: true, attributionControl: true }).setView([saved.lat, saved.lon], saved.z);
    // Resilient keyless basemap. NONE of these needs an API key. We try dark CARTO first and
    // auto-fail-over through the other free providers if tiles can't paint, so the map can never
    // be left grey. Non-dark providers (OSM) get a CSS "dark HUD" filter via .ops-dim so the look
    // stays consistent. (App CSP must allow these tile hosts in img-src — see installer notes.)
    const PROVIDERS = [
      { name: "Dark", dark: true, url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", opts: { subdomains: "abcd", maxZoom: 20 }, attr: "&copy; OpenStreetMap &copy; CARTO" },
      { name: "Dark Gray", dark: true, url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", opts: { maxZoom: 16 }, attr: "Tiles &copy; Esri" },
      { name: "Street", dark: false, url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", opts: { maxZoom: 19 }, attr: "&copy; OpenStreetMap" },
      { name: "Satellite", dark: true, url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", opts: { maxZoom: 19 }, attr: "Tiles &copy; Esri" },
    ];
    const mapEl = document.getElementById("opsMap");
    if (!document.getElementById("ops-tiles-css")) {
      const st = document.createElement("style"); st.id = "ops-tiles-css";
      st.textContent = ".ops-dim .leaflet-tile{filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.9) saturate(.75)}";
      document.head.appendChild(st);
    }
    let baseLayer = null, offErrs = 0, baseSwitches = 0;
    // offline / tiles-unreachable notice (matches the rest of the app's "unavailable · retry" states)
    const offEl = document.createElement("div");
    offEl.className = "ops-map-off"; offEl.hidden = true;
    offEl.innerHTML = `<div class="ops-map-off-in"><b>Map tiles can't load right now.</b><span>Check your connection.</span><button class="t-btn sm" id="opsMapRetry">⟲ Retry</button></div>`;
    if (mapEl) mapEl.appendChild(offEl);
    const showOff = on => { offEl.hidden = !on; };
    offEl.querySelector("#opsMapRetry").onclick = () => { offErrs = 0; baseSwitches = 0; showOff(false); try { if (baseLayer) baseLayer.redraw(); } catch (e) {} };
    const setBase = idx => {
      idx = ((idx % PROVIDERS.length) + PROVIDERS.length) % PROVIDERS.length;
      const p = PROVIDERS[idx];
      if (baseLayer) { try { map.removeLayer(baseLayer); } catch (e) {} }
      let errs = 0, loaded = 0, switched = false;
      const tl = L.tileLayer(p.url, Object.assign({ attribution: p.attr }, p.opts));
      tl.on("tileload", () => { loaded++; offErrs = 0; baseSwitches = 0; showOff(false); });
      // if a provider can't paint its first screenful, fall over to the next (never leave it grey) —
      // but only cycle through each provider once; if they all fail (offline / tile servers down),
      // stop cycling and show the retry notice instead of looping forever
      tl.on("tileerror", () => {
        errs++; offErrs++;
        if (!switched && errs >= 3 && loaded < 2 && baseSwitches < PROVIDERS.length) { switched = true; baseSwitches++; setBase(idx + 1); return; }
        // every provider has been tried (or lots of errors with nothing painted) → show the notice
        if (loaded < 1 && (baseSwitches >= PROVIDERS.length || offErrs >= 6)) showOff(true);
      });
      tl.addTo(map); baseLayer = tl;
      if (mapEl) mapEl.classList.toggle("ops-dim", !p.dark);
      const nm = el.querySelector("#opsBaseName"); if (nm) nm.textContent = p.name;
      flags.base = idx; save();
    };
    map._setBase = setBase; map._baseCount = PROVIDERS.length;
    setBase(typeof flags.base === "number" ? flags.base : 0);
    const canvas = L.canvas({ padding: 0.5 });
    layers = {
      air: L.layerGroup().addTo(flags.air ? map : L.layerGroup()),
      police: L.layerGroup(), alpr: L.layerGroup(), cam: L.layerGroup(), me: L.layerGroup(),
    };
    layers._canvas = canvas;
    Object.keys(layers).forEach(k => { if (flags[k]) layers[k].addTo(map); });

    map.on("moveend", () => { save(); scheduleRefresh(400); });
    setStat("ready");
    if (flags.me) locate(true);
    refresh();
    timer = setInterval(() => { if (!document.hidden && flags.air) refresh("air"); }, 15000);
  }).catch(e => setStat(String(e.message || e)));

  /* ---- wire toggles ---- */
  el.querySelectorAll(".ops-tg").forEach(b => b.onclick = () => {
    const k = b.dataset.tg; flags[k] = !flags[k];
    b.classList.toggle("on", flags[k]); b.setAttribute("aria-pressed", !!flags[k]);
    if (map && layers[k]) { flags[k] ? layers[k].addTo(map) : map.removeLayer(layers[k]); }
    if (k === "milOnly") refresh("air");
    if (k === "police" && flags.police) refresh("police");
    if ((k === "alpr" || k === "cam") && (flags.alpr || flags.cam)) refresh("cams");
    if (k === "me" && flags.me) locate(true);
    save();
  });
  el.querySelector("#opsRefresh").onclick = () => refresh();
  el.querySelector("#opsLocate").onclick = () => locate(false);
  el.querySelector("#opsRegion").onchange = e => { flags.region = e.target.value; save(); if (flags.police) refresh("police"); };

  /* ---- scanner feeds panel ---- */
  const scanPanel = el.querySelector("#opsScanPanel");
  scanPanel.innerHTML = `<div class="ops-scan-head">📻 Live scanner feeds<button class="ops-scan-x" id="opsScanX">✕</button></div>` +
    SRC.SCANNERS.map(g => `<div class="ops-scan-grp"><div class="ops-scan-reg">${esc(g.region)}</div>` +
      g.feeds.map(f => `<button class="ops-scan-feed" data-url="${esc(f.url)}">▸ ${esc(f.label)}</button>`).join("") + `</div>`).join("") +
    `<p class="ops-scan-note mono">Feeds open in your browser (Broadcastify / OpenMHz). Public safety audio is live but can lag ~30–60s.</p>`;
  el.querySelector("#opsScanners").onclick = () => { scanPanel.hidden = !scanPanel.hidden; };
  scanPanel.querySelector("#opsScanX").onclick = () => { scanPanel.hidden = true; };
  scanPanel.querySelectorAll(".ops-scan-feed").forEach(b => b.onclick = () => openExt(b.dataset.url));

  let refreshT = null;
  function scheduleRefresh(ms) { clearTimeout(refreshT); refreshT = setTimeout(() => refresh(), ms); }

  function locate(silent) {
    if (!navigator.geolocation) { if (!silent) toast("no geolocation here"); return; }
    navigator.geolocation.getCurrentPosition(p => {
      if (dead || !map) return;
      const { latitude: lat, longitude: lon } = p.coords;
      map.setView([lat, lon], Math.max(map.getZoom(), 12));
      drawMe(lat, lon);
      refresh();
    }, () => { if (!silent) toast("location unavailable"); }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  }
  function drawMe(lat, lon) {
    if (!map) return; layers.me.clearLayers();
    L.circleMarker([lat, lon], { renderer: layers._canvas, radius: 7, color: "#2f8cff", weight: 2, fillColor: "#2f8cff", fillOpacity: .9 })
      .bindPopup("You are here").addTo(layers.me);
    L.circle([lat, lon], { renderer: layers._canvas, radius: 250, color: "#2f8cff", weight: 1, fillOpacity: .05 }).addTo(layers.me);
  }

  /* ---- data refresh (what=undefined → everything) ---- */
  async function refresh(what) {
    if (!map || dead || busy) return;
    busy = true;
    const c = map.getCenter(), b = map.getBounds();
    const jobs = [];
    if ((!what || what === "air") && flags.air) jobs.push(doAir(c));
    if ((!what || what === "police") && flags.police) jobs.push(doPolice(c));
    if ((!what || what === "cams") && (flags.alpr || flags.cam)) jobs.push(doCams(b));
    try { await Promise.all(jobs); } finally { busy = false; }
  }

  async function doAir(c) {
    const nm = viewRadiusNm(map);
    const ac = await SRC.aircraft(http, c.lat, c.lng, nm);
    if (dead || !map) return;
    const show = flags.milOnly ? ac.filter(a => a.gov) : ac;
    const capped = show.slice(0, 350);
    layers.air.clearLayers();
    // drop last cycle's mirrored gov-aircraft markers from the police layer (keep incident dots)
    layers.police.eachLayer(l => { if (l._gov) layers.police.removeLayer(l); });
    // police/gov aircraft also feed the police layer so "Police only + hide aircraft" still shows them
    const govAir = [];
    capped.forEach(a => {
      const ic = L.divIcon({ className: "ops-plane", html: `<div style="transform:rotate(${a.track || 0}deg)">${planeSVG(a.gov, a.emg)}</div>`, iconSize: [22, 22] });
      const m = L.marker([a.lat, a.lon], { icon: ic });
      m.bindPopup(airPopup(a));
      m.addTo(layers.air);
      if (a.gov) govAir.push(a);
    });
    setStat(`${show.length} aircraft` + (flags.milOnly ? " (gov/police)" : "") + ` · ${new Date().toLocaleTimeString([], { hour12: false })}`);
    // mirror gov aircraft onto police layer as ⚑ markers
    if (flags.police) {
      govAir.forEach(a => { const m = L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "ops-govair", html: "⚑", iconSize: [16, 16] }) }); m._gov = true; m.bindPopup(airPopup(a)).addTo(layers.police); });
    }
  }
  function airPopup(a) {
    return `<b>${esc(a.flight)}</b>${a.gov ? ' <span class="pp-gov">GOV/POLICE</span>' : ""}${a.emg ? ' <span class="pp-emg">EMERGENCY</span>' : ""}<br>
      ${esc([a.type, a.reg].filter(Boolean).join(" · ") || "—")}<br>
      ${a.alt != null ? esc(a.alt + " ft") : "—"}${a.gs != null ? " · " + esc(a.gs + " kt") : ""}${a.sq ? " · sq " + esc(a.sq) : ""}`;
  }

  async function doPolice(c) {
    const b = map.getBounds();
    // US regions query a bbox (ArcGIS); UK queries a point radius (data.police.uk)
    const uk = flags.region === "uk";
    const inc = uk ? await SRC.policeUK(http, c.lat, c.lng)
      : await SRC.usIncidents(http, flags.region, [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    if (dead || !map) return;
    // remove only incident markers (they carry _inc), keep ⚑ aircraft markers
    layers.police.eachLayer(l => { if (l._inc) layers.police.removeLayer(l); });
    inc.slice(0, 800).forEach(p => {
      const m = L.circleMarker([p.lat, p.lon], { renderer: layers._canvas, radius: 5, color: "#ff7a3f", weight: 1, fillColor: "#ff7a3f", fillOpacity: .7 });
      m._inc = true;
      m.bindPopup(`<b>${esc(p.cat)}</b><br>${esc(p.street || "")}${p.outcome ? "<br>" + esc(p.outcome) : ""}${p.month ? "<br>" + esc(p.month) : ""}`);
      m.addTo(layers.police);
    });
    const label = uk ? "UK open data" : (SRC.usSources()[flags.region] || {}).label || "open data";
    if (inc.length) setStat(`${inc.length} police incidents in view (${label})`);
  }

  async function doCams(b) {
    const cams = await SRC.cameras(http, [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    if (dead || !map) return;
    layers.alpr.clearLayers(); layers.cam.clearLayers();
    let nA = 0, nC = 0;
    cams.forEach(cm => {
      const alpr = cm.kind === "alpr";
      const grp = alpr ? layers.alpr : layers.cam;
      const col = alpr ? "#ff3fb0" : "#9a6bff";
      const m = L.circleMarker([cm.lat, cm.lon], { renderer: layers._canvas, radius: alpr ? 6 : 4, color: col, weight: 1, fillColor: col, fillOpacity: .8 });
      m.bindPopup(`<b>${alpr ? "ALPR / plate reader" : "Surveillance camera"}</b>${cm.operator ? "<br>" + esc(cm.operator) : ""}${cm.dir ? "<br>dir " + esc(cm.dir) : ""}${cm.mount ? "<br>" + esc(cm.mount) : ""}<br><span class="pp-dim">OpenStreetMap</span>`);
      m.addTo(grp); alpr ? nA++ : nC++;
    });
    setStat(`${nA} ALPR · ${nC} other cameras in view`);
  }

  save();
  return () => { dead = true; clearInterval(timer); clearTimeout(refreshT); try { if (map) { save(); map.remove(); } } catch (e) {} };
}
