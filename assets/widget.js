/*!
 * Theodore Roosevelt National Park Trip Planner ("Got Two Hours?") \u2014 widget
 * Theodore Roosevelt Presidential Library Labs \u00b7 https://trnp-planner.labs.trlibrary.com
 *
 * Renders straight into the host page (no iframe). Loaded by embed.js, which also
 * loads planner.js, sun.js, Leaflet and planner.css. Mount with:
 *   TRNPPlanner.mount(element, { origin, from, time, title, stickyTop })
 */
(function () {
  "use strict";
  var P = window.TRPlanner;
  var AVAIL_URL = "https://ticketing.labs.trlibrary.com/data/availability.json";
  var TZ = "America/Denver";
  var UTM = "utm_source=trnp-planner&utm_medium=labs&utm_campaign=got-two-hours";
  var TIMES = [[90, "1\u00bd hrs"], [120, "2 hrs"], [180, "3 hrs"], [240, "4 hrs"], [360, "6 hrs"], [540, "All day"]];
  var HEAD = { 90: "An hour and a half in the park", 120: "Two hours in the park", 180: "Three hours in the park", 240: "Four hours in the park", 360: "Six hours in the park", 540: "A full day in the park" };
  var STARTING = { library: "starting at the Library", south: "starting at the South Unit", north: "starting at the North Unit", i94: "starting from I-94" };
  var KEYS = ["t", "from", "end", "day", "at", "acc", "must", "lib"];
  var dataCache = {};

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  function withUtm(u) { return u + (u.indexOf("?") === -1 ? "?" : "&") + UTM; }
  function denver(d) {
    var parts = {};
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d || new Date()).forEach(function (p) { parts[p.type] = p.value; });
    return { date: parts.year + "-" + parts.month + "-" + parts.day, min: (+parts.hour) * 60 + (+parts.minute) };
  }
  function addDays(dateStr, n) { var d = new Date(dateStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayName(dateStr, long) {
    return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric" });
  }
  function sunset(dateStr) {
    try { var d = denver(window.WWSun.times(new Date(dateStr + "T19:00:00Z"), 46.92, -103.53).sunset); return d.date === dateStr ? d.min : null; }
    catch (e) { return null; }
  }
  function isClosure(a) { return a.category === "Park Closure" || /\b(closed|closure|closes|impassable)\b/i.test(a.title); }
  function parseAt(s) {
    var m = /^(\d{1,2}):?(\d{2})?([ap])?/i.exec(s || "");
    if (!m) return null;
    var h = +m[1] % 12 + ((m[3] || "").toLowerCase() === "p" ? 12 : 0);
    if (!m[3] && +m[1] >= 12) h = +m[1];
    return h * 60 + (+m[2] || 0);
  }

  function loadData(origin) {
    if (dataCache[origin]) return dataCache[origin];
    dataCache[origin] = Promise.all([
      getJSON(origin + "/data/stops.json"), getJSON(origin + "/data/nps.json"), getJSON(origin + "/data/drive.json"),
      getJSON(AVAIL_URL).catch(function () { return null; }),
    ]).then(function (res) {
      var D = { cfg: res[0], nps: res[1], drive: res[2], avail: res[3] };
      D.ctx = P.buildContext(D.cfg, D.nps, D.drive);
      return D;
    });
    return dataCache[origin];
  }

  var SHELL =
    '<form class="tp-ask" onsubmit="return false">' +
    '<h2 class="tp-title">Got two hours?</h2>' +
    '<p class="tp-eyebrow tp-sub">Theodore Roosevelt National Park trip planner</p>' +
    '<div class="tp-field" role="group" aria-labelledby="{id}-t"><span class="tp-legend" id="{id}-t">How much time do you have in the park?</span><div class="tp-chips" data-q="time"></div></div>' +
    '<div class="tp-field" role="group" aria-labelledby="{id}-f"><span class="tp-legend" id="{id}-f">Where are you starting?</span><div class="tp-starts" data-q="from"></div></div>' +
    '<div class="tp-row3">' +
    '<label>Day <select data-q="day"></select></label>' +
    '<label>Start time <select data-q="at"></select></label>' +
    '<label>Finish <select data-q="end"><option value="start">Back where I started</option><option value="medora">In Medora</option><option value="i94">Back on I-94</option></select></label>' +
    "</div>" +
    '<label class="tp-check"><input type="checkbox" data-q="lib" checked> Start with the Theodore Roosevelt Presidential Library (plan on about 3\u00bd hours, before your park time)</label>' +
    '<label class="tp-check"><input type="checkbox" data-q="acc"> Wheelchair-accessible park stops only</label>' +
    "</form>" +
    '<div class="tp-alerts" data-out="alerts" hidden></div>' +
    '<div class="tp-result" data-out="result" aria-live="polite"><p class="tp-loading">Loading park data\u2026</p></div>' +
    '<div class="tp-sources">' +
    '<p>Park stops, photos, visitor center hours and alerts come from the <a href="https://www.nps.gov/subjects/developer/api-documentation.htm" target="_blank" rel="noopener">National Park Service</a><span data-out="stamp"></span>. Library entry times come from the Library\'s ticketing system. Drive times use <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> roads plus a 10% cushion for park roads and wildlife.</p>' +
    '<p>Roads and trails change with the weather. Check <a href="https://www.nps.gov/thro/planyourvisit/conditions.htm" target="_blank" rel="noopener">current park conditions</a> before you go. Times are Mountain Time; the North Unit runs on Central Time.</p>' +
    "</div>";

  var n = 0;
  function mount(root, opts) {
    if (!root || root.getAttribute("data-tp-mounted")) return;
    root.setAttribute("data-tp-mounted", "1");
    opts = opts || {};
    var origin = (opts.origin || "https://trnp-planner.labs.trlibrary.com").replace(/\/$/, "");
    var id = "tp" + ++n;
    root.classList.add("tp");
    if (opts.title === "off") root.classList.add("tp-notitle");
    if (opts.stickyTop != null) root.style.setProperty("--tp-sticky", opts.stickyTop + "px");
    root.innerHTML = SHELL.replace(/\{id\}/g, id);
    var $ = function (s) { return root.querySelector(s); };
    var q = function (k) { return root.querySelector('[data-q="' + k + '"]'); };
    var out = function (k) { return root.querySelector('[data-out="' + k + '"]'); };
    var D, days = [], state = {}, map = null, touched = false;
    var params = new URLSearchParams(location.search);

    function buildDays() {
      var now = denver();
      var src = D.avail && D.avail.days ? D.avail.days.filter(function (d) { return d.date >= now.date; }) : [];
      if (!src.length) for (var i = 0; i < 8; i++) src.push({ date: addDays(now.date, i) });
      days = src.map(function (d) {
        var label = d.date === now.date ? "Today, " + dayName(d.date) : d.date === addDays(now.date, 1) ? "Tomorrow, " + dayName(d.date) : dayName(d.date);
        return { date: d.date, closed: !!d.closed, label: label };
      });
      q("day").innerHTML = days.map(function (d) { return '<option value="' + d.date + '">' + esc(d.label + (d.closed ? " (Library closed)" : "")) + "</option>"; }).join("");
      var h = "";
      for (var m = 6 * 60; m <= 20 * 60; m += 15) h += '<option value="' + m + '">' + P.fmtClock(m) + "</option>";
      q("at").innerHTML = h;
    }
    function defaultStart() {
      var now = denver(), today = P.libraryDay(D.avail, now.date);
      var lastSlot = today && today.slots && today.slots.length ? P.hhmm(today.slots[today.slots.length - 1].time) : 15 * 60;
      if ((today && today.closed) || now.min > lastSlot - 15) {
        var next = days.filter(function (d) { return d.date > now.date && !d.closed; })[0];
        return { day: next ? next.date : addDays(now.date, 1), at: 9 * 60 };
      }
      return { day: now.date, at: Math.max(9 * 60, Math.ceil((now.min + 5) / 15) * 15) };
    }
    function readState() {
      var def = defaultStart();
      var t = +(params.get("t") || opts.time);
      state.t = TIMES.some(function (x) { return x[0] === t; }) ? t : 120;
      var from = params.get("from") || opts.from;
      state.from = D.cfg.starts.some(function (s) { return s.id === from; }) ? from : "library";
      state.end = ["start", "medora", "i94"].indexOf(params.get("end")) !== -1 ? params.get("end") : state.from === "i94" ? "i94" : "start";
      var day = params.get("day");
      state.day = days.some(function (d) { return d.date === day; }) ? day : def.day;
      var at = parseAt(params.get("at"));
      state.at = at != null && at >= 360 && at <= 1200 ? Math.round(at / 15) * 15 : (state.day === def.day ? def.at : 9 * 60);
      state.acc = params.get("acc") === "1";
      state.lib = params.get("lib") !== "0";
      state.must = params.get("must") ? params.get("must").split(",") : [];
    }
    function syncForm() {
      q("time").innerHTML = TIMES.map(function (t) {
        return '<button type="button" class="tp-chip" data-t="' + t[0] + '" aria-pressed="' + (state.t === t[0]) + '">' + t[1] + "</button>";
      }).join("");
      q("from").innerHTML = D.cfg.starts.map(function (s) {
        return '<button type="button" class="tp-start" data-from="' + s.id + '" aria-pressed="' + (state.from === s.id) + '"><b>' + esc(s.label) + "</b><span>" + esc(s.sub) + "</span></button>";
      }).join("");
      q("day").value = state.day; q("at").value = String(state.at); q("end").value = state.end; q("acc").checked = !!state.acc; q("lib").checked = state.lib;
    }
    // Keeps the plan in the page URL (other query params, like utm tags, are left alone).
    function syncUrl() {
      try {
        var u = new URL(location.href);
        KEYS.forEach(function (k) { u.searchParams.delete(k); });
        u.searchParams.set("t", state.t); u.searchParams.set("from", state.from);
        if (state.end !== (state.from === "i94" ? "i94" : "start")) u.searchParams.set("end", state.end);
        u.searchParams.set("day", state.day);
        u.searchParams.set("at", P.fmtClock(state.at).replace(/[ .]/g, "").replace("am", "a").replace("pm", "p"));
        if (state.acc) u.searchParams.set("acc", "1");
        if (!state.lib) u.searchParams.set("lib", "0");
        if (state.must && state.must.length) u.searchParams.set("must", state.must.join(","));
        history.replaceState(history.state, "", u.pathname + u.search + u.hash);
      } catch (e) {}
    }

    function stamp() {
      var t = D.nps && (D.nps.alertsUpdated || D.nps.updated);
      return t ? "From the National Park Service, checked " + new Date(t).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " MT." : "";
    }
    function renderAlerts() {
      var a = (D.nps && D.nps.alerts) || [], box = out("alerts");
      box.hidden = false;
      if (!a.length) { box.innerHTML = "<b>No park alerts right now.</b> <span class=\"tp-stamp\">" + stamp() + "</span>"; return; }
      box.innerHTML = "<details" + (a.some(isClosure) ? " open" : "") + "><summary>Today's park alerts (" + a.length + ")</summary><ul>" +
        a.map(function (x) {
          return '<li class="' + (isClosure(x) ? "tp-closure" : "") + '"><b>' + esc(x.title) + "</b> " + esc(x.description) +
            (x.url ? ' <a href="' + esc(x.url) + '" target="_blank" rel="noopener">More</a>' : "") + "</li>";
        }).join("") + '</ul><p class="tp-stamp">' + stamp() + "</p></details>";
    }

    function stopCard(s, when) {
      var img = s.image ? '<div class="tp-ph" style="background-image:url(\'' + esc(s.image.url) + '\')" role="img" aria-label="' + esc(s.image.alt) + '"></div>' : '<div class="tp-ph"></div>';
      var tags = [];
      if (s.parking.length) tags.push("Parking: " + s.parking.join(", ").replace("Bus/RV", "bus/RV").replace("Auto", "cars"));
      if (s.restroom) tags.push("Restroom");
      if (s.accessible) tags.push("Wheelchair accessible");
      if (s.unit === "north") tags.push("Central Time zone");
      return '<div class="tp-stop">' + img + '<div class="tp-in"><h3>' + esc(s.name) + "</h3>" +
        '<div class="tp-dur">' + when + (s.npsDuration ? " \u00b7 NPS suggests " + esc(s.npsDuration.toLowerCase()) : "") + "</div>" +
        (s.blurb ? "<p>" + esc(s.blurb) + "</p>" : "") +
        (s.tr ? '<p class="tp-tr">' + esc(s.tr) + "</p>" : "") +
        (tags.length ? '<div class="tp-tags">' + tags.map(function (t) { return '<span class="tp-tag">' + esc(t) + "</span>"; }).join("") + "</div>" : "") +
        (s.tip ? '<div class="tp-note">' + esc(s.tip) + "</div>" : "") +
        s.alerts.map(function (a) { return '<div class="tp-note"><b>Park alert:</b> ' + esc(a.title) + "</div>"; }).join("") +
        '<div class="tp-more">' + (s.npsUrl ? '<a href="' + esc(s.npsUrl) + '" target="_blank" rel="noopener">NPS details</a>' : "") +
        (s.link ? '<a href="' + esc(s.link.url) + '" target="_blank" rel="noopener">' + esc(s.link.label) + "</a>" : "") + "</div>" +
        (s.image && s.image.credit ? '<div class="tp-credit">Photo: ' + esc(s.image.credit) + "</div>" : "") +
        "</div></div>";
    }
    function libraryCard(it) {
      var lib = D.cfg.library, tickets = withUtm((D.avail && D.avail.ticketsUrl) || lib.ticketsUrl), entry;
      if (it.slot) {
        var lbl = P.fmtClock(it.slot.min);
        var few = it.slot.status === "limited" || (it.slot.remaining != null && it.slot.remaining <= 20);
        entry = "<span>Timed entry <b>" + esc(lbl) + "</b>" + (few ? " \u00b7 only " + it.slot.remaining + " left" : "") + "</span>" +
          '<a class="tp-btn tp-alt" href="' + esc(tickets) + '" target="_blank" rel="noopener">Reserve ' + esc(lbl) + " entry</a>";
      } else {
        entry = "<span>Reserve a timed-entry ticket before you go.</span>" + '<a class="tp-btn tp-alt" href="' + esc(tickets) + '" target="_blank" rel="noopener">Get tickets</a>';
      }
      return '<div class="tp-stop tp-library"><div class="tp-in"><div class="tp-eyebrow">Start here</div><h3>' + esc(lib.name) + "</h3>" +
        '<div class="tp-dur">' + P.fmtClock(it.time) + "\u2013" + P.fmtClock(it.end) + " \u00b7 " + P.fmtDur(it.minutes) + "</div>" +
        "<p>" + esc(lib.blurb) + "</p>" +
        '<div class="tp-small">' + esc(lib.address) + "</div>" +
        '<div class="tp-entry">' + entry + "</div></div></div>";
    }

    function render() {
      var input = { minutes: state.t, from: state.from, end: state.end, date: state.day, start: state.at, sunset: sunset(state.day), accessible: !!state.acc, must: state.must || [], library: state.lib };
      var r = P.plan(D, input), res = out("result");
      if (touched) syncUrl();
      if (!r.ok) { res.innerHTML = problem(r); clearMap(); return; }
      var cashless = (D.nps.alerts || []).some(function (a) { return /cashless/i.test(a.title); });
      var k = 0;
      var rows = r.items.map(function (it) {
        var when = '<div class="tp-when">' + P.fmtClock(it.time) + "</div>";
        if (it.type === "start" || it.type === "end") return '<li class="tp-tl tp-pin">' + when + '<div class="tp-dot"></div><div class="tp-body">' + esc(it.label) + "</div></li>";
        if (it.type === "drive") return '<li class="tp-tl tp-leg">' + when + '<div class="tp-dot"></div><div class="tp-body">Drive ' + P.fmtDur(it.minutes) + " \u00b7 " + it.miles + " mi to " + esc(it.to) +
          (it.firstInPark ? "<br>National park entrance fee applies" + (cashless ? " (cards and digital payments only)" : "") + ". Watch for bison and horses on the road." : "") + "</div></li>";
        if (it.type === "wait") return '<li class="tp-tl tp-wait">' + when + '<div class="tp-dot"></div><div class="tp-body">' + P.fmtDur(it.minutes) + " until your entry time</div></li>";
        if (it.type === "library") return '<li class="tp-tl tp-lib">' + when + '<div class="tp-dot">TR</div><div class="tp-body">' + libraryCard(it) + "</div></li>";
        k++;
        return '<li class="tp-tl">' + when + '<div class="tp-dot">' + k + '</div><div class="tp-body">' +
          stopCard(it.stop, P.fmtClock(it.time) + "\u2013" + P.fmtClock(it.end) + " \u00b7 " + P.fmtDur(it.minutes)) + "</div></li>";
      }).join("");

      var ps = r.stops.length;
      var facts = ["<b>" + ps + "</b> park stop" + (ps === 1 ? "" : "s")];
      if (r.withLibrary) facts.push("<b>Library</b> " + P.fmtDur(r.libraryMinutes));
      facts.push("<b>Driving</b> " + P.fmtDur(r.driveMinutes), "<b>Done by</b> " + P.fmtClock(r.finish));
      var tickets = withUtm((D.avail && D.avail.ticketsUrl) || D.cfg.library.ticketsUrl);
      var html = '<div class="tp-summary"><div><div class="tp-eyebrow">' + esc(dayName(state.day, true)) + " \u00b7 " + esc(!state.lib && state.from === "library" ? "starting in Medora" : STARTING[state.from]) + (state.lib ? " \u00b7 Library first" : " \u00b7 park only") + "</div><h2>" + esc(HEAD[state.t] || "Your plan") +
        '</h2><div class="tp-facts">' + facts.map(function (f) { return "<span>" + f + "</span>"; }).join("") + "</div></div>" +
        '<div class="tp-actions"><a class="tp-btn" href="' + esc(r.mapsUrl) + '" target="_blank" rel="noopener">Directions</a>' +
        (r.withLibrary ? '<a class="tp-btn tp-alt" href="' + esc(tickets) + '" target="_blank" rel="noopener">Library tickets</a>' : "") +
        '<button class="tp-btn tp-ghost" type="button" data-act="copy">Copy link</button>' +
        '<button class="tp-btn tp-ghost" type="button" data-act="print">Print</button></div></div>';
      html += '<div class="tp-layout"><div><ol class="tp-timeline">' + rows + "</ol>";
      if (r.spare >= 10) html += '<p class="tp-spare">' + P.fmtDur(r.spare) + " to spare. Linger wherever the view holds you.</p>";
      if (!ps) html += '<p class="tp-spare">No park stops fit in that time. Pick more park time to add some.</p>';
      if (r.warnings.length) html += '<p class="tp-spare">' + r.warnings.map(esc).join(" ") + "</p>";
      html += altPlan(r, input);
      html += '</div><div class="tp-mapbox"><div class="tp-map" role="region" aria-label="Map of the route"></div><div class="tp-mapnote">Stops in order, joined by straight lines. Use Directions for turn-by-turn.</div></div></div>';
      res.innerHTML = html;
      try { drawMap(r); } catch (e) { var mb = $(".tp-mapbox"); if (mb) mb.style.display = "none"; if (window.console) console.error("TRNP planner map", e); }
    }

    function altPlan(r, input) {
      if (state.must && state.must.length) return '<div class="tp-altplan"><div><b>Roosevelt day</b>This plan includes the Elkhorn Ranch.</div><button class="tp-btn tp-ghost" type="button" data-act="unmust">Back to the standard plan</button></div>';
      if (state.t < 360 || r.has("elkhorn")) return "";
      var elk = D.ctx.stops.filter(function (s) { return s.id === "elkhorn"; })[0];
      if (!elk || elk.closed) return "";
      var alt = P.plan(D, Object.assign({}, input, { must: ["elkhorn"] }));
      if (!alt.ok || !alt.has("elkhorn")) return "";
      return '<div class="tp-altplan"><div><b>Make it a Roosevelt day</b>Trade some of the park stops for the Elkhorn Ranch, the home ranch Roosevelt built on the Little Missouri River.</div><button class="tp-btn" type="button" data-act="elkhorn">Show that plan</button></div>';
    }

    function problem(r) {
      var dname = dayName(state.day, true), btns = "", msg = "", head = "";
      var dayBtns = days.filter(function (d) { return d.date > state.day && !d.closed; }).slice(0, 2)
        .map(function (d) { return '<button class="tp-btn" type="button" data-day="' + d.date + '">' + esc(d.label) + "</button>"; }).join("");
      var parkOnly = '<button class="tp-btn tp-ghost" type="button" data-lib="0">Plan the park only</button>';
      if (r.reason === "closed") { head = "The Library is closed that day"; msg = "The Library is closed on " + dname + ". Pick another day, or plan a park-only route."; btns = dayBtns + parkOnly; }
      else if (r.reason === "noentry" || r.reason === "closing") { head = "Library entries are done for the day"; msg = "The last Library entry on " + dname + " comes before you'd arrive. Try an earlier start, another day, or a park-only route."; btns = dayBtns + parkOnly; }
      else if (r.reason === "soldout") { head = "The Library is sold out for the rest of the day"; msg = "The remaining Library entry times on " + dname + " are sold out. Try another day, or plan a park-only route."; btns = dayBtns + parkOnly; }
      else if (r.reason === "short") {
        head = "Not quite enough time";
        var fit = TIMES.filter(function (t) { return t[0] >= r.needMinutes + 30; })[0];
        msg = "The drive back to " + ({ start: "where you started", medora: "Medora", i94: "I-94" })[state.end] + " alone takes about " + P.fmtDur(r.needMinutes) + ". Pick more park time" + (state.end === "start" && state.from === "north" ? " or finish in Medora." : ".");
        if (fit) btns = '<button class="tp-btn" type="button" data-t="' + fit[0] + '">Plan ' + fit[1] + "</button>";
        if (state.end === "start" && state.from !== "library") btns += '<button class="tp-btn tp-ghost" type="button" data-end="medora">Finish in Medora instead</button>';
      }
      return '<div class="tp-problem"><h2>' + esc(head) + "</h2><p>" + msg + '</p><div class="tp-actions">' + btns +
        '<a class="tp-btn tp-ghost" href="' + esc(withUtm(D.cfg.library.visitUrl)) + '" target="_blank" rel="noopener">Hours and tickets</a></div></div>';
    }

    function clearMap() { if (map) { map.remove(); map = null; } }
    function drawMap(r) {
      clearMap();
      var el = $(".tp-map");
      var L = window.TPLeaflet || window.L;
      if (!L || typeof L.map !== "function" || !el) { if (el) el.parentNode.style.display = "none"; return; }
      map = L.map(el, { scrollWheelZoom: false });
      L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 16, attribution: 'Tiles: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
      }).addTo(map);
      var nodes = D.cfg.nodes, lib = D.cfg.library, pts = [], seen = {};
      var startNode = D.cfg.starts.filter(function (s) { return s.id === state.from; })[0].node;
      var icon = function (cls, txt) { return L.divIcon({ className: "", html: '<div class="tp-mk ' + cls + '">' + (txt || "") + "</div>", iconSize: null }); };
      if (startNode !== "library") { pts.push([nodes[startNode].lat, nodes[startNode].lon]); L.marker(pts[0], { icon: icon("tp-mk-pin"), title: "Start" }).addTo(map); }
      pts.push([lib.lat, lib.lon]);
      L.marker([lib.lat, lib.lon], { icon: icon("tp-mk-lib", "TR"), title: lib.name, zIndexOffset: 1000 }).addTo(map).bindPopup("<b>" + esc(lib.name) + "</b><br>Start here");
      r.stops.forEach(function (s, i) {
        pts.push([s.lat, s.lon]);
        var key = s.lat.toFixed(4) + s.lon.toFixed(4), c = seen[key] || 0;
        seen[key] = c + 1;
        L.marker([s.lat + 0.0012 * c, s.lon + 0.0018 * c], { icon: icon("", i + 1), title: s.name }).addTo(map).bindPopup("<b>" + (i + 1) + ". " + esc(s.name) + "</b>");
      });
      var en = nodes[r.endNode]; pts.push([en.lat, en.lon]);
      if (r.endNode !== "library" && r.endNode !== startNode) L.marker([en.lat, en.lon], { icon: icon("tp-mk-pin"), title: "Finish" }).addTo(map);
      L.polyline(pts, { color: "#C9653F", weight: 3, opacity: 0.8, dashArray: "6 7" }).addTo(map);
      map.fitBounds(L.latLngBounds(pts).pad(0.12));
    }

    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-t],[data-from],[data-day],[data-end],[data-act],[data-lib]");
      if (!b || !root.contains(b)) return;
      if (b.dataset.t) state.t = +b.dataset.t;
      if (b.dataset.from) { state.from = b.dataset.from; if (state.from === "i94") state.end = "i94"; else if (state.end === "i94") state.end = "start"; }
      if (b.dataset.day) state.day = b.dataset.day;
      if (b.dataset.end) state.end = b.dataset.end;
      if (b.dataset.lib) state.lib = b.dataset.lib !== "0";
      var act = b.dataset.act;
      if (act === "copy") {
        var done = function () { b.textContent = "Link copied"; setTimeout(function () { b.textContent = "Copy link"; }, 1800); };
        syncUrl();
        if (navigator.clipboard) navigator.clipboard.writeText(location.href.split("#")[0]).then(done, done); else done();
        return;
      }
      if (act === "print") { window.print(); return; }
      touched = true;
      if (act === "elkhorn") state.must = ["elkhorn"];
      if (act === "unmust" || state.t < 360) state.must = act === "elkhorn" ? state.must : [];
      syncForm(); render();
    });
    root.addEventListener("change", function (e) {
      if (!e.target.dataset || !e.target.dataset.q) return;
      touched = true;
      state.day = q("day").value; state.at = +q("at").value; state.end = q("end").value; state.acc = q("acc").checked; state.lib = q("lib").checked;
      render();
    });

    loadData(origin).then(function (data) {
      D = data;
      if (D.nps.updated) out("stamp").textContent = " (park data updated " + new Date(D.nps.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ")";
      buildDays(); readState(); syncForm(); renderAlerts(); render();
    }).catch(function (err) {
      out("result").innerHTML = '<div class="tp-problem"><h2>Something went wrong</h2><p>The planner couldn\'t load park data. Refresh to try again, or see <a href="https://www.trlibrary.com/visit/national-park">trlibrary.com/visit/national-park</a>.</p></div>';
      if (window.console) console.error(err);
    });
  }

  window.TRNPPlanner = { mount: mount };
})();
