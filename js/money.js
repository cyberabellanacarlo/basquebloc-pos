/* All money is integer centavos (PHP 1.00 = 100). Never use floats for totals. */
(function (global) {
  "use strict";

  function abs(n) { return n < 0 ? -n : n; }

  function formatBody(centavos) {
    var n = abs(centavos | 0);
    var pesos = String(Math.floor(n / 100));
    var c = String(n % 100);
    if (c.length < 2) c = "0" + c;
    var withCommas = pesos.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return withCommas + "." + c;
  }

  function format(centavos, prefix) {
    var neg = centavos < 0 ? "-" : "";
    var body = formatBody(centavos);
    if (prefix === false) return neg + body;
    return neg + "PHP " + body;
  }

  /* On-screen peso: ₱1,250 or ₱1,250.50 (matches the Android app). */
  function peso(centavos) {
    var neg = centavos < 0 ? "-" : "";
    var n = abs(centavos | 0);
    if (n % 100 === 0) {
      return neg + "\u20b1" + String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    return neg + "\u20b1" + formatBody(centavos);
  }

  function pesoExact(centavos) {
    var neg = centavos < 0 ? "-" : "";
    return neg + "\u20b1" + formatBody(centavos);
  }

  /* Plain "1234.50" for CSV. */
  function plain(centavos) {
    var neg = centavos < 0 ? "-" : "";
    var n = abs(centavos | 0);
    var c = String(n % 100);
    if (c.length < 2) c = "0" + c;
    return neg + String(Math.floor(n / 100)) + "." + c;
  }

  function parse(text) {
    var s = String(text || "").trim().replace(/,/g, "").replace(/^\u20b1/, "").replace(/^PHP\s*/i, "");
    if (!s) return 0;
    if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
    var neg = s.charAt(0) === "-";
    if (neg) s = s.slice(1);
    var parts = s.split(".");
    var p = parseInt(parts[0] || "0", 10);
    var frac = (parts[1] || "").slice(0, 2);
    if (frac.length === 1) frac = frac + "0";
    if (!frac) frac = "00";
    var v = p * 100 + parseInt(frac, 10);
    return neg ? -v : v;
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function manilaParts(ms) {
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, weekday: "short"
    });
    var map = {};
    dtf.formatToParts(new Date(ms)).forEach(function (p) { map[p.type] = p.value; });
    /* hour12:false can still yield "24" in some engines for midnight; normalize. */
    var hour = map.hour === "24" ? "00" : map.hour;
    return {
      year: map.year,
      month: map.month,
      day: map.day,
      hour: hour,
      minute: map.minute,
      second: map.second,
      weekday: map.weekday
    };
  }

  function dayKey(ms) {
    var p = manilaParts(ms || Date.now());
    return p.year + "-" + p.month + "-" + p.day;
  }

  function formatDate(ms) {
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var p = manilaParts(ms);
    return months[parseInt(p.month, 10) - 1] + " " + parseInt(p.day, 10) + ", " + p.year;
  }

  function formatTime(ms) {
    var p = manilaParts(ms);
    var h = parseInt(p.hour, 10);
    var ampm = h >= 12 ? "PM" : "AM";
    var hr = h % 12;
    if (hr === 0) hr = 12;
    return hr + ":" + p.minute + " " + ampm;
  }

  function formatClock(ms) {
    var p = manilaParts(ms);
    var h = parseInt(p.hour, 10);
    var ampm = h >= 12 ? "PM" : "AM";
    var hr = h % 12;
    if (hr === 0) hr = 12;
    return hr + ":" + p.minute + " " + ampm;
  }

  function formatHeaderDate(ms) {
    var months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    var p = manilaParts(ms);
    return p.weekday.toUpperCase() + " \u00b7 " + months[parseInt(p.month, 10) - 1] + " " + parseInt(p.day, 10);
  }

  function orderNo(seq) {
    var s = String(seq);
    return s.length >= 2 ? s : pad2(seq);
  }

  global.BBMoney = {
    format: format,
    peso: peso,
    pesoExact: pesoExact,
    plain: plain,
    parse: parse,
    dayKey: dayKey,
    formatDate: formatDate,
    formatTime: formatTime,
    formatClock: formatClock,
    formatHeaderDate: formatHeaderDate,
    orderNo: orderNo,
    manilaParts: manilaParts
  };
})(window);
