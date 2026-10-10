/*!
 * Got Two Hours? — Theodore Roosevelt Presidential Library Labs
 * https://trnp-planner.labs.trlibrary.com
 */
(function () {
  "use strict";
  var P = window.TRPlanner;
  var $ = function (s) { return document.querySelector(s); };
  var params = new URLSearchParams(location.search);
  var EMBED = params.get("embed") === "1";
  var AVAIL_URL = "https://ticketing.labs.trlibrary.com/data/availability.json";
  var TZ = "America/Denver";
  var UTM = "utm_source=trnp-planner&utm_medium=labs&utm_campaign=got-two-hours";
  var TIMES = [[90, "1½ hrs"], [120, "2 hrs"], [180, "3 hrs"], [240, "4 hrs"], [360, "6 hrs"], [540, "All day"]];
  var HEAD = { 90: "Your hour and a half", 120: "Your two hours", 180: "Your three hours", 240: "Your four hours", 360: "Your six hours", 540: "Your day" };

  var D = {}, days = [], state = {}, map = null, layer = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  function withUtm(u) { return u + (u.indexOf("?") === -1 ? "?" : "&") + UTM; }

  // Current date and minute-of-day in Medora (Mountain Time).
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
    try {
      var s = window.WWSun.times(new Date(dateStr + "T19:00:00Z"), 46.92, -103.53).sunset;
      var d = denver(s); return d.date === dateStr ? d.min : null;
    } catch (e) { return null; }
  }

  // ---------- form ----------
  function buildDays() {
    var now = denver();
    var src = D.avail && D.avail.days ? D.avail.days.filter(function (d) { return d.date >= now.date; }) : [];
    if (!src.length) for (var i = 0; i < 8; i++) src.push({ date: addDays(now.date, i) });
    days = src.map(function (d) {
      var label = d.date === now.date ? "Today, " + dayName(d.date) : d.date === addDays(now.date, 1) ? "Tomorrow, " + dayName(d.date) : dayName(d.date);
      return { date: d.date, closed: !!d.closed, label: label };
    });
    $("#q-day").innerHTML = days.map(function (d) {
      return '<option value="' + d.date + '">' + esc(d.label + (d.closed ? " (Library closed)" : "")) + "</option>";
    }).join("");
  }
  function buildTimes() {
    var h = "";
    for (var m = 6 * 60; m <= 20 * 60; m += 15) h += '<option value="' + m + '">' + P.fmtClock(m) + "</option>";
    $("#q-at").innerHTML = h;
  }
  function defaultStart() {
    var now = denver(), today = P.libraryDay(D.avail, now.date);
    var lastSlot = today && today.slots && today.slots.length ? P.hhmm(today.slots[today.slots.length - 1].time) : 15 * 60;
    if (today && today.closed || now.min > lastSlot - 15) {
      var next = days.filter(function (d) { return d.date > now.date && !d.closed; })[0];
      return { day: next ? next.date : addDays(now.date, 1), at: 9 * 60 };
    }
    return { day: now.date, at: Math.max(9 * 60, Math.ceil((now.min + 5) / 15) * 15) };
  }
  function syncForm() {
    $("#q-time").innerHTML = TIMES.map(function (t) {
      return '<button type="button" class="chip" data-t="' + t[0] + '" aria-pressed="' + (state.t === t[0]) + '">' + t[1] + "</button>";
    }).join("");
    $("#q-from").innerHTML = D.cfg.starts.map(function (s) {
      return '<button type="button" class="start" data-from="' + s.id + '" aria-pressed="' + (state.from === s.id) + '"><b>' + esc(s.label) + "</b><span>" + esc(s.sub) + "</span></button>";
    }).join("");
    $("#q-day").value = state.day;
    $("#q-at").value = String(state.at);
    $("#q-end").value = state.end;
    $("#q-acc").checked = !!state.acc;
  }

  // ---------- rendering ----------
  function libraryBlurb(L) {
    if (L >= 105) return "Exhibits, the boardwalk and rooftop views over Medora and the badlands. See Roosevelt's story first, then go see the land that shaped him.";
    if (L >= 75) return "The exhibits and a walk out on the roof for the view. See Roosevelt's story first, then go see the land that shaped him.";
    return "The exhibit highlights. Most visitors spend about two hours, so come back if you can.";
  }

  function renderAlerts() {
    var a = (D.nps && D.nps.alerts) || [];
    var box = $("#alerts");
    if (!a.length) { box.hidden = false; box.innerHTML = '<b>No park alerts right now.</b> <span class="stamp">' + stamp() + "</span>"; return; }
    box.hidden = false;
    box.innerHTML = '<details' + (a.some(isClosure) ? " open" : "") + '><summary>Today\'s park alerts (' + a.length + ')</summary><ul>' +
      a.map(function (x) {
        return '<li class="' + (isClosure(x) ? "closure" : "") + '"><b>' + esc(x.title) + "</b> " + esc(x.description) +
          (x.url ? ' <a href="' + esc(x.url) + '" target="_blank" rel="noopener">More</a>' : "") + "</li>";
      }).join("") + '</ul><p class="stamp">' + stamp() + "</p></details>";
  }
  function isClosure(a) { return a.category === "Park Closure" || /\b(closed|closure|closes|impassable)\b/i.test(a.title); }
  function stamp() {
    var t = D.nps && (D.nps.alertsUpdated || D.nps.updated);
    if (!t) return "";
    return "From the National Park Service, checked " + new Date(t).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " MT.";
  }

  function stopCard(s, n) {
    var img = s.image ? '<div class="ph" style="background-image:url(\'' + esc(s.image.url) + '\')" role="img" aria-label="' + esc(s.image.alt) + '"></div>' : '<div class="ph"></div>';
    var tags = [];
    if (s.parking.length) tags.push("Parking: " + s.parking.join(", ").replace("Bus/RV", "bus/RV").replace("Auto", "cars"));
    if (s.restroom) tags.push("Restroom");
    if (s.accessible) tags.push("Wheelchair accessible");
    if (s.unit === "north") tags.push("Central Time zone");
    var alertNotes = s.alerts.map(function (a) { return '<div class="note"><b>Park alert:</b> ' + esc(a.title) + "</div>"; }).join("");
    return '<div class="stop">' + img + '<div class="in"><h3>' + esc(s.name) + "</h3>" +
      '<div class="dur">{{when}}' + (s.npsDuration ? " · NPS suggests " + esc(s.npsDuration.toLowerCase()) : "") + "</div>" +
      (s.blurb ? "<p>" + esc(s.blurb) + "</p>" : "") +
      (s.tr ? '<p class="tr">' + esc(s.tr) + "</p>" : "") +
      (tags.length ? '<div class="tags">' + tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>" : "") +
      (s.tip ? '<div class="note">' + esc(s.tip) + "</div>" : "") + alertNotes +
      '<div class="more">' + (s.npsUrl ? '<a href="' + esc(s.npsUrl) + '" target="_blank" rel="noopener">NPS details</a>' : "") +
      (s.link ? '<a href="' + esc(s.link.url) + '" target="_blank" rel="noopener">' + esc(s.link.label) + "</a>" : "") + "</div>" +
      (s.image && s.image.credit ? '<div class="credit">Photo: ' + esc(s.image.credit) + "</div>" : "") +
      "</div></div>";
  }

  function libraryCard(it, r) {
    var lib = D.cfg.library, tickets = withUtm((D.avail && D.avail.ticketsUrl) || lib.ticketsUrl), entry = "";
    if (it.slot) {
      var left = it.slot.status === "limited" || (it.slot.remaining != null && it.slot.remaining <= 20);
      var slotLabel = P.fmtClock(it.slot.min);
      entry = "<span>Timed entry <b>" + esc(slotLabel) + "</b>" + (left ? " · only " + it.slot.remaining + " left" : "") + "</span>" +
        '<a class="btn alt" href="' + esc(tickets) + '" target="_blank" rel="noopener">Reserve ' + esc(slotLabel) + " entry</a>";
    } else {
      entry = "<span>Reserve a timed-entry ticket before you go.</span>" + '<a class="btn alt" href="' + esc(tickets) + '" target="_blank" rel="noopener">Get tickets</a>';
    }
    return '<div class="stop library"><div class="in"><div class="eyebrow" style="color:var(--sunset)">Start here</div><h3>' + esc(lib.name) + "</h3>" +
      '<div class="dur">' + P.fmtClock(it.time) + "–" + P.fmtClock(it.end) + " · " + P.fmtDur(it.minutes) + "</div>" +
      "<p>" + esc(libraryBlurb(it.minutes)) + "</p>" +
      '<div class="small">' + esc(lib.address) + "</div>" +
      '<div class="entry">' + entry + "</div></div></div>";
  }

  function render() {
    var input = { minutes: state.t, from: state.from, end: state.end, date: state.day, start: state.at, sunset: sunset(state.day), accessible: !!state.acc, must: state.must || [] };
    var r = P.plan(D, input);
    var out = $("#result");
    if (!r.ok) { out.innerHTML = problem(r); clearMap(); post(); return; }

    var cashless = (D.nps.alerts || []).some(function (a) { return /cashless/i.test(a.title); });
    var n = 0, rows = r.items.map(function (it) {
      if (it.type === "start" || it.type === "end") return '<li class="tl pin"><div class="when">' + P.fmtClock(it.time) + '</div><div class="dot"></div><div class="body">' + esc(it.label) + "</div></li>";
      if (it.type === "drive") return '<li class="tl leg"><div class="when">' + P.fmtClock(it.time) + '</div><div class="dot"></div><div class="body">Drive ' + P.fmtDur(it.minutes) + " · " + it.miles + " mi to " + esc(it.to) +
        (it.firstInPark ? "<br>National park entrance fee applies" + (cashless ? " (cards and digital payments only)" : "") + ". Watch for bison and horses on the road." : "") + "</div></li>";
      if (it.type === "wait") return '<li class="tl wait"><div class="when">' + P.fmtClock(it.time) + '</div><div class="dot"></div><div class="body">' + P.fmtDur(it.minutes) + " until your entry time</div></li>";
      if (it.type === "library") return '<li class="tl lib"><div class="when">' + P.fmtClock(it.time) + '</div><div class="dot">TR</div><div class="body">' + libraryCard(it, r) + "</div></li>";
      n++;
      var when = P.fmtClock(it.time) + "–" + P.fmtClock(it.end) + " · " + P.fmtDur(it.minutes);
      return '<li class="tl"><div class="when">' + P.fmtClock(it.time) + '</div><div class="dot">' + n + '</div><div class="body">' + stopCard(it.stop).replace("{{when}}", when) + "</div></li>";
    }).join("");

    var parkStops = r.stops.length;
    var facts = ["<b>Library</b> " + P.fmtDur(r.libraryMinutes), "<b>" + parkStops + "</b> park stop" + (parkStops === 1 ? "" : "s"), "<b>Driving</b> " + P.fmtDur(r.driveMinutes), "<b>Done by</b> " + P.fmtClock(r.finish)];
    var tickets = withUtm((D.avail && D.avail.ticketsUrl) || D.cfg.library.ticketsUrl);
    var html = '<div class="summary"><div><div class="eyebrow">' + esc(dayName(state.day, true)) + " · " + esc(({ library: "starting at the Library", south: "starting at the South Unit", north: "starting at the North Unit", i94: "starting from I-94" })[state.from]) + "</div><h2>" + esc(HEAD[state.t] || "Your plan") + '</h2><div class="facts">' + facts.map(function (f) { return "<span>" + f + "</span>"; }).join("") + "</div></div>" +
      '<div class="actions"><a class="btn alt" href="' + esc(tickets) + '" target="_blank" rel="noopener">Library tickets</a>' +
      '<a class="btn" href="' + esc(r.mapsUrl) + '" target="_blank" rel="noopener">Directions</a>' +
      '<button class="btn ghost" type="button" data-act="copy">Copy link</button>' +
      '<button class="btn ghost" type="button" data-act="print">Print</button></div></div>';
    html += '<div class="layout"><div><ol class="timeline">' + rows + "</ol>";
    if (r.spare >= 10) html += '<p class="spare">' + P.fmtDur(r.spare) + " to spare. Linger wherever the view holds you.</p>";
    if (!parkStops && r.ok) html += '<p class="spare">Not enough time left for a park stop. With an extra hour, the Maltese Cross Cabin and Skyline Vista are both close by.</p>';
    if (r.warnings.length) html += '<p class="spare">' + r.warnings.map(esc).join(" ") + "</p>";
    html += altPlan(r, input);
    html += '</div><div class="mapbox"><div id="map" role="region" aria-label="Map of the route"></div><div class="mapnote">Route order shown with straight lines; use Directions for turn-by-turn.</div></div></div>';
    out.innerHTML = html;
    drawMap(r);
    syncUrl();
    post();
  }

  function altPlan(r, input) {
    if (state.must && state.must.length) return '<div class="alt-plan"><div><b>Roosevelt day</b>This plan includes the Elkhorn Ranch.</div><button class="btn ghost" type="button" data-act="unmust">Back to the standard plan</button></div>';
    if (state.t < 360 || r.has("elkhorn")) return "";
    var elk = D.ctx.stops.filter(function (s) { return s.id === "elkhorn"; })[0];
    if (!elk || elk.closed) return "";
    var alt = P.plan(D, Object.assign({}, input, { must: ["elkhorn"] }));
    if (!alt.ok || !alt.has("elkhorn")) return "";
    return '<div class="alt-plan"><div><b>Make it a Roosevelt day</b>Trade some of the park stops for the Elkhorn Ranch, the home ranch Roosevelt built on the Little Missouri River.</div><button class="btn" type="button" data-act="elkhorn">Show that plan</button></div>';
  }

  function problem(r) {
    var dname = dayName(state.day, true), btns = "", msg = "", head = "";
    var nextOpen = days.filter(function (d) { return d.date > state.day && !d.closed; }).slice(0, 2);
    var dayBtns = nextOpen.map(function (d) { return '<button class="btn" type="button" data-day="' + d.date + '">' + esc(d.label) + "</button>"; }).join("");
    if (r.reason === "closed") { head = "The Library is closed that day"; msg = "The Library is closed on " + dname + ". Every route starts there, so pick another day."; btns = dayBtns; }
    else if (r.reason === "noentry" || r.reason === "closing") { head = "Entries are done for the day"; msg = "The last Library entry on " + dname + " comes before you'd arrive. Try an earlier start or another day."; btns = dayBtns; }
    else if (r.reason === "soldout") { head = "Sold out for the rest of the day"; msg = "The remaining Library entry times on " + dname + " are sold out."; btns = dayBtns; }
    else if (r.reason === "short") {
      head = "Not quite enough time";
      var toLib = P.fmtDur(D.ctx.drv(D.cfg.starts.filter(function (s) { return s.id === state.from; })[0].node, "library"));
      var fit = TIMES.filter(function (t) { return t[0] >= r.needMinutes; })[0];
      msg = (state.from === "library" ? "" : "From " + esc(({ south: "the South Unit", north: "the North Unit", i94: "I-94" })[state.from]) + ", the Library is a " + toLib + " drive. ") + "A visit needs about " + P.fmtDur(r.needMinutes) + " with the drive back.";
      if (fit) btns = '<button class="btn" type="button" data-t="' + fit[0] + '">Plan ' + fit[1] + "</button>";
      if (state.end === "start" && state.from !== "library") btns += '<button class="btn ghost" type="button" data-end="medora">Finish in Medora instead</button>';
    }
    return '<div class="problem"><h2>' + esc(head) + "</h2><p>" + msg + '</p><div class="actions">' + btns +
      '<a class="btn ghost" href="' + esc(withUtm(D.cfg.library.visitUrl)) + '" target="_blank" rel="noopener">Hours and tickets</a></div></div>';
  }

  // ---------- map ----------
  function clearMap() { if (map) { map.remove(); map = null; } }
  function drawMap(r) {
    clearMap();
    if (!window.L || !$("#map")) return;
    map = L.map("map", { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16, attribution: 'Tiles: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
    }).addTo(map);
    var nodes = D.cfg.nodes, lib = D.cfg.library, pts = [], seen = {};
    var startNode = D.cfg.starts.filter(function (s) { return s.id === state.from; })[0].node;
    var icon = function (cls, txt) { return L.divIcon({ className: "", html: '<div class="mk ' + cls + '">' + (txt || "") + "</div>", iconSize: null }); };
    var add = function (lat, lon) { pts.push([lat, lon]); };
    if (startNode !== "library") { add(nodes[startNode].lat, nodes[startNode].lon); L.marker([nodes[startNode].lat, nodes[startNode].lon], { icon: icon("pin"), title: "Start" }).addTo(map); }
    add(lib.lat, lib.lon);
    L.marker([lib.lat, lib.lon], { icon: icon("lib", "TR"), title: lib.name, zIndexOffset: 1000 }).addTo(map).bindPopup("<b>" + esc(lib.name) + "</b><br>Start here");
    r.stops.forEach(function (s, i) {
      add(s.lat, s.lon);
      var key = s.lat.toFixed(4) + s.lon.toFixed(4), off = seen[key] ? [0.0012 * seen[key], 0.0018 * seen[key]] : [0, 0];
      seen[key] = (seen[key] || 0) + 1;
      L.marker([s.lat + off[0], s.lon + off[1]], { icon: icon("", i + 1), title: s.name }).addTo(map).bindPopup("<b>" + (i + 1) + ". " + esc(s.name) + "</b>");
    });
    var en = nodes[r.endNode]; add(en.lat, en.lon);
    if (r.endNode !== "library" && r.endNode !== startNode) L.marker([en.lat, en.lon], { icon: icon("pin"), title: "Finish" }).addTo(map);
    L.polyline(pts, { color: "#C9653F", weight: 3, opacity: .8, dashArray: "6 7" }).addTo(map);
    map.fitBounds(L.latLngBounds(pts).pad(0.12));
  }

  // ---------- state ----------
  function syncUrl() {
    if (EMBED) return;
    var q = new URLSearchParams();
    q.set("t", state.t); q.set("from", state.from);
    if (state.end !== "start") q.set("end", state.end);
    q.set("day", state.day); q.set("at", P.fmtClock(state.at).replace(/[ .]/g, "").replace("am", "a").replace("pm", "p"));
    if (state.acc) q.set("acc", "1");
    if (state.must && state.must.length) q.set("must", state.must.join(","));
    history.replaceState(null, "", "?" + q.toString() + location.hash);
  }
  function parseAt(s) {
    var m = /^(\d{1,2}):?(\d{2})?([ap])?/i.exec(s || "");
    if (!m) return null;
    var h = +m[1] % 12 + ((m[3] || "").toLowerCase() === "p" ? 12 : 0);
    if (!m[3] && +m[1] >= 12) h = +m[1];
    return h * 60 + (+m[2] || 0);
  }
  function readState() {
    var def = defaultStart();
    var t = +params.get("t");
    state.t = TIMES.some(function (x) { return x[0] === t; }) ? t : 120;
    state.from = D.cfg.starts.some(function (s) { return s.id === params.get("from"); }) ? params.get("from") : "library";
    state.end = ["start", "medora", "i94"].indexOf(params.get("end")) !== -1 ? params.get("end") : state.from === "i94" ? "i94" : "start";
    var day = params.get("day");
    state.day = days.some(function (d) { return d.date === day; }) ? day : def.day;
    var at = parseAt(params.get("at"));
    state.at = at != null && at >= 360 && at <= 1200 ? Math.round(at / 15) * 15 : (state.day === def.day ? def.at : 9 * 60);
    state.acc = params.get("acc") === "1";
    state.must = params.get("must") ? params.get("must").split(",") : [];
  }

  function post() {
    if (!EMBED || window.parent === window) return;
    requestAnimationFrame(function () {
      window.parent.postMessage({ type: "trnp-planner:height", height: document.documentElement.scrollHeight, id: params.get("id") }, "*");
    });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-t],[data-from],[data-day],[data-end],[data-act]");
    if (!b) return;
    if (b.dataset.t) state.t = +b.dataset.t;
    if (b.dataset.from) {
      state.from = b.dataset.from;
      if (state.from === "i94") state.end = "i94"; else if (state.end === "i94") state.end = "start";
    }
    if (b.dataset.day) state.day = b.dataset.day;
    if (b.dataset.end) state.end = b.dataset.end;
    var act = b.dataset.act;
    if (act === "copy") {
      var done = function () { b.textContent = "Link copied"; setTimeout(function () { b.textContent = "Copy link"; }, 1800); };
      var url = location.href.split("#")[0];
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done); else done();
      return;
    }
    if (act === "print") { window.print(); return; }
    if (act === "elkhorn") state.must = ["elkhorn"];
    if (act === "unmust") state.must = [];
    if (!act && !b.dataset.day) state.must = state.must && state.t >= 360 ? state.must : [];
    syncForm(); render();
  });
  ["#q-day", "#q-at", "#q-end", "#q-acc"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      state.day = $("#q-day").value; state.at = +$("#q-at").value; state.end = $("#q-end").value; state.acc = $("#q-acc").checked;
      render();
    });
  });
  function showEmbedHelp() {
    var on = location.hash === "#embed" && !EMBED;
    $("#embed").hidden = !on;
    if (on) $("#embed").scrollIntoView();
  }
  window.addEventListener("hashchange", showEmbedHelp);

  // ---------- boot ----------
  if (EMBED) document.body.classList.add("embed");
  Promise.all([
    getJSON("data/stops.json"), getJSON("data/nps.json"), getJSON("data/drive.json"),
    getJSON(AVAIL_URL).catch(function () { return null; }),
  ]).then(function (res) {
    D = { cfg: res[0], nps: res[1], drive: res[2], avail: res[3] };
    D.ctx = P.buildContext(D.cfg, D.nps, D.drive);
    var st = D.nps.updated ? "(park data updated " + new Date(D.nps.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ")" : "";
    $("#nps-stamp").textContent = st;
    buildDays(); buildTimes(); readState(); syncForm(); renderAlerts(); render(); showEmbedHelp();
    if (EMBED && "ResizeObserver" in window) new ResizeObserver(post).observe(document.body);
  }).catch(function (err) {
    $("#result").innerHTML = '<div class="problem"><h2>Something went wrong</h2><p>The planner couldn\'t load park data. Refresh to try again, or see <a href="https://www.trlibrary.com/visit">trlibrary.com/visit</a>.</p></div>';
    console.error(err);
  });
})();
