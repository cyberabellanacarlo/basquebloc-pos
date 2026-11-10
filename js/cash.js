/* Quick-cash chips. Base rule from the Android CashSuggester (no learning required). */
(function (global) {
  "use strict";

  var MAX = 5;
  var BILLS = [10000, 20000, 50000, 100000]; /* 100 / 200 / 500 / 1000 pesos in centavos */

  function roundUp(total, step) {
    if (total <= 0) return 0;
    return Math.floor((total + step - 1) / step) * step;
  }

  function suggest(total) {
    var seen = {};
    var out = [];
    function add(v) {
      if (v < total || seen[v]) return;
      if (out.length >= MAX) return;
      seen[v] = true;
      out.push(v);
    }
    add(total);
    [2000, 5000, 10000].forEach(function (step) { add(roundUp(total, step)); });
    BILLS.forEach(function (b) { if (b > total) add(b); });
    return out;
  }

  function change(total, tendered) {
    var c = tendered - total;
    return c >= 0 ? c : null;
  }

  global.BBCash = { suggest: suggest, change: change, MAX: MAX };
})(window);
