// Spy Tools — live data sources. All free, no API keys. Fetches go through ctx.http
// (window.TURD_HTTP in the native apps = CORS-free; plain fetch in a browser) so the
// native builds reach these even when a provider sends no CORS header. Each fetcher
// returns a normalised shape and resolves to [] on any failure, so a dead provider
// never breaks the map.
//
// AIRCRAFT  adsb.fi + airplanes.live open feeds (public ADS-B, free, ~1 req/s)
// POLICE    data.police.uk street incidents (UK, open data) + gov/police aircraft
//           flagged out of the aircraft feed by military dbFlag + callsign/type
// CAMERAS   OpenStreetMap surveillance nodes via Overpass — the same man_made=surveillance
//           / surveillance:type=ALPR tags DeFlock publishes (ALPR cams) plus general CCTV

const J = async (http, url, opts) => {
  const r = await http(url, Object.assign({ headers: { accept: "application/json" } }, opts || {}));
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
};
const num = v => (typeof v === "number" && isFinite(v)) ? v : null;
// first non-empty value among candidate keys (case-insensitive) of an object
const firstOf = (o, keys) => {
  const low = {}; Object.keys(o || {}).forEach(k => { low[k.toLowerCase()] = o[k]; });
  for (const k of keys) { const v = low[k.toLowerCase()]; if (v != null && v !== "") return v; }
  return "";
};
const fmtDate = v => {
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------------ aircraft */
// callsign/type hints that mark an aircraft as law-enforcement / government even when
// the military dbFlag is not set (UK police air support, US agencies, common heli types).
const GOV_CALL = /^(POL|NPAS|HLE|PLOD|SHERIFF|POLICE|CBP|DHS|CUSTOM|USCG|COAST|GUARD|FBI|ATF|DEA|MARSHAL|LASD|LAPD|NYPD|CHP|FOX|HAWK|EAGLE|SPECTR|REACH|RCH|SAM|VENUS|GRZLY|OMAHA)/i;
const GOV_TYPE = /^(EC35|EC45|EC30|AS35|AS32|A109|A119|B06|B407|B429|H125|H135|H145|MD50|MD52|R44|R66|C208|PC12|C182|C206)$/i;

function normAircraft(raw) {
  const out = [];
  (raw || []).forEach(a => {
    const lat = num(a.lat), lon = num(a.lon);
    if (lat == null || lon == null) return;
    const flight = String(a.flight || a.r || a.hex || "").trim();
    const type = String(a.t || "").trim();
    const mil = (a.dbFlags & 1) === 1 || a.dbFlags === 1;
    const gov = mil || GOV_CALL.test(flight) || (type && GOV_TYPE.test(type) && /HELI|POL/i.test(flight));
    out.push({
      id: a.hex || flight, flight: flight || "—", type: type || "",
      reg: a.r || "", lat, lon,
      alt: num(a.alt_baro) ?? num(a.alt_geom),
      gs: num(a.gs), track: num(a.track) ?? num(a.true_heading),
      sq: a.squawk || "", mil, gov,
      // emergency / special squawks worth surfacing
      emg: a.squawk === "7700" || a.squawk === "7600" || a.squawk === "7500",
    });
  });
  return out;
}

// radius in nautical miles (both providers cap around 250nm)
export async function aircraft(http, lat, lon, nm) {
  nm = Math.min(250, Math.max(1, Math.round(nm || 60)));
  const tries = [
    `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${nm}`,
    `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nm}`,
  ];
  for (const url of tries) {
    try {
      const j = await J(http, url);
      const ac = normAircraft(j.ac || j.aircraft || []);
      if (ac.length || j.ac) return ac;
    } catch (e) { /* try next provider */ }
  }
  return [];
}

/* -------------------------------------------------------------------- police */
// UK Police open data — street-level incidents near a point (last available month).
// US/other regions have no single free national feed, so this covers UK addresses and
// the map additionally flags police/gov aircraft from the ADS-B layer everywhere.
export async function policeUK(http, lat, lon) {
  try {
    const j = await J(http, `https://data.police.uk/api/crimes-street/all-crime?lat=${lat.toFixed(4)}&lng=${lon.toFixed(4)}`);
    return (j || []).map(c => ({
      id: c.persistent_id || c.id,
      cat: String(c.category || "incident").replace(/-/g, " "),
      lat: num(c.location && +c.location.latitude),
      lon: num(c.location && +c.location.longitude),
      street: (c.location && c.location.street && c.location.street.name) || "",
      month: c.month || "",
      outcome: (c.outcome_status && c.outcome_status.category) || "",
    })).filter(c => c.lat != null && c.lon != null);
  } catch (e) { return []; }
}
// has UK police open data for this point? (used to decide whether to show the incident layer)
export async function policeCoverage(http, lat, lon) {
  try {
    const j = await J(http, `https://data.police.uk/api/locate-neighbourhood?q=${lat.toFixed(4)},${lon.toFixed(4)}`);
    return !!(j && j.force);
  } catch (e) { return false; }
}

/* --------------------------------------------------------------- US incidents */
// US police incident open data, by region. ArcGIS REST FeatureServer layers (free, no key,
// CORS-enabled, bbox-queryable). Memphis MPD covers the owner's nearest metro (Memphis TN,
// just across the line from north MS). Field names vary per portal, so each entry lists
// candidate label/street/date fields and we take the first that's present.
const US_SOURCES = {
  memphis: {
    label: "Memphis (MPD)",
    url: "https://services2.arcgis.com/saWmpKJIUAjyyNVc/arcgis/rest/services/MPD_Public_Safety_Incidents/FeatureServer/0",
    catFields: ["Category", "Crime_Category", "UCR_Category", "offense", "Offense", "CrimeType", "crime_type", "CALL_TYPE", "Description", "Agency"],
    streetFields: ["Block_Address", "Address", "Street", "Location", "ADDR", "BlockAddress"],
    dateFields: ["Reported_Date", "Occurred_Date", "Offense_Date", "Incident_Date", "Date"],
  },
};
export function usSources() { return US_SOURCES; }

export async function usIncidents(http, key, bbox) {
  const src = US_SOURCES[key] || US_SOURCES.memphis;
  // bbox=[south,west,north,east]; ArcGIS envelope = xmin,ymin,xmax,ymax = west,south,east,north
  const env = [bbox[1], bbox[0], bbox[3], bbox[2]].map(n => n.toFixed(5)).join(",");
  const u = src.url + "/query?f=geojson&where=1%3D1&outFields=*&outSR=4326&returnGeometry=true" +
    "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects" +
    "&geometry=" + encodeURIComponent(env) + "&resultRecordCount=1500";
  try {
    const j = await J(http, u);
    return (j.features || []).map(f => {
      const g = f.geometry, p = f.properties || {};
      const lon = num(g && g.coordinates && g.coordinates[0]);
      const lat = num(g && g.coordinates && g.coordinates[1]);
      if (lat == null || lon == null) return null;
      const when = firstOf(p, src.dateFields);
      return {
        id: p.OBJECTID || (lat + "," + lon),
        cat: String(firstOf(p, src.catFields) || "incident").toLowerCase().replace(/_/g, " "),
        lat, lon, street: String(firstOf(p, src.streetFields) || ""),
        month: when ? fmtDate(when) : "", outcome: "",
      };
    }).filter(Boolean);
  } catch (e) { return []; }
}

/* --------------------------------------------------------------- scanner feeds */
// Public scanner-audio feeds for the owner's area (MS/TN). Broadcastify feed pages open in
// the system browser (their live player is free on the site). Kept as curated links rather
// than hotlinked streams. Region-tagged so the panel can group them.
export const SCANNERS = [
  {
    region: "Memphis / Shelby County, TN", feeds: [
      { label: "Memphis PD + Shelby Co. Sheriff", url: "https://www.broadcastify.com/listen/feed/215" },
      { label: "Shelby County Public Safety", url: "https://www.broadcastify.com/listen/feed/44691" },
      { label: "All Shelby County feeds", url: "https://www.broadcastify.com/listen/ctid/2506" },
    ]
  },
  {
    region: "DeSoto County, MS", feeds: [
      { label: "DeSoto County public safety", url: "https://www.broadcastify.com/listen/ctid/1413/publicsafety" },
      { label: "All DeSoto County feeds", url: "https://www.broadcastify.com/listen/ctid/1413" },
    ]
  },
  {
    region: "Browse / elsewhere", feeds: [
      { label: "Broadcastify — by location", url: "https://www.broadcastify.com/listen/" },
      { label: "OpenMHz — live trunked systems", url: "https://openmhz.com/" },
    ]
  },
];

/* ------------------------------------------------------------------- cameras */
// OSM surveillance nodes via Overpass. kind:"alpr" = the Flock/ALPR plate readers DeFlock
// maps (surveillance:type=ALPR); kind:"cam" = general fixed CCTV / traffic cameras.
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
export async function cameras(http, bbox) {
  // bbox = [south, west, north, east]
  const bb = bbox.map(n => n.toFixed(4)).join(",");
  const q = `[out:json][timeout:25];(` +
    `node["man_made"="surveillance"](${bb});` +
    `way["man_made"="surveillance"](${bb});` +
    `);out center 1200 tags;`;
  for (const ep of OVERPASS) {
    try {
      const j = await J(http, ep + "?data=" + encodeURIComponent(q));
      const out = [];
      (j.elements || []).forEach(e => {
        const lat = num(e.lat ?? (e.center && e.center.lat));
        const lon = num(e.lon ?? (e.center && e.center.lon));
        if (lat == null || lon == null) return;
        const t = e.tags || {};
        const stype = (t["surveillance:type"] || "").toLowerCase();
        const alpr = stype === "alpr" || /alpr|anpr|plate|flock/i.test(t.operator || "") || /alpr|anpr/i.test(t.manufacturer || "");
        out.push({
          id: e.type[0] + e.id, lat, lon,
          kind: alpr ? "alpr" : "cam",
          operator: t.operator || t.manufacturer || "",
          dir: t.direction || t["camera:direction"] || "",
          mount: t["surveillance:zone"] || t.surveillance || t["camera:mount"] || "",
        });
      });
      return out;
    } catch (e) { /* try next mirror */ }
  }
  return [];
}
