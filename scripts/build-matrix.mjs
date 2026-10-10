// Builds data/drive.json: drive times (minutes) and distances (miles) between every
// node in data/stops.json, from the public OSRM router (OpenStreetMap roads).
// Run after adding or moving a stop:  node scripts/build-matrix.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(await readFile(path.join(ROOT, "data", "stops.json"), "utf8"));
const ids = Object.keys(cfg.nodes);
const coords = ids.map((id) => `${cfg.nodes[id].lon},${cfg.nodes[id].lat}`).join(";");
const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`;
const res = await fetch(url, { headers: { "User-Agent": "TRPL-Labs-TripPlanner/1.0" } });
if (!res.ok) throw new Error(`OSRM ${res.status}`);
const d = await res.json();
if (d.code !== "Ok") throw new Error(`OSRM ${d.code}`);
const out = {
  source: "OSRM (router.project-osrm.org) over OpenStreetMap roads. Raw drive times; the planner adds a buffer.",
  built: new Date().toISOString().slice(0, 10),
  ids,
  minutes: d.durations.map((r) => r.map((v) => Math.round((v / 60) * 10) / 10)),
  miles: d.distances.map((r) => r.map((v) => Math.round((v / 1609.344) * 10) / 10)),
};
await writeFile(path.join(ROOT, "data", "drive.json"), JSON.stringify(out) + "\n");
console.log(`drive.json: ${ids.length} nodes`);
