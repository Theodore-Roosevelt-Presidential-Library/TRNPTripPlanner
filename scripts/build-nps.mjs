// Pulls Theodore Roosevelt National Park data from the NPS API into data/nps.json.
//
//   node scripts/build-nps.mjs            full refresh (things to do, places, visitor centers, alerts)
//   node scripts/build-nps.mjs --alerts   alerts only (keeps everything else in data/nps.json)
//   node scripts/build-nps.mjs --from DIR build from saved API responses (DIR/thingstodo.json etc.)
//
// API key: NPS_API_KEY environment variable (GitHub Actions secret). Falls back to DEMO_KEY,
// which is rate-limited and fine only for occasional manual runs.
// Get a free key in a minute at https://www.nps.gov/subjects/developer/get-started.htm

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "nps.json");
const PARK = "thro";
const KEY = process.env.NPS_API_KEY || "DEMO_KEY";
const args = process.argv.slice(2);
const ALERTS_ONLY = args.includes("--alerts");
const FROM = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;

async function get(endpoint) {
  if (FROM) return JSON.parse(await readFile(path.join(FROM, endpoint + ".json"), "utf8"));
  const url = `https://developer.nps.gov/api/v1/${endpoint}?parkCode=${PARK}&limit=500&api_key=${KEY}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "TRPL-Labs-TripPlanner/1.0" } });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body.data)) return body;
    }
    console.warn(`${endpoint}: attempt ${attempt} failed (${res.status})`);
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
  throw new Error(`NPS API ${endpoint} failed`);
}

const clean = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "’")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const img = (images) => {
  const i = (images || [])[0];
  return i && i.url ? { url: i.url, credit: clean(i.credit), alt: clean(i.altText || i.title) } : null;
};
const num = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);

function alertsFrom(body) {
  return body.data.map((a) => ({
      id: a.id,
      title: clean(a.title),
      category: a.category,
      description: clean(a.description),
      url: a.url || "",
      updated: a.lastIndexedDate || "",
    }));
}

async function main() {
  let out = {};
  if (existsSync(OUT)) out = JSON.parse(await readFile(OUT, "utf8"));

  const alerts = alertsFrom(await get("alerts"));
  out.alerts = alerts;
  out.alertsUpdated = new Date().toISOString();

  if (!ALERTS_ONLY || !out.things) {
    const [things, places, vcs] = [await get("thingstodo"), await get("places"), await get("visitorcenters")];

    // Keep only what data/stops.json uses, so the page loads fast.
    const cfg = JSON.parse(await readFile(path.join(ROOT, "data", "stops.json"), "utf8"));
    const want = new Set(cfg.stops.flatMap((s) => [s.thing, s.place]).filter(Boolean));

    out.things = {};
    for (const t of things.data.filter((x) => want.has(x.id))) {
      out.things[t.id] = {
        title: clean(t.title),
        url: t.url,
        summary: clean(t.shortDescription),
        duration: t.duration || "",
        durationNote: clean(t.durationDescription),
        accessibility: clean(t.accessibilityInformation),
        pets: clean(t.petsDescription),
        lat: num(t.latitude),
        lon: num(t.longitude),
        image: img(t.images),
      };
    }

    out.places = {};
    for (const p of places.data.filter((x) => want.has(x.id))) {
      out.places[p.id] = {
        title: clean(p.title),
        url: p.url,
        summary: clean(p.listingDescription),
        amenities: p.amenities || [],
        lat: num(p.latitude),
        lon: num(p.longitude),
        image: img(p.images),
      };
    }

    out.visitorCenters = vcs.data.map((v) => ({
      id: v.id,
      name: clean(v.name),
      url: v.url,
      lat: num(v.latitude),
      lon: num(v.longitude),
      hours: (v.operatingHours || []).map((h) => ({
        name: clean(h.name),
        standard: h.standardHours || {},
        exceptions: (h.exceptions || []).map((e) => ({
          name: clean(e.name),
          start: e.startDate,
          end: e.endDate,
          hours: e.exceptionHours || {},
        })),
      })),
    }));
    out.updated = new Date().toISOString();
  }

  out.source = "National Park Service API (developer.nps.gov), park code thro";
  await writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(
    `nps.json: ${Object.keys(out.things || {}).length} things to do, ${Object.keys(out.places || {}).length} places, ` +
      `${(out.visitorCenters || []).length} visitor centers, ${alerts.length} alerts`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
