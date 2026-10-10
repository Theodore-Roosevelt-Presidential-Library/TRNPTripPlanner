/*!
 * Theodore Roosevelt National Park Trip Planner — embed
 * Theodore Roosevelt Presidential Library Labs · https://trnp-planner.labs.trlibrary.com
 *
 * Draws the planner directly into your page (no iframe):
 *
 *   <div data-trnp-planner></div>
 *   <script src="https://trnp-planner.labs.trlibrary.com/embed.js" async></script>
 *
 * Optional attributes on the div:
 *   data-from="library|south|north|i94"   starting point picked on load
 *   data-time="90|120|180|240|360|540"    minutes picked on load
 *   data-title="off"                      hide the planner's own heading (when the page has one)
 *   data-sticky-top="110"                 px to keep the map clear of a fixed site header
 */
(function () {
  "use strict";
  var ORIGIN = "https://trnp-planner.labs.trlibrary.com";
  try { var me = document.currentScript && document.currentScript.src; if (me) ORIGIN = new URL(me).origin; } catch (e) {}
  var V = "3";
  var LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";

  function css(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
  }
  function js(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script"); s.charset = "utf-8"; s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s);
    });
  }

  css(LEAFLET + "leaflet.min.css");
  css(ORIGIN + "/assets/planner.css?v=" + V);

  var ready = Promise.all([
    window.L ? null : js(LEAFLET + "leaflet.min.js"),
    window.WWSun ? null : js(ORIGIN + "/assets/sun.js?v=" + V),
    window.TRPlanner ? null : js(ORIGIN + "/assets/planner.js?v=" + V),
  ]).then(function () {
    return window.TRNPPlanner ? null : js(ORIGIN + "/assets/widget.js?v=" + V);
  });

  function scan() {
    ready.then(function () {
      var els = document.querySelectorAll("[data-trnp-planner]");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        window.TRNPPlanner.mount(el, {
          origin: ORIGIN,
          from: el.getAttribute("data-from"),
          time: el.getAttribute("data-time"),
          title: el.getAttribute("data-title"),
          stickyTop: el.hasAttribute("data-sticky-top") ? parseInt(el.getAttribute("data-sticky-top"), 10) : null,
        });
      }
    }).catch(function (e) { if (window.console) console.error("TRNP planner failed to load", e); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
})();
