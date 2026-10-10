# Theodore Roosevelt National Park Trip Planner ("Got Two Hours?")

Pick how much time you have for the park and where you're starting (the Library, the South Unit, the North Unit, or I-94). By default the route **starts with the full Theodore Roosevelt Presidential Library visit (about 3½ hours, the Library's own guidance)**, then fills the park time with Theodore Roosevelt National Park stops from the NPS "things to do" and places data, with their durations, parking and today's park alerts. A Theodore Roosevelt Presidential Library Labs tool.

**Live:** https://trnp-planner.labs.trlibrary.com (GitHub Pages)

## How a plan is built

0. The time picked is park time. "Start with the Library" (on by default, `lib=0` turns it off) adds the full Library visit before it; with it off the route is park-only.
1. Drive from the starting point to the Library.
2. Find the first open timed-entry slot at or after arrival (live from `ticketing.labs.trlibrary.com/data/availability.json`). Closed days, sold-out afternoons and "too late today" each get their own message with a next-day button.
3. Library time: the full visit, `library.visitMinutes` in `data/stops.json` (210). If the Library closes sooner, the plan says so and suggests starting earlier; it never presents a shortened visit as complete.
4. Park stops: picks the best-value stops that fit (score ÷ added time), swaps in higher-scoring stops when they fit, then orders them by the shortest drive. It respects:
   - visitor center hours from the NPS API (Maltese Cross Cabin and the film need the South Unit Visitor Center open; North Unit hours are converted from Central Time)
   - sunset (outdoor stops end by sunset + 15 min)
   - closures: an NPS alert with "closed / closure / impassable" in the title (or category "Park Closure") that names a stop pulls it from every plan
   - the "Finish" choice (back where you started, Medora, or I-94)
5. Six-hour and all-day plans offer a "Roosevelt day" alternative that includes the Elkhorn Ranch.

Drive times are OSRM routes over OpenStreetMap roads plus a 10% cushion, rounded up to 5 minutes.

## Files

| File | What it is |
|---|---|
| `embed.js` | The loader. Draws the planner straight into any page (no iframe): loads Leaflet, `planner.css`, `sun.js`, `planner.js` and `widget.js`, then mounts every `[data-trnp-planner]` element |
| `assets/widget.js`, `assets/planner.css` | The planner UI. All styles are scoped under `.tp` and prefixed `tp-`, so the host theme can't restyle it and it can't restyle the host |
| `assets/planner.js` | Route engine (no DOM; runs in Node for testing) |
| `index.html`, `assets/page.css` | The standalone page at trnp-planner.labs.trlibrary.com (uses `embed.js` like any other host) |
| `data/stops.json` | Curated stops: NPS ids, minutes at each stop, score, notes, links. **Edit this to change what the planner recommends.** |
| `data/nps.json` | Pulled from the NPS API: descriptions, photos, durations, amenities (parking, restrooms, accessibility), visitor center hours, alerts |
| `data/drive.json` | Drive-time matrix between every stop |
| `scripts/build-nps.mjs` | Refreshes `data/nps.json` (`--alerts` for alerts only) |
| `scripts/build-matrix.mjs` | Rebuilds `data/drive.json` after adding or moving a stop |

### Common edits

- **Pull a stop by hand** (e.g., road work NPS hasn't posted): in `data/stops.json` add `"closed": true, "closedNote": "Reason"` to the stop.
- **An alert is wrongly closing a stop:** add `"ignoreAlerts": true` to that stop.
- **Favor a stop more or less:** change its `score` (1–10).
- **Add a stop:** add it to `stops` and `nodes` in `data/stops.json` with its NPS `thing` and/or `place` id, then run `node scripts/build-matrix.mjs` and `node scripts/build-nps.mjs`.

## Embedding

```html
<div data-trnp-planner></div>
<script src="https://trnp-planner.labs.trlibrary.com/embed.js" async></script>
```

It renders directly in the page, not in an iframe. Optional: `data-from="i94"` (library, south, north, i94), `data-time="240"` (90, 120, 180, 240, 360, 540), `data-title="off"` (hide the planner's own heading), `data-sticky-top="110"` (keep the map clear of a fixed site header).

After someone changes the plan, the planner writes it into the host page's address bar (`?t=…&from=…`, leaving other parameters such as utm tags alone), so Copy link shares the exact plan on that page. Bump `V` in `embed.js` after changing `widget.js`, `planner.js` or `planner.css` so browsers pick up the new files. The same instructions are at the bottom of the tool: https://trnp-planner.labs.trlibrary.com/#embed

Shareable links carry the plan (on the labs page or any page that embeds it): `?t=120&from=i94&day=2026-10-11&at=10:00a`. Ticket links carry `utm_source=trnp-planner&utm_medium=labs&utm_campaign=got-two-hours` so Library visits from the planner show up in GA4.

## Setup checklist

1. **NPS API key** (free, instant): https://www.nps.gov/subjects/developer/get-started.htm → repo Settings → Secrets and variables → Actions → New secret `NPS_API_KEY`. Without it the refresh falls back to `DEMO_KEY`, which is rate-limited and will miss hourly runs.
2. **Workflow:** `.github/workflows/refresh-nps.yml` refreshes alerts hourly and everything else daily. If the file didn't land in `.github/`, copy it from `docs/`: `mkdir -p .github/workflows && cp docs/refresh-nps.yml .github/workflows/`
3. Settings → Actions → General → Workflow permissions: **Read and write**.
4. Settings → Pages: deploy from `main`, root folder. Custom domain `trnp-planner.labs.trlibrary.com` (`CNAME` included); enforce HTTPS. The `*.labs.trlibrary.com` wildcard DNS already points at GitHub Pages.

Hero photo: Wind Canyon, NPS Photo/W. Archer (public domain). Swap in an Acquia DAM photo of the Library by replacing `assets/hero-wind-canyon.jpg` and the credit line in `index.html`.
