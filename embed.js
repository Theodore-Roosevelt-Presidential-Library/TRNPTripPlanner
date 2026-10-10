/*!
 * Got Two Hours? embed — Theodore Roosevelt Presidential Library
 * https://trnp-planner.labs.trlibrary.com
 *
 *   <div data-trnp-planner></div>
 *   <script src="https://trnp-planner.labs.trlibrary.com/embed.js" async></script>
 *
 * Optional: data-from="library|south|north|i94"  data-time="90|120|180|240|360|540"  data-min-height="900"
 */
(function () {
  "use strict";
  var ORIGIN = "https://trnp-planner.labs.trlibrary.com";
  try { var me = document.currentScript && document.currentScript.src; if (me) ORIGIN = new URL(me).origin; } catch (e) {}
  var frames = {}, n = 0;

  function mount(el) {
    if (el.getAttribute("data-tp-mounted")) return;
    el.setAttribute("data-tp-mounted", "1");
    var id = "tp" + ++n, q = "?embed=1&id=" + id;
    var from = el.getAttribute("data-from"), t = el.getAttribute("data-time");
    if (from) q += "&from=" + encodeURIComponent(from);
    if (t) q += "&t=" + encodeURIComponent(t);
    var f = document.createElement("iframe");
    f.src = ORIGIN + "/" + q;
    f.title = "Got Two Hours? Trip planner for the Theodore Roosevelt Presidential Library and National Park";
    f.loading = "lazy";
    f.style.cssText = "width:100%;border:0;display:block;overflow:hidden;height:" + (parseInt(el.getAttribute("data-min-height"), 10) || 1100) + "px";
    el.appendChild(f);
    frames[id] = f;
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.type !== "trnp-planner:height") return;
    var f = frames[e.data.id];
    if (f && e.data.height) f.style.height = Math.ceil(e.data.height) + "px";
  });

  function scan() { var els = document.querySelectorAll("[data-trnp-planner]"); for (var i = 0; i < els.length; i++) mount(els[i]); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
})();
