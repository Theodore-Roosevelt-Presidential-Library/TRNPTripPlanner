/*!
 * Got Two Hours? — route engine
 * Theodore Roosevelt Presidential Library · trnp-planner.labs.trlibrary.com
 *
 * Pure functions, no DOM. Works in the browser (window.TRPlanner) and in Node (module.exports).
 * Every plan starts at the Library, then fills the rest of the time with the
 * best-value National Park stops that fit, using NPS data and today's alerts.
 */
(function (root) {
  "use strict";

  var DRIVE_BUFFER = 1.1; // +10% over routed time: park speed limits, bison jams, photo stops
  var PARK_SHARE = 0.5; // share of the time after arrival that goes to the Library (bounded by min/ideal)
  var DAYLIGHT_GRACE = 15; // minutes after sunset an outdoor stop may still end

  // ---------- small helpers ----------
  function ceil5(m) { return m <= 0 ? 0 : Math.max(5, Math.ceil(m / 5) * 5); }
  function round15(m) { return Math.round(m / 15) * 15; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function hhmm(str) { var p = String(str).split(":"); return (+p[0]) * 60 + (+p[1] || 0); }
  function fmtClock(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60) % 24, m = min % 60, ap = h >= 12 ? "p.m." : "a.m.";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }
  function fmtDur(min) {
    min = Math.round(min);
    if (min < 60) return min + " min";
    var h = Math.floor(min / 60), m = min % 60;
    return h + " hr" + (m ? " " + m + " min" : "");
  }
  function parseClock(s) { // "9:00AM" -> minutes
    var m = /(\d{1,2}):(\d{2})\s*([AP])M/i.exec(s || "");
    if (!m) return null;
    var h = (+m[1]) % 12 + (m[3].toUpperCase() === "P" ? 12 : 0);
    return h * 60 + (+m[2]);
  }
  var DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  function weekday(dateStr) { return DAYS[new Date(dateStr + "T12:00:00Z").getUTCDay()]; }

  // Visitor center hours for a date, in Mountain Time minutes. null = closed or unknown.
  function vcHours(vc, dateStr, tzShift) {
    if (!vc || !vc.hours || !vc.hours.length) return null;
    var day = weekday(dateStr), h = vc.hours[0], text = (h.standard || {})[day];
    (h.exceptions || []).forEach(function (e) {
      if (e.start <= dateStr && dateStr <= e.end && e.hours && e.hours[day]) text = e.hours[day];
    });
    if (!text || /closed/i.test(text)) return null;
    var parts = text.split("-");
    var open = parseClock(parts[0]), close = parseClock(parts[1]);
    if (open == null || close == null) return null;
    return { open: open - (tzShift || 0), close: close - (tzShift || 0), text: text };
  }

  // ---------- data prep ----------
  function buildContext(cfg, nps, drive) {
    var idx = {};
    drive.ids.forEach(function (id, i) { idx[id] = i; });
    function drv(a, b) {
      if (a === b) return 0;
      return ceil5(drive.minutes[idx[a]][idx[b]] * DRIVE_BUFFER);
    }
    function miles(a, b) { return a === b ? 0 : drive.miles[idx[a]][idx[b]]; }

    var alerts = (nps && nps.alerts) || [];
    var stops = cfg.stops.map(function (s) {
      var t = s.thing && nps.things ? nps.things[s.thing] : null;
      var p = s.place && nps.places ? nps.places[s.place] : null;
      var amen = (p && p.amenities) || [];
      var node = cfg.nodes[s.node] || {};
      var hay = function (a) { return (a.title + " " + a.description).toLowerCase(); };
      var related = alerts.filter(function (a) {
        if (a.category === "Information") return false; // general notices stay in the park-wide list
        return (s.keys || []).some(function (k) { return hay(a).indexOf(k) !== -1; });
      });
      var closing = s.ignoreAlerts ? [] : related.filter(function (a) {
        return a.category === "Park Closure" || /\b(closed|closure|closes|impassable)\b/i.test(a.title);
      });
      return {
        id: s.id,
        name: s.name,
        node: s.node,
        unit: s.unit,
        minutes: s.minutes,
        score: s.score,
        outdoor: !!s.outdoor,
        needsVC: s.needsVC || null,
        after: s.after || null,
        lat: (p && p.lat) || (t && t.lat) || node.lat,
        lon: (p && p.lon) || (t && t.lon) || node.lon,
        blurb: s.blurb || (t && t.summary) || (p && p.summary) || "",
        tr: s.tr || "",
        tip: s.tip || "",
        link: s.link || null,
        npsUrl: (t && t.url) || (p && p.url) || "",
        npsDuration: (t && t.duration) || "",
        image: (t && t.image) || (p && p.image) || null,
        parking: amen.filter(function (a) { return /^Parking/.test(a); }).map(function (a) { return a.replace("Parking - ", ""); }),
        restroom: amen.some(function (a) { return /Restroom|Toilet/.test(a); }),
        accessible: amen.indexOf("Wheelchair Accessible") !== -1,
        alerts: related,
        closed: !!s.closed || closing.length > 0,
        closedNote: s.closedNote || (closing[0] ? closing[0].title : ""),
      };
    });
    var vcs = {};
    ((nps && nps.visitorCenters) || []).forEach(function (v) { vcs[v.name] = v; });
    return { cfg: cfg, drv: drv, miles: miles, stops: stops, vcs: vcs, alerts: alerts };
  }

  // ---------- Library entry ----------
  function libraryDay(avail, dateStr) {
    if (!avail || !avail.days) return null;
    for (var i = 0; i < avail.days.length; i++) if (avail.days[i].date === dateStr) return avail.days[i];
    return null;
  }

  // Finds when a visitor arriving at `arrive` can get in. Slots are 30-minute windows.
  function libraryEntry(day, arrive, lib) {
    if (!day) return { known: false, entry: arrive, close: null };
    if (day.closed || !day.slots || !day.slots.length) return { known: true, closedDay: true };
    var slots = day.slots.map(function (s) { return { min: hhmm(s.time), label: s.label, status: s.status, remaining: s.remaining }; });
    var last = slots[slots.length - 1].min;
    var close = last + (lib.lastEntryBeforeClose || 90);
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (s.status !== "available" && s.status !== "limited") continue;
      if (s.min + 30 <= arrive) continue; // this window has passed by the time you arrive
      return { known: true, slot: s, entry: Math.max(arrive, s.min), close: close, firstSlot: slots[0].min, lastSlot: last };
    }
    return { known: true, noSlot: true, close: close, firstSlot: slots[0].min, lastSlot: last, soldOut: slots.some(function (s) { return s.status === "sold_out" && s.min + 30 > arrive; }) };
  }

  // ---------- route scheduling ----------
  // Walks a sequence of stops leaving the Library at `t`, returns timing or null if a rule breaks.
  function schedule(ctx, seq, t, endNode, deadline, opts) {
    var at = "library", rows = [], prev = null, done = {};
    for (var i = 0; i < seq.length; i++) {
      var s = seq[i];
      if (s.after && (!prev || prev.id !== s.after)) return null;
      // stops that share a parking spot stay together
      if (s.node !== at && done[s.node]) return null;
      done[at] = true;
      var d = ctx.drv(at, s.node);
      var arrive = t + d, leave = arrive + s.minutes;
      if (s.needsVC) {
        var h = opts.vcHours[s.needsVC];
        if (!h || arrive < h.open || leave > h.close) return null;
      }
      if (s.outdoor && opts.sunset != null && leave > opts.sunset + DAYLIGHT_GRACE) return null;
      rows.push({ stop: s, drive: d, from: at, arrive: arrive, leave: leave });
      t = leave; at = s.node; prev = s;
    }
    var back = ctx.drv(at, endNode);
    if (t + back > deadline) return null;
    return { rows: rows, finish: t + back, back: back, last: at };
  }

  // Moves single stops to cheaper positions until the route stops getting shorter.
  function tighten(ctx, route, cur, t, endNode, deadline, opts) {
    var better = true, guard = 0;
    while (better && guard++ < 50) {
      better = false;
      for (var i = 0; i < route.length; i++) {
        var s = route[i], rest = route.slice(0, i).concat(route.slice(i + 1));
        for (var j = 0; j <= rest.length; j++) {
          if (j === i) continue;
          var tr = rest.slice(0, j).concat([s], rest.slice(j));
          var sc = schedule(ctx, tr, t, endNode, deadline, opts);
          if (sc && sc.finish < cur.finish) { route = tr; cur = sc; better = true; break; }
        }
        if (better) break;
      }
    }
    return { route: route, cur: cur };
  }

  // Exact shortest drive order over the route's parking spots (Held-Karp; routes are small).
  function bestOrder(ctx, route, t, endNode, deadline, opts, cur) {
    var nodes = [], groups = {};
    route.forEach(function (s) {
      if (!groups[s.node]) { groups[s.node] = []; nodes.push(s.node); }
      groups[s.node].push(s);
    });
    var n = nodes.length;
    if (n < 3 || n > 14) return { route: route, cur: cur };
    var FULL = 1 << n, INF = 1e9, dp = new Array(FULL * n), par = new Int16Array(FULL * n);
    for (var i = 0; i < dp.length; i++) dp[i] = INF;
    for (var a = 0; a < n; a++) dp[(1 << a) * n + a] = ctx.drv("library", nodes[a]);
    for (var m = 1; m < FULL; m++) for (var j = 0; j < n; j++) {
      var v = dp[m * n + j]; if (v >= INF) continue;
      for (var k = 0; k < n; k++) if (!(m & (1 << k))) {
        var m2 = m | (1 << k), c = v + ctx.drv(nodes[j], nodes[k]);
        if (c < dp[m2 * n + k]) { dp[m2 * n + k] = c; par[m2 * n + k] = j; }
      }
    }
    var bestJ = -1, bestC = INF, last = FULL - 1;
    for (var e = 0; e < n; e++) { var c2 = dp[last * n + e] + ctx.drv(nodes[e], endNode); if (c2 < bestC) { bestC = c2; bestJ = e; } }
    var order = [], mm = last, jj = bestJ;
    while (jj >= 0 && order.length < n) { order.unshift(nodes[jj]); var pj = par[mm * n + jj]; mm &= ~(1 << jj); jj = mm ? pj : -1; }
    var tr = [];
    order.forEach(function (nd) {
      var g = groups[nd].slice().sort(function (x, y) { return (x.after === y.id) - (y.after === x.id); });
      tr = tr.concat(g);
    });
    var sc = schedule(ctx, tr, t, endNode, deadline, opts);
    return sc && sc.finish <= cur.finish ? { route: tr, cur: sc } : { route: route, cur: cur };
  }

  function pickStops(ctx, cands, t, endNode, deadline, opts, must) {
    var route = [], cur = schedule(ctx, route, t, endNode, deadline, opts);
    if (!cur) return null;
    var pool = cands.slice();
    (must || []).forEach(function (id) {
      for (var k = 0; k < pool.length; k++) if (pool[k].id === id) {
        var s = pool[k], placed = false;
        for (var pos = 0; pos <= route.length && !placed; pos++) {
          var tr = route.slice(0, pos).concat([s], route.slice(pos));
          var sc = schedule(ctx, tr, t, endNode, deadline, opts);
          if (sc) { route = tr; cur = sc; placed = true; }
        }
        if (placed) pool.splice(k, 1);
        break;
      }
    });
    for (var round = 0; round < 3; round++) {
    var before = route.length;
    // Greedy cheapest-value insertion.
    for (;;) {
      var best = null;
      for (var c = 0; c < pool.length; c++) {
        var s = pool[c];
        for (var pos = 0; pos <= route.length; pos++) {
          var trial = route.slice(0, pos).concat([s], route.slice(pos));
          var sc = schedule(ctx, trial, t, endNode, deadline, opts);
          if (!sc) continue;
          var added = Math.max(1, sc.finish - cur.finish);
          var val = s.score / Math.pow(added, 0.85);
          if (!best || val > best.val) best = { val: val, seq: trial, sc: sc, c: c };
        }
      }
      if (!best) break;
      route = best.seq; cur = best.sc; pool.splice(best.c, 1);
      var tt = tighten(ctx, route, cur, t, endNode, deadline, opts); route = tt.route; cur = tt.cur;
    }
    // Swap pass: trade a picked stop for a better unpicked one when it still fits.
    var improved = true, guard = 0;
    while (improved && guard++ < 20) {
      improved = false;
      for (var r = 0; r < route.length && !improved; r++) {
        for (var u = 0; u < pool.length && !improved; u++) {
          if (pool[u].score <= route[r].score) continue;
          var without = route.slice(0, r).concat(route.slice(r + 1));
          for (var p2 = 0; p2 <= without.length; p2++) {
            var tr = without.slice(0, p2).concat([pool[u]], without.slice(p2));
            var sc2 = schedule(ctx, tr, t, endNode, deadline, opts);
            if (sc2) {
              var out = route[r]; route = tr; cur = sc2; pool.splice(u, 1, out);
              improved = true; break;
            }
          }
        }
      }
    }
    var bo = bestOrder(ctx, route, t, endNode, deadline, opts, cur); route = bo.route; cur = bo.cur;
    if (route.length === before && round > 0) break;
    }
    cur.route = route;
    return cur;
  }

  // ---------- main ----------
  function plan(data, input) {
    var ctx = data.ctx || buildContext(data.cfg, data.nps, data.drive);
    var cfg = ctx.cfg, lib = cfg.library;
    var startDef = cfg.starts.filter(function (s) { return s.id === input.from; })[0] || cfg.starts[0];
    var fromNode = startDef.node;
    var endNode = input.end === "medora" ? "suvc" : input.end === "i94" ? "i94" : fromNode;
    if (endNode === "suvc" && fromNode === "library" && input.end !== "medora") endNode = "library";
    var T = input.minutes, t0 = input.start, deadline = t0 + T;
    var res = { input: input, ok: false, warnings: [], items: [], parkAlerts: ctx.alerts, startLabel: startDef.label, endNode: endNode };

    var toLib = ctx.drv(fromNode, "library");
    var arrive = t0 + toLib;
    var day = libraryDay(data.avail, input.date);
    var ent = libraryEntry(day, arrive, lib);
    res.library = ent;
    res.libraryDay = day;

    if (ent.closedDay) { res.reason = "closed"; return res; }
    if (ent.noSlot) { res.reason = ent.soldOut ? "soldout" : "noentry"; return res; }

    var back = ctx.drv("library", endNode);
    var room = deadline - ent.entry - back;
    var L = clamp(round15(room * PARK_SHARE), lib.minMinutes, lib.idealMinutes);
    if (ent.close != null) L = Math.min(L, ent.close - ent.entry);
    if (room < lib.minMinutes) {
      if (room >= 45 && (ent.close == null || ent.close - ent.entry >= 45)) {
        L = Math.min(room, ent.close == null ? room : ent.close - ent.entry);
        res.warnings.push("That leaves time for a quick Library visit only. The usual visit runs about two hours.");
      } else {
        res.reason = "short";
        res.needMinutes = (ent.entry - t0) + lib.minMinutes + back;
        return res;
      }
    }
    if (L < 45) { res.reason = "closing"; return res; }

    var leaveLib = ent.entry + L;
    var vcHoursMap = {};
    Object.keys(ctx.vcs).forEach(function (name) {
      vcHoursMap[name] = vcHours(ctx.vcs[name], input.date, /North Unit/.test(name) ? 60 : 0);
    });
    var opts = { sunset: input.sunset, vcHours: vcHoursMap };
    var cands = ctx.stops.filter(function (s) {
      if (s.closed) return false;
      if (input.accessible && !s.accessible) return false;
      return true;
    });
    var route = pickStops(ctx, cands, leaveLib, endNode, deadline, opts, input.must);
    // Give leftover time back to the Library, up to the usual two-hour visit.
    if (route) {
      var spare = deadline - route.finish, cap = Math.max(L, lib.idealMinutes);
      if (ent.close != null) cap = Math.min(cap, ent.close - ent.entry);
      var extra = Math.floor(Math.min(spare, cap - L) / 5) * 5;
      if (extra >= 5) {
        var re = schedule(ctx, route.route, leaveLib + extra, endNode, deadline, opts);
        if (re) { L += extra; leaveLib += extra; re.route = route.route; route = re; }
      }
    }
    if (!route) { // not even the drive home fits after the Library; shorten the Library visit
      L = Math.max(45, deadline - back - ent.entry);
      leaveLib = ent.entry + L;
      route = { rows: [], finish: leaveLib + back, back: back, last: "library" };
    }

    // ---------- build the itinerary ----------
    var nodeLabel = function (n) { return (cfg.nodes[n] && cfg.nodes[n].label) || n; };
    var items = res.items;
    items.push({ type: "start", time: t0, label: startDef.id === "library" ? "Start at the Library" : "Start at " + nodeLabel(fromNode) });
    if (toLib) items.push({ type: "drive", time: t0, minutes: toLib, miles: ctx.miles(fromNode, "library"), to: "the Library" });
    if (ent.entry > arrive) items.push({ type: "wait", time: arrive, minutes: ent.entry - arrive });
    items.push({ type: "library", time: ent.entry, minutes: L, end: ent.entry + L, slot: ent.slot || null, known: ent.known });
    var unitsSeen = {};
    route.rows.forEach(function (r) {
      if (r.drive) items.push({ type: "drive", time: r.arrive - r.drive, minutes: r.drive, miles: ctx.miles(r.from, r.stop.node), to: r.stop.name, firstInPark: !unitsSeen[r.stop.unit] && (r.stop.unit === "south" || r.stop.unit === "north") });
      unitsSeen[r.stop.unit] = true;
      items.push({ type: "stop", time: r.arrive, minutes: r.stop.minutes, end: r.leave, stop: r.stop });
    });
    if (route.back) items.push({ type: "drive", time: route.finish - route.back, minutes: route.back, miles: ctx.miles(route.last, endNode), to: nodeLabel(endNode) });
    items.push({ type: "end", time: route.finish, label: endNode === "library" ? "Back at the Library" : "Arrive at " + nodeLabel(endNode) });

    res.ok = true;
    res.libraryMinutes = L;
    res.finish = route.finish;
    res.spare = deadline - route.finish;
    res.stops = route.rows.map(function (r) { return r.stop; });
    res.driveMinutes = items.filter(function (i) { return i.type === "drive"; }).reduce(function (a, i) { return a + i.minutes; }, 0);
    res.hasNorth = res.stops.some(function (s) { return s.unit === "north"; });
    res.inPark = res.stops.some(function (s) { return s.unit === "south" || s.unit === "north" || s.unit === "elkhorn"; });
    res.skipped = ctx.stops.filter(function (s) { return s.closed; });
    res.has = function (id) { return res.stops.some(function (s) { return s.id === id; }); };

    // Directions link (Google Maps takes up to 9 waypoints).
    var pts = [lib].concat(res.stops.filter(function (s, i, a) { return !i || a[i - 1].node !== s.node; }));
    var ll = function (o) { return o.lat.toFixed(5) + "," + o.lon.toFixed(5); };
    var origin = cfg.nodes[fromNode], dest = cfg.nodes[endNode];
    var wps = (fromNode === "library" ? pts.slice(1) : pts).slice(0, 9);
    res.mapsUrl = "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + encodeURIComponent(ll(origin)) +
      "&destination=" + encodeURIComponent(ll(dest)) + (wps.length ? "&waypoints=" + encodeURIComponent(wps.map(ll).join("|")) : "");
    return res;
  }

  var api = { plan: plan, buildContext: buildContext, vcHours: vcHours, fmtClock: fmtClock, fmtDur: fmtDur, hhmm: hhmm, libraryDay: libraryDay };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TRPlanner = api;
})(this);
