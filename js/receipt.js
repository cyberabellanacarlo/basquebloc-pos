/* On-screen thermal-style receipt (no printing). Content matches the Android app. */
(function (global) {
  "use strict";

  var TAGLINE = "Mindanao's Best Tasting Cheesecake!";

  function paidLabel(sale) {
    if (sale.paymentType === "CASH") return "Cash";
    return sale.platformName || "Online";
  }

  function callText(sale) {
    var n = (sale.customerName || "").trim();
    if (n) return "Order " + sale.orderSeq + ", " + n + ", your order is ready!";
    return "Order " + sale.orderSeq + ", your order is ready!";
  }

  function render(sale, settings, mount) {
    settings = settings || {};
    var M = global.BBMoney;
    var paid = paidLabel(sale);
    var care = (settings.careNote == null) ? "Best enjoyed within 3 days, kept chilled." : settings.careNote;
    var facebook = (settings.facebook || "").trim();
    var cashier = (settings.cashier || "").trim();
    var notOfficial = settings.notOfficial !== false;

    var linesHtml = sale.lines.map(function (ln) {
      return '<div class="slip-row">' +
        '<span class="slip-item">' + esc(ln.qty + " x " + ln.name) + '</span>' +
        '<span class="slip-amt">' + esc(M.pesoExact(ln.lineCentavos)) + '</span>' +
      '</div>';
    }).join("");

    var payBlock;
    if (sale.changeCentavos != null && sale.paymentType === "CASH") {
      payBlock =
        '<div class="slip-row"><span>' + esc(paid) + '</span><span class="slip-amt">' + esc(M.pesoExact(sale.tenderedCentavos || sale.totalCentavos)) + '</span></div>' +
        '<div class="slip-row slip-change"><span>Change</span><span class="slip-amt">' + esc(M.pesoExact(sale.changeCentavos)) + '</span></div>';
    } else {
      payBlock = '<div class="slip-row"><span>Paid \u2014 ' + esc(paid) + '</span><span class="slip-amt">' + esc(M.pesoExact(sale.totalCentavos)) + '</span></div>';
    }

    var leftMeta = cashier ? ("Cashier: " + cashier) : ("Paid: " + paid);

    mount.innerHTML =
      '<div class="slip-shell" id="receipt-slip">' +
        '<img class="slip-tear slip-tear-top" src="assets/slip-tear-top.svg" alt="">' +
        '<div class="slip-scroll-wrap">' +
        '<div class="slip-scroll">' +
        '<article class="slip-body">' +
        '<img class="slip-logo" src="assets/receipt_logo.png" alt="The Basque Bloc">' +
        '<div class="slip-brand">BASQUE BLOC</div>' +
        '<div class="slip-tagline">' + esc(TAGLINE) + '</div>' +
        '<div class="slip-city">TAGUM CITY</div>' +
        '<div class="slip-ord-label">YOUR ORDER NUMBER</div>' +
        '<div class="slip-ord-no">' + esc(sale.orderNo) + '</div>' +
        (sale.customerName ? '<div class="slip-cust">' + esc(sale.customerName) + '</div>' : '') +
        '<div class="slip-rule"></div>' +
        '<div class="slip-row"><span>' + esc(M.formatDate(sale.timeMillis)) + '</span><span>' + esc(M.formatTime(sale.timeMillis)) + '</span></div>' +
        '<div class="slip-row"><span>' + esc(leftMeta) + '</span><span>Rcpt #' + esc(sale.receiptNo) + '</span></div>' +
        '<div class="slip-rule"></div>' +
        linesHtml +
        '<div class="slip-rule"></div>' +
        '<div class="slip-row slip-total"><span>TOTAL</span><span id="receipt-total" class="slip-amt">' + esc(M.pesoExact(sale.totalCentavos)) + '</span></div>' +
        '<div class="slip-rule"></div>' +
        payBlock +
        '<div class="slip-thanks">SALAMAT!</div>' +
        '<div class="slip-note">Please wait for No. ' + esc(sale.orderNo) + ' to be called.</div>' +
        '<div class="slip-note">Enjoy your cheesecake.</div>' +
        (care ? '<div class="slip-care">' + esc(care) + '</div>' : '') +
        (facebook ? '<div class="slip-care">' + esc(facebook) + '</div>' : '') +
        (notOfficial ? '<div class="slip-official">This is not an official receipt.</div>' : '') +
        '</article>' +
        '</div>' +
        '<div class="slip-top-fade" hidden aria-hidden="true"></div>' +
        '<div class="slip-more" hidden aria-hidden="true">' +
          '<span class="slip-more-fade"></span>' +
          '<span class="slip-more-strip">' +
            '<span class="slip-more-hint">\u2193 more</span>' +
          '</span>' +
        '</div>' +
        '</div>' +
        '<img class="slip-tear slip-tear-bottom" src="assets/slip-tear-bottom.svg" alt="">' +
      '</div>';
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function csvFor(sales) {
    var header = "date,order_no,time,customer,items,item_count,total_php,payment,platform,tendered_php,change_php,status";
    var M = global.BBMoney;
    var rows = [header];
    sales.forEach(function (s) {
      var items = s.lines.map(function (ln) { return ln.qty + " x " + ln.name; }).join("; ");
      var count = s.lines.reduce(function (n, ln) { return n + ln.qty; }, 0);
      var p = M.manilaParts(s.timeMillis);
      var time = p.hour + ":" + p.minute + ":" + p.second;
      var row = [
        s.dayKey, s.orderNo, time, s.customerName || "",
        items, String(count),
        M.plain(s.totalCentavos), s.paymentType, s.platformName || "",
        s.tenderedCentavos == null ? "" : M.plain(s.tenderedCentavos),
        s.changeCentavos == null ? "" : M.plain(s.changeCentavos),
        s.status
      ].map(csvEsc);
      rows.push(row.join(","));
    });
    return rows.join("\r\n") + "\r\n";
  }

  function csvEsc(v) {
    var s = String(v == null ? "" : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsv(sales, dayKey) {
    var blob = new Blob([csvFor(sales)], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "BasqueBloc_Sales_" + dayKey + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function summarize(dayKey, sales) {
    var day = sales.filter(function (s) { return s.dayKey === dayKey && s.status !== "CANCELED"; });
    var cash = 0, gcash = 0, maya = 0, online = 0, cashN = 0, gcashN = 0, mayaN = 0;
    var itemMap = {};
    day.forEach(function (s) {
      if (s.paymentType === "CASH") { cash += s.totalCentavos; cashN += 1; }
      else if ((s.platformName || "") === "GCash") { gcash += s.totalCentavos; gcashN += 1; online += s.totalCentavos; }
      else if ((s.platformName || "") === "Maya") { maya += s.totalCentavos; mayaN += 1; online += s.totalCentavos; }
      else { online += s.totalCentavos; }
      s.lines.forEach(function (ln) {
        var e = itemMap[ln.name] || (itemMap[ln.name] = { name: ln.name, qty: 0, salesCentavos: 0 });
        e.qty += ln.qty;
        e.salesCentavos += ln.lineCentavos;
      });
    });
    var items = Object.keys(itemMap).map(function (k) { return itemMap[k]; })
      .sort(function (a, b) { return b.qty - a.qty || b.salesCentavos - a.salesCentavos || (a.name < b.name ? -1 : 1); });
    var gross = day.reduce(function (n, s) { return n + s.totalCentavos; }, 0);
    return {
      dayKey: dayKey,
      orderCount: day.length,
      grossCentavos: gross,
      cashCentavos: cash,
      gcashCentavos: gcash,
      mayaCentavos: maya,
      onlineCentavos: online,
      cashOrders: cashN,
      gcashOrders: gcashN,
      mayaOrders: mayaN,
      avgOrderCentavos: day.length ? Math.round(gross / day.length) : 0,
      bestSeller: items[0] || null,
      items: items
    };
  }

  global.BBReceipt = {
    TAGLINE: TAGLINE,
    paidLabel: paidLabel,
    callText: callText,
    render: render,
    csvFor: csvFor,
    downloadCsv: downloadCsv,
    summarize: summarize
  };
})(window);
