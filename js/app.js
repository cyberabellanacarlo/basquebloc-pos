(function () {
  "use strict";

  var storage = window.BBStorage;
  var money = window.BBMoney;
  var cash = window.BBCash;
  var receipt = window.BBReceipt;

  var LATE_MS = 8 * 60 * 1000;
  var FRESH_MS = 10 * 1000;

  var state = {
    view: "counter",
    category: "fav",
    cart: [],
    customerName: "",
    payMethod: "CASH",
    tenderText: "",
    currentSale: null,
    receiptFromHistory: false,
    customerOpen: false,
    ordersTab: "live",
    settingsTab: "menu",
    settingsUnlocked: false,
    pinBuffer: "",
    pinReason: "settings",
    menu: { categories: [], items: [] },
    sales: [],
    settings: null,
    persistOk: false,
    editingItem: null,
    clockTimer: null,
    lateTimer: null
  };

  function $(id) { return document.getElementById(id); }
  function qaMode() { return location.search.indexOf("qa=1") !== -1; }

  function setAppHeight() {
    var vv = window.visualViewport;
    var h = (vv && vv.height) ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-h", h + "px");
  }

  function todayKey() { return money.dayKey(Date.now()); }

  function cartTotal() {
    return state.cart.reduce(function (n, ln) { return n + ln.qty * ln.unitCentavos; }, 0);
  }

  function todaySales() {
    var day = todayKey();
    return state.sales.filter(function (s) { return s.dayKey === day && s.status !== "CANCELED"; });
  }

  function waitingCount() {
    var day = todayKey();
    return state.sales.filter(function (s) {
      return s.dayKey === day && s.status !== "PICKED_UP" && s.status !== "CLOSED" && s.status !== "CANCELED";
    }).length;
  }

  function isSoldOut(item) {
    return item.soldOutDay && item.soldOutDay === todayKey();
  }

  function showView(name) {
    state.view = name;
    ["counter", "pay", "receipt", "orders", "history", "settings"].forEach(function (v) {
      $("view-" + v).classList.toggle("hidden", v !== name);
    });
    document.querySelectorAll("#nav .nav-btn, #nav .icon-btn").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-view") === name);
    });
    if (name === "orders") renderOrders();
    if (name === "history") renderHistory();
    if (name === "settings") renderSettings();
    if (name === "pay") renderPay();
    document.body.classList.toggle("receipt-open", name === "receipt");
    if (name !== "receipt") closeCustomerView();
    if (name === "receipt") setTimeout(fitSlip, 30);
  }

  function applyCenteredScale(shell, w, h, scale) {
    shell.style.transformOrigin = "center center";
    shell.style.transform = "scale(" + scale + ")";
    /* Match the layout box to the visual size so overflow:hidden cannot clip. */
    var extraW = w * (scale - 1);
    var extraH = h * (scale - 1);
    shell.style.marginLeft = (extraW / 2) + "px";
    shell.style.marginRight = (extraW / 2) + "px";
    shell.style.marginTop = (extraH / 2) + "px";
    shell.style.marginBottom = (extraH / 2) + "px";
  }

  function fitSlipIn(chrome, opts) {
    opts = opts || {};
    if (!chrome) return;
    var shell = chrome.querySelector(".slip-shell");
    if (!shell) return;
    shell.style.transform = "none";
    shell.style.margin = "0";
    if (!opts.keepWidth) shell.style.width = "";
    var pad = opts.pad != null ? opts.pad : 16;
    var availW = chrome.clientWidth - pad;
    var availH = chrome.clientHeight - pad;
    if (availW <= 8 || availH <= 8) return;
    var w = shell.offsetWidth;
    var h = shell.offsetHeight;
    if (!w || !h) return;
    var scale = Math.min(1, availW / w, availH / h);
    if (!(scale > 0)) return;
    /* Staff view: shrink from the top. Do not treat "top center" as a centered scale. */
    shell.style.transformOrigin = "top center";
    shell.style.transform = "scale(" + scale + ")";
    shell.style.marginBottom = (h * (scale - 1)) + "px";
    chrome.scrollTop = 0;
    chrome.scrollLeft = 0;
  }

  function resetCustomerSlipStyles(shell) {
    shell.style.transform = "none";
    shell.style.margin = "0";
    shell.style.width = "";
    shell.style.height = "";
    shell.style.maxHeight = "";
    shell.style.overflow = "";
    shell.style.flexShrink = "0";
    shell.classList.remove("is-scrollable");
    shell.classList.remove("has-more");
    shell.classList.remove("has-top-fade");
    var body = shell.querySelector(".slip-body");
    if (body) {
      body.style.padding = "";
      body.style.lineHeight = "";
      body.scrollTop = 0;
    }
    var sc = shell.querySelector(".slip-scroll");
    if (sc) sc.scrollTop = 0;
    var more = shell.querySelector(".slip-more");
    if (more) {
      more.hidden = true;
      more.setAttribute("aria-hidden", "true");
    }
    var topFade = shell.querySelector(".slip-top-fade");
    if (topFade) {
      topFade.hidden = true;
      topFade.setAttribute("aria-hidden", "true");
    }
    var thanks = shell.querySelector(".slip-thanks");
    if (thanks) thanks.style.margin = "";
  }

  function updateMoreHint(shell) {
    if (!shell) return;
    var sc = shell.querySelector(".slip-scroll");
    var more = shell.querySelector(".slip-more");
    if (!sc || !more) return;
    var overflow = sc.scrollHeight > sc.clientHeight + 1;
    var atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
    var atTop = sc.scrollTop <= 1;
    var show = overflow && !atBottom;
    more.hidden = !show;
    more.setAttribute("aria-hidden", show ? "false" : "true");
    shell.classList.toggle("has-more", show);
    var topFade = shell.querySelector(".slip-top-fade");
    var showTop = overflow && !atTop;
    if (topFade) {
      topFade.hidden = !showTop;
      topFade.setAttribute("aria-hidden", showTop ? "false" : "true");
    }
    shell.classList.toggle("has-top-fade", showTop);
  }

  function bindMoreHint(shell) {
    var sc = shell.querySelector(".slip-scroll");
    if (!sc || sc.getAttribute("data-bbpos-more") === "1") return;
    sc.setAttribute("data-bbpos-more", "1");
    sc.addEventListener("scroll", function () { updateMoreHint(shell); }, { passive: true });
  }

  function tightenCustomerSlip(shell) {
    var body = shell.querySelector(".slip-body");
    if (body) {
      body.style.padding = "12px 20px 12px";
      body.style.lineHeight = "1.25";
    }
    var thanks = shell.querySelector(".slip-thanks");
    if (thanks) thanks.style.margin = "10px 0 6px";
  }

  /* Widen the unscaled slip so scaling it to targetW can also fit in targetH, avoiding scroll when possible. */
  function widenCustomerSlipToFitHeight(shell, targetW, targetH, availW) {
    var w = shell.offsetWidth;
    var h = shell.offsetHeight;
    if (!w || !h) return;
    if (h * (targetW / w) <= targetH) return;
    if (w >= availW) return;
    var lo = w, hi = availW, i;
    for (i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      shell.style.width = mid + "px";
      w = shell.offsetWidth;
      h = shell.offsetHeight;
      if (!w || !h) break;
      if (h * (targetW / w) > targetH) lo = mid;
      else hi = mid;
    }
    shell.style.width = Math.ceil(hi) + "px";
  }

  function capCustomerSlipHeight(shell, maxUnscaledH) {
    var h = shell.offsetHeight;
    if (h <= maxUnscaledH + 0.5) return false;
    shell.style.height = maxUnscaledH + "px";
    shell.style.maxHeight = maxUnscaledH + "px";
    shell.classList.add("is-scrollable");
    return true;
  }

  /* Show customer: always land at ~85% of the viewport width, cap at ~90% of the height, never clip.
     Widen the designed 520px slip first when that lets the whole receipt fit. Otherwise tighten
     spacing a little, then scroll inside the slip so width stays at 85%. */
  function fitCustomerSlip() {
    var chrome = $("customer-stage");
    if (!chrome) return;
    var shell = chrome.querySelector(".slip-shell");
    if (!shell) return;
    resetCustomerSlipStyles(shell);
    var pad = 8;
    /* Use the stage content box, not clientWidth, so 16px stage padding is not treated as free space. */
    var cs = getComputedStyle(chrome);
    var availW = chrome.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - pad;
    var availH = chrome.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - pad;
    if (availW <= 8 || availH <= 8) return;
    var targetW = Math.min(window.innerWidth * 0.85, availW);
    var targetH = Math.min(window.innerHeight * 0.90, availH);
    if (targetW <= 8 || targetH <= 8) return;

    var designW = Math.min(520, targetW);
    shell.style.width = designW + "px";
    if (!shell.offsetWidth || !shell.offsetHeight) return;

    widenCustomerSlipToFitHeight(shell, targetW, targetH, availW);

    var w = shell.offsetWidth;
    var h = shell.offsetHeight;
    if (!w || !h) return;

    var scale = targetW / w;
    if (!(scale > 0)) return;

    if (h * scale > targetH) {
      tightenCustomerSlip(shell);
      widenCustomerSlipToFitHeight(shell, targetW, targetH, availW);
      w = shell.offsetWidth;
      h = shell.offsetHeight;
      if (!w || !h) return;
      scale = targetW / w;
      if (!(scale > 0)) return;
    }

    if (h * scale > targetH) {
      capCustomerSlipHeight(shell, targetH / scale);
      w = shell.offsetWidth;
      h = shell.offsetHeight;
      if (!w || !h) return;
      scale = targetW / w;
      if (!(scale > 0)) return;
    }

    applyCenteredScale(shell, w, h, scale);
    bindMoreHint(shell);
    updateMoreHint(shell);
    chrome.scrollTop = 0;
    chrome.scrollLeft = 0;
  }

  function scheduleCustomerFit() {
    var tries = 0;
    function go() {
      if (!state.customerOpen) return;
      fitCustomerSlip();
      tries += 1;
      if (tries < 3) setTimeout(go, 50);
    }
    go();
    requestAnimationFrame(function () { requestAnimationFrame(go); });
  }

  function fitSlip() {
    if (state.customerOpen) {
      fitCustomerSlip();
      return;
    }
    if (state.view !== "receipt") return;
    fitSlipIn($("receipt-mount"), { origin: "top center", pad: 16 });
  }

  function tryFullscreen(el) {
    if (!el) return Promise.resolve(false);
    var fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return Promise.resolve(false);
    try {
      var ret = fn.call(el);
      if (ret && ret.then) {
        return ret.then(function () { return true; }).catch(function () { return false; });
      }
      return Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function openCustomerView() {
    if (!state.currentSale) return;
    state.customerOpen = true;
    receipt.render(state.currentSale, state.settings, $("customer-mount"));
    $("customer-overlay").classList.remove("hidden");
    $("customer-overlay").offsetHeight;
    scheduleCustomerFit();
    var logo = $("customer-mount").querySelector(".slip-logo");
    if (logo && !logo.complete) {
      logo.addEventListener("load", function () { if (state.customerOpen) scheduleCustomerFit(); }, { once: true });
    }
    tryFullscreen($("customer-overlay"));
  }

  function closeCustomerView() {
    if (!state.customerOpen) return;
    state.customerOpen = false;
    $("customer-overlay").classList.add("hidden");
    $("customer-mount").innerHTML = "";
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        try { exit.call(document); } catch (e) {}
      }
    }
    if (state.view === "receipt") setTimeout(fitSlip, 30);
  }

  function goCounter() { showView("counter"); }

  /* ---------- clock ---------- */
  function tickClock() {
    var now = Date.now();
    $("clock-time").textContent = money.formatClock(now);
    $("clock-date").textContent = money.formatHeaderDate(now);
    var badge = $("orders-badge");
    var n = waitingCount();
    badge.textContent = n ? String(n) : "";
    badge.classList.toggle("zero", !n);
    if (state.view === "orders") renderOrders();
  }

  /* ---------- menu / cart ---------- */
  function itemsInCategory(cat) {
    var items = state.menu.items;
    if (cat === "fav") return items.filter(function (i) { return i.favorite; });
    return items.filter(function (i) { return i.categoryId === cat; });
  }

  function renderCategories() {
    var row = $("cat-row");
    row.innerHTML = "";
    var cats = [{ id: "fav", name: "★ Fav" }].concat(state.menu.categories);
    if (state.category !== "fav" && !state.menu.categories.some(function (c) { return c.id === state.category; })) {
      state.category = "fav";
    }
    cats.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (state.category === c.id ? " on" : "");
      b.textContent = c.name;
      b.addEventListener("click", function () { state.category = c.id; renderCategories(); renderMenu(); });
      row.appendChild(b);
    });
  }

  function renderMenu() {
    var grid = $("menu-grid");
    grid.innerHTML = "";
    var items = itemsInCategory(state.category);
    if (!items.length) {
      var p = document.createElement("p");
      p.className = "empty";
      p.style.gridColumn = "1 / -1";
      p.textContent = state.category === "fav" ? "No favorites yet. Mark items as favorites in Settings." : "No items in this category yet.";
      grid.appendChild(p);
      return;
    }
    items.forEach(function (item) {
      var sold = isSoldOut(item);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "item-card" + (sold ? " sold" : "");
      b.disabled = sold;
      b.setAttribute("data-item-id", item.id);
      var tag = sold ? "Sold out" : (item.isExample ? "Sample" : "");
      b.innerHTML = '<div class="item-name"></div><div class="item-meta">' +
        (tag ? '<span class="tag"></span>' : "<span></span>") +
        '<span class="item-price"></span></div>';
      b.querySelector(".item-name").textContent = item.name;
      if (tag) b.querySelector(".tag").textContent = tag;
      b.querySelector(".item-price").textContent = money.peso(item.priceCentavos);
      if (!sold) b.addEventListener("click", function () { addToCart(item); });
      grid.appendChild(b);
    });
  }

  function addToCart(item) {
    var found = state.cart.filter(function (ln) { return ln.itemId === item.id; })[0];
    if (found) found.qty += 1;
    else state.cart.push({ itemId: item.id, name: item.name, qty: 1, unitCentavos: item.priceCentavos, isExample: !!item.isExample });
    renderCart();
  }

  function setQty(itemId, qty) {
    if (qty <= 0) {
      state.cart = state.cart.filter(function (ln) { return ln.itemId !== itemId; });
    } else {
      state.cart.forEach(function (ln) { if (ln.itemId === itemId) ln.qty = qty; });
    }
    renderCart();
  }

  function clearCart() {
    state.cart = [];
    state.customerName = "";
    $("customer-name").value = "";
    renderCart();
  }

  function renderCart() {
    var box = $("cart-lines");
    box.innerHTML = "";
    if (!state.cart.length) {
      box.innerHTML = '<p class="cart-empty">Tap a menu item to start an order.</p>';
    } else {
      state.cart.forEach(function (ln) {
        var row = document.createElement("div");
        row.className = "cart-line";
        row.innerHTML =
          '<div class="cart-line-name"></div>' +
          '<div class="cart-line-amt"></div>' +
          '<div class="cart-line-ops">' +
            '<button type="button" class="qty-btn" data-act="dec" aria-label="Fewer">−</button>' +
            '<span class="qty"></span>' +
            '<button type="button" class="qty-btn filled" data-act="inc" aria-label="More">+</button>' +
            '<button type="button" class="linkish" data-act="rm">Remove</button>' +
          '</div>';
        row.querySelector(".cart-line-name").textContent = ln.name;
        row.querySelector(".cart-line-amt").textContent = money.peso(ln.qty * ln.unitCentavos);
        row.querySelector(".qty").textContent = String(ln.qty);
        row.querySelector('[data-act="dec"]').addEventListener("click", function () { setQty(ln.itemId, ln.qty - 1); });
        row.querySelector('[data-act="inc"]').addEventListener("click", function () { setQty(ln.itemId, ln.qty + 1); });
        row.querySelector('[data-act="rm"]').addEventListener("click", function () { setQty(ln.itemId, 0); });
        box.appendChild(row);
      });
    }
    $("cart-total").textContent = money.peso(cartTotal());
    $("btn-pay").disabled = state.cart.length === 0;
  }

  /* ---------- pay ---------- */
  function tenderedCentavos() {
    if (!state.tenderText) return cartTotal(); /* empty = exact */
    var v = money.parse(state.tenderText);
    return v == null ? null : v;
  }

  function currentChange() {
    var t = tenderedCentavos();
    if (t == null) return null;
    return cash.change(cartTotal(), t);
  }

  function renderPay() {
    var total = cartTotal();
    $("pay-total").textContent = money.peso(total);
    document.querySelectorAll("#pay-methods .pay-method").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-method") === state.payMethod ||
        (state.payMethod === "ONLINE" && b.getAttribute("data-method") === (state.platformName || "")));
    });
    /* methods: CASH, GCash, Maya — store payMethod as CASH or the platform name */
    document.querySelectorAll("#pay-methods .pay-method").forEach(function (b) {
      var m = b.getAttribute("data-method");
      var on = (m === "CASH" && state.payMethod === "CASH") || (m !== "CASH" && state.payMethod === m);
      b.classList.toggle("on", on);
    });
    var cashOn = state.payMethod === "CASH";
    $("cash-pad").classList.toggle("hidden", !cashOn);
    $("pay-hint").textContent = cashOn ? "Leave the amount blank for exact change, or tap a bill." : "No cash drawer — mark this as paid when the transfer is in.";
    if (cashOn) {
      var tend = tenderedCentavos();
      $("tender-display").textContent = state.tenderText === "" ? "Exact" : (tend == null ? "—" : money.peso(tend));
      var ch = currentChange();
      var chEl = $("change-display");
      if (ch == null) {
        chEl.textContent = "Too short";
        chEl.classList.add("short");
      } else {
        chEl.textContent = money.peso(ch);
        chEl.classList.remove("short");
      }
      var chips = $("quick-cash");
      chips.innerHTML = "";
      cash.suggest(total).forEach(function (amt) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "chip" + (state.tenderText !== "" && tend === amt ? " on" : "");
        b.textContent = amt === total ? "Exact" : money.peso(amt);
        b.addEventListener("click", function () {
          state.tenderText = money.plain(amt);
          renderPay();
        });
        chips.appendChild(b);
      });
    }
    var ok = state.cart.length > 0 && (state.payMethod !== "CASH" || currentChange() != null);
    $("btn-confirm-pay").disabled = !ok;
  }

  function onKey(k) {
    if (k === "C") { state.tenderText = ""; renderPay(); return; }
    if (k === "⌫") { state.tenderText = state.tenderText.slice(0, -1); renderPay(); return; }
    if (state.tenderText.length >= 10) return;
    if (k === "." && state.tenderText.indexOf(".") !== -1) return;
    if (k === "." && !state.tenderText) state.tenderText = "0";
    /* after two decimal digits, ignore more */
    var dot = state.tenderText.indexOf(".");
    if (dot !== -1 && state.tenderText.length - dot > 2 && k !== "00") return;
    if (k === "00") {
      if (dot !== -1) return;
      state.tenderText += "00";
    } else {
      if (state.tenderText === "0" && k !== ".") state.tenderText = k;
      else state.tenderText += k;
    }
    renderPay();
  }

  function buildKeypad() {
    var pad = $("keypad");
    pad.innerHTML = "";
    ["1","2","3","4","5","6","7","8","9",".","0","⌫"].forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "key";
      b.textContent = k;
      b.addEventListener("click", function () { onKey(k); });
      pad.appendChild(b);
    });
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "key";
    clear.textContent = "C";
    clear.style.gridColumn = "1 / -1";
    clear.addEventListener("click", function () { onKey("C"); });
    pad.appendChild(clear);
  }

  function openPay() {
    if (!state.cart.length) return;
    state.payMethod = "CASH";
    state.tenderText = "";
    showView("pay");
  }

  function confirmPay() {
    if (!state.cart.length) return;
    var total = cartTotal();
    var isCash = state.payMethod === "CASH";
    var tend = isCash ? tenderedCentavos() : total;
    var ch = isCash ? cash.change(total, tend) : 0;
    if (isCash && (tend == null || ch == null)) { renderPay(); return; }
    var lines = state.cart.map(function (ln) {
      return { qty: ln.qty, name: ln.name, unitCentavos: ln.unitCentavos, lineCentavos: ln.qty * ln.unitCentavos };
    });
    $("btn-confirm-pay").disabled = true;
    return storage.recordSale({
      customerName: state.customerName,
      lines: lines,
      totalCentavos: total,
      paymentType: isCash ? "CASH" : "ONLINE",
      platformName: isCash ? null : state.payMethod,
      tenderedCentavos: isCash ? tend : null,
      changeCentavos: isCash ? ch : null
    }).then(function (sale) {
      state.sales.unshift(sale);
      state.currentSale = sale;
      state.receiptFromHistory = false;
      state.cart = [];
      state.customerName = "";
      $("customer-name").value = "";
      renderCart();
      tickClock();
      openReceipt(sale, false);
    }).catch(function () {
      $("pay-hint").textContent = "The sale could not be saved. Please try again.";
      $("btn-confirm-pay").disabled = false;
    });
  }

  function openReceipt(sale, fromHistory) {
    state.currentSale = sale;
    state.receiptFromHistory = !!fromHistory;
    receipt.render(sale, state.settings, $("receipt-mount"));
    $("btn-receipt-close").textContent = fromHistory ? "Back to history" : "Close";
    showView("receipt");
  }

  function newOrder() {
    closeCustomerView();
    clearCart();
    state.currentSale = null;
    goCounter();
  }

  /* ---------- orders / calling ---------- */
  function speakCall(sale) {
    var text = receipt.callText(sale);
    if (!window.speechSynthesis) return;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  function waitLabel(from, now) {
    var m = Math.max(0, Math.floor((now - from) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " min";
    return Math.floor(m / 60) + " h " + (m % 60) + " min";
  }

  function clockLabel(from, now) {
    var s = Math.max(0, Math.floor((now - from) / 1000));
    var mm = String(Math.floor(s / 60));
    var ss = s % 60;
    return mm + ":" + (ss < 10 ? "0" : "") + ss;
  }

  function isLate(s, now) {
    return s.status === "PREPARING" && (now - s.paidAt) >= LATE_MS;
  }

  function updateSaleStatus(sale, patch) {
    var next = Object.assign({}, sale, patch);
    return storage.updateSale(next).then(function () {
      state.sales = state.sales.map(function (s) { return s.id === next.id ? next : s; });
      if (state.currentSale && state.currentSale.id === next.id) state.currentSale = next;
      tickClock();
      if (state.view === "orders") renderOrders();
      return next;
    });
  }

  function callOrder(sale, again) {
    var nextCount = (sale.callCount || 0) + 1;
    return updateSaleStatus(sale, { status: "CALLED", callCount: nextCount, statusAtMillis: Date.now() }).then(function (s) {
      speakCall(s);
      return s;
    });
  }

  function markDone(sale) {
    return updateSaleStatus(sale, { status: "PICKED_UP", statusAtMillis: Date.now() });
  }

  function undoDone(sale) {
    return updateSaleStatus(sale, { status: "CALLED", statusAtMillis: Date.now() });
  }

  function renderOrders() {
    var now = Date.now();
    var day = todayKey();
    var live = state.sales.filter(function (s) {
      return s.dayKey === day && (s.status === "PREPARING" || s.status === "CALLED");
    });
    var preparing = live.filter(function (s) { return s.status === "PREPARING"; })
      .sort(function (a, b) { return b.paidAt - a.paidAt; });
    var calling = live.filter(function (s) { return s.status === "CALLED"; })
      .sort(function (a, b) { return b.statusAtMillis - a.statusAtMillis; });
    var done = state.sales.filter(function (s) {
      return s.dayKey === day && (s.status === "PICKED_UP" || s.status === "CLOSED");
    }).sort(function (a, b) { return b.statusAtMillis - a.statusAtMillis; });

    $("btn-done-tab").textContent = "Done today · " + done.length;
    document.querySelectorAll("#orders-tabs .chip").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-otab") === state.ordersTab);
    });

    var box = $("orders-list");
    box.innerHTML = "";

    function card(s, kind) {
      var el = document.createElement("article");
      var late = isLate(s, now);
      var fresh = s.status === "PREPARING" && (now - s.paidAt) < FRESH_MS;
      el.className = "order-card" + (late ? " late" : "") + (fresh ? " fresh" : "") + (s.status === "CALLED" ? " calling" : "");
      var tag;
      if (late) tag = "Late · " + waitLabel(s.paidAt, now);
      else if (fresh) tag = "NEW";
      else if (s.status === "CALLED") tag = "Called " + s.callCount + "× · " + clockLabel(s.statusAtMillis, now);
      else if (s.status === "PICKED_UP") tag = "Done · " + waitLabel(s.statusAtMillis, now) + " ago";
      else if (s.status === "CLOSED") tag = "Closed";
      else tag = waitLabel(s.paidAt, now);
      var items = s.lines.map(function (ln) { return ln.qty + " × " + ln.name; }).join(", ");
      el.innerHTML =
        '<div class="order-top">' +
          '<div><div class="order-no"></div><div class="order-name"></div></div>' +
          '<div class="order-tag"></div>' +
        '</div>' +
        '<div class="order-items"></div>' +
        '<div class="order-actions"></div>';
      el.querySelector(".order-no").textContent = s.orderNo;
      el.querySelector(".order-name").textContent = s.customerName || "—";
      el.querySelector(".order-tag").textContent = tag;
      el.querySelector(".order-items").textContent = items + " · " + money.peso(s.totalCentavos);
      var actions = el.querySelector(".order-actions");
      if (s.status === "PREPARING") {
        var callBtn = document.createElement("button");
        callBtn.type = "button";
        callBtn.className = "gold-btn";
        callBtn.textContent = "Ready · Call";
        callBtn.addEventListener("click", function () { callOrder(s, false); });
        actions.appendChild(callBtn);
      } else if (s.status === "CALLED") {
        var again = document.createElement("button");
        again.type = "button";
        again.className = "outline-btn";
        again.textContent = "Again";
        again.addEventListener("click", function () { callOrder(s, true); });
        var doneBtn = document.createElement("button");
        doneBtn.type = "button";
        doneBtn.className = "gold-btn";
        doneBtn.textContent = "Done";
        doneBtn.addEventListener("click", function () { markDone(s); });
        actions.appendChild(again);
        actions.appendChild(doneBtn);
      } else if (s.status === "PICKED_UP") {
        var undo = document.createElement("button");
        undo.type = "button";
        undo.className = "outline-btn muted";
        undo.textContent = "Undo done";
        undo.addEventListener("click", function () { undoDone(s); });
        actions.appendChild(undo);
      }
      box.appendChild(el);
    }

    if (state.ordersTab === "done") {
      if (!done.length) box.innerHTML = '<p class="empty">No finished orders yet today.</p>';
      else done.forEach(function (s) { card(s, "done"); });
      return;
    }
    if (!preparing.length && !calling.length) {
      box.innerHTML = '<p class="empty">No open orders. New paid orders will show up here.</p>';
      return;
    }
    if (preparing.length) {
      var h1 = document.createElement("div");
      h1.className = "order-sec";
      h1.textContent = "Preparing";
      box.appendChild(h1);
      preparing.forEach(function (s) { card(s, "prep"); });
    }
    if (calling.length) {
      var h2 = document.createElement("div");
      h2.className = "order-sec";
      h2.textContent = "Calling";
      box.appendChild(h2);
      calling.forEach(function (s) { card(s, "call"); });
    }
  }

  /* ---------- history / close day ---------- */
  function renderHistory() {
    var day = todayKey();
    var sales = todaySales();
    var sum = receipt.summarize(day, state.sales);
    $("history-summary").innerHTML =
      '<div class="lbl">Today · ' + day + '</div>' +
      '<div class="sum-grid" style="margin-top:10px">' +
        '<div><div class="sum-k">Orders</div><div class="sum-v">' + sum.orderCount + '</div></div>' +
        '<div><div class="sum-k">Total</div><div class="sum-v">' + money.peso(sum.grossCentavos) + '</div></div>' +
        '<div><div class="sum-k">Cash</div><div class="sum-v">' + money.peso(sum.cashCentavos) + '</div></div>' +
        '<div><div class="sum-k">GCash</div><div class="sum-v">' + money.peso(sum.gcashCentavos) + '</div></div>' +
        '<div><div class="sum-k">Maya</div><div class="sum-v">' + money.peso(sum.mayaCentavos) + '</div></div>' +
        '<div><div class="sum-k">Best seller</div><div class="sum-v" style="font-size:16px">' + (sum.bestSeller ? (sum.bestSeller.name + " · " + sum.bestSeller.qty) : "—") + '</div></div>' +
      '</div>';
    var box = $("history-list");
    box.innerHTML = "";
    if (!sales.length) {
      box.innerHTML = '<p class="empty">No sales yet today.</p>';
      return;
    }
    sales.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "hist-card";
      var items = s.lines.map(function (ln) { return ln.qty + " x " + ln.name; }).join(", ");
      b.innerHTML = '<div class="hist-top"><span></span><span></span></div><div class="hist-sub"></div>';
      b.querySelector(".hist-top span:first-child").textContent = "No. " + s.orderNo + (s.customerName ? " · " + s.customerName : "");
      b.querySelector(".hist-top span:last-child").textContent = money.peso(s.totalCentavos);
      b.querySelector(".hist-sub").textContent = money.formatTime(s.timeMillis) + " · " + receipt.paidLabel(s) + " · " + items + " · " + s.status.replace("_", " ");
      b.addEventListener("click", function () { openReceipt(s, true); });
      box.appendChild(b);
    });
  }

  function openCloseDay() {
    var day = todayKey();
    var sum = receipt.summarize(day, state.sales);
    $("close-summary").innerHTML =
      '<div class="sum-grid">' +
        '<div><div class="sum-k">Orders</div><div class="sum-v">' + sum.orderCount + '</div></div>' +
        '<div><div class="sum-k">Total</div><div class="sum-v">' + money.peso(sum.grossCentavos) + '</div></div>' +
        '<div><div class="sum-k">Cash</div><div class="sum-v">' + money.peso(sum.cashCentavos) + '</div></div>' +
        '<div><div class="sum-k">GCash</div><div class="sum-v">' + money.peso(sum.gcashCentavos) + '</div></div>' +
        '<div><div class="sum-k">Maya</div><div class="sum-v">' + money.peso(sum.mayaCentavos) + '</div></div>' +
      '</div>' +
      (sum.bestSeller ? '<p class="msg">Best seller: ' + sum.bestSeller.name + " (" + sum.bestSeller.qty + ")</p>" : "");
    $("close-modal").classList.remove("hidden");
  }

  function confirmCloseDay() {
    var now = Date.now();
    var day = todayKey();
    var jobs = state.sales.filter(function (s) {
      return s.dayKey === day && s.status !== "PICKED_UP" && s.status !== "CLOSED" && s.status !== "CANCELED";
    }).map(function (s) {
      return updateSaleStatus(s, { status: "CLOSED", statusAtMillis: now });
    });
    return Promise.all(jobs).then(function () {
      $("close-modal").classList.add("hidden");
      renderHistory();
    });
  }

  /* ---------- settings / PIN / menu editor ---------- */
  function openPin(reason) {
    state.pinReason = reason || "settings";
    state.pinBuffer = "";
    $("pin-msg").textContent = "";
    renderPinDots();
    $("pin-modal").classList.remove("hidden");
  }

  function closePin() {
    $("pin-modal").classList.add("hidden");
    state.pinBuffer = "";
  }

  function renderPinDots() {
    var wrap = $("pin-dots");
    wrap.innerHTML = "";
    var i, d;
    for (i = 0; i < 4; i++) {
      d = document.createElement("span");
      d.className = "pin-dot" + (i < state.pinBuffer.length ? " on" : "");
      wrap.appendChild(d);
    }
  }

  function buildPinPad() {
    var pad = $("pin-pad");
    pad.innerHTML = "";
    ["1","2","3","4","5","6","7","8","9","C","0","⌫"].forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "key";
      b.textContent = k;
      b.addEventListener("click", function () { onPin(k); });
      pad.appendChild(b);
    });
  }

  function tryUnlock() {
    var want = String((state.settings && state.settings.pin) || storage.DEFAULT_PIN);
    if (state.pinBuffer.length < want.length) return;
    if (state.pinBuffer === want) {
      closePin();
      if (state.pinReason === "settings") {
        state.settingsUnlocked = true;
        showView("settings");
      }
    } else {
      $("pin-msg").textContent = "That PIN is not right. Try again.";
      state.pinBuffer = "";
      renderPinDots();
    }
  }

  function onPin(k) {
    $("pin-msg").textContent = "";
    if (k === "C") { state.pinBuffer = ""; renderPinDots(); return; }
    if (k === "⌫") { state.pinBuffer = state.pinBuffer.slice(0, -1); renderPinDots(); return; }
    if (state.pinBuffer.length >= 8) return;
    state.pinBuffer += k;
    renderPinDots();
    tryUnlock();
  }

  function requestSettings() {
    if (state.settingsUnlocked) { showView("settings"); return; }
    openPin("settings");
  }

  function setSwitch(el, on) {
    el.classList.toggle("on", !!on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  }

  function renderSettings() {
    var box = $("settings-body");
    document.querySelectorAll("#settings-tabs .chip").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-stab") === state.settingsTab);
    });
    if (state.settingsTab === "menu") {
      box.innerHTML = '<p class="msg">Prices start at ₱0 with a Sample tag until you set the real price. Editing an item removes the tag.</p>' +
        '<div class="row-actions" style="margin-bottom:12px"><button type="button" class="gold-btn" id="btn-add-item">Add item</button></div>' +
        '<div id="editor-list"></div>';
      var list = $("editor-list");
      state.menu.categories.forEach(function (cat) {
        var h = document.createElement("div");
        h.className = "order-sec";
        h.textContent = cat.name;
        list.appendChild(h);
        state.menu.items.filter(function (i) { return i.categoryId === cat.id; }).forEach(function (item) {
          var row = document.createElement("button");
          row.type = "button";
          row.className = "edit-card hist-card";
          row.innerHTML = '<div><div class="edit-name"></div><div class="hist-sub"></div></div><div class="edit-price"></div>';
          row.querySelector(".edit-name").textContent = item.name + (item.favorite ? " ★" : "");
          row.querySelector(".hist-sub").textContent = (item.isExample ? "Sample · " : "") + (isSoldOut(item) ? "Sold out today" : "On the menu");
          row.querySelector(".edit-price").textContent = money.peso(item.priceCentavos);
          row.addEventListener("click", function () { openEdit(item); });
          list.appendChild(row);
        });
      });
      $("btn-add-item").addEventListener("click", function () { openEdit(null); });
      return;
    }
    if (state.settingsTab === "receipt") {
      var s = state.settings || {};
      box.innerHTML =
        '<div class="field"><label for="set-cashier">Cashier name (optional)</label><input id="set-cashier" type="text" maxlength="40"></div>' +
        '<div class="field"><label for="set-care">Care note</label><textarea id="set-care" rows="2" maxlength="160"></textarea></div>' +
        '<div class="field"><label for="set-fb">Facebook or extra line (optional)</label><input id="set-fb" type="text" maxlength="80"></div>' +
        '<div class="toggle"><span>Print “This is not an official receipt.”</span><button type="button" role="switch" id="set-official"><span></span></button></div>' +
        '<p class="msg" id="set-msg"></p>' +
        '<button type="button" class="gold-btn" id="btn-save-receipt">Save receipt text</button>';
      $("set-cashier").value = s.cashier || "";
      $("set-care").value = s.careNote == null ? storage.DEFAULT_CARE : s.careNote;
      $("set-fb").value = s.facebook || storage.DEFAULT_FACEBOOK;
      setSwitch($("set-official"), s.notOfficial !== false);
      $("set-official").addEventListener("click", function () { setSwitch($("set-official"), !$("set-official").classList.contains("on")); });
      $("btn-save-receipt").addEventListener("click", function () {
        storage.setSettings({
          cashier: $("set-cashier").value.trim(),
          careNote: $("set-care").value.trim(),
          facebook: $("set-fb").value.trim() || storage.DEFAULT_FACEBOOK,
          notOfficial: $("set-official").classList.contains("on")
        }).then(function (next) {
          state.settings = next;
          $("set-msg").className = "msg good";
          $("set-msg").textContent = "Saved on this device.";
        });
      });
      return;
    }
    /* PIN tab */
    var stillDefault = String((state.settings && state.settings.pin) || storage.DEFAULT_PIN) === storage.DEFAULT_PIN;
    box.innerHTML =
      (stillDefault ? '<div class="pin-banner">The PIN is still the default (1234). Please change it before a busy day.</div>' : "") +
      '<div class="field"><label for="new-pin">New PIN (4 to 8 digits)</label><input id="new-pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>' +
      '<div class="field"><label for="new-pin2">Type it again</label><input id="new-pin2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>' +
      '<p class="msg" id="pin-save-msg"></p>' +
      '<button type="button" class="gold-btn" id="btn-save-pin">Save PIN</button>' +
      '<p class="msg" style="margin-top:16px">This POS works offline after the first load. Add it to the Home Screen for the most reliable save. ' +
      (state.persistOk ? "Storage is protected on this device." : "If this browser offers it, we have asked to keep the sales data.") + "</p>";
    $("btn-save-pin").addEventListener("click", function () {
      var a = String($("new-pin").value || "").trim();
      var b = String($("new-pin2").value || "").trim();
      var out = $("pin-save-msg");
      if (!/^\d{4,8}$/.test(a)) { out.className = "msg bad"; out.textContent = "Use 4 to 8 digits."; return; }
      if (a !== b) { out.className = "msg bad"; out.textContent = "The two PINs do not match."; return; }
      storage.setSettings({ pin: a }).then(function (next) {
        state.settings = next;
        $("new-pin").value = "";
        $("new-pin2").value = "";
        out.className = "msg good";
        out.textContent = "PIN saved on this device only.";
        renderSettings();
        $("pin-save-msg").className = "msg good";
        $("pin-save-msg").textContent = "PIN saved on this device only.";
      });
    });
  }

  function openEdit(item) {
    state.editingItem = item;
    $("edit-title").textContent = item ? "Edit item" : "Add item";
    $("edit-name").value = item ? item.name : "";
    $("edit-price").value = item ? money.plain(item.priceCentavos) : "0.00";
    setSwitch($("edit-fav"), !!(item && item.favorite));
    setSwitch($("edit-sold"), !!(item && isSoldOut(item)));
    $("edit-msg").textContent = "";
    $("btn-edit-delete").classList.toggle("hidden", !item);
    $("edit-modal").classList.remove("hidden");
  }

  function closeEdit() {
    $("edit-modal").classList.add("hidden");
    state.editingItem = null;
  }

  function saveEdit() {
    var name = String($("edit-name").value || "").trim().replace(/\s+/g, " ");
    var price = money.parse($("edit-price").value);
    var out = $("edit-msg");
    if (!name) { out.className = "msg bad"; out.textContent = "Please enter a name."; return Promise.resolve(); }
    if (price == null || price < 0) { out.className = "msg bad"; out.textContent = "Enter a valid price, for example 150 or 150.00."; return Promise.resolve(); }
    var fav = $("edit-fav").classList.contains("on");
    var sold = $("edit-sold").classList.contains("on");
    var job;
    if (state.editingItem) {
      var next = Object.assign({}, state.editingItem, {
        name: name,
        priceCentavos: price,
        favorite: fav,
        soldOutDay: sold ? todayKey() : null,
        isExample: false
      });
      job = storage.putItem(next);
    } else {
      var cat = state.menu.categories[0];
      if (!cat) { out.className = "msg bad"; out.textContent = "Add a category first."; return Promise.resolve(); }
      var pos = state.menu.items.filter(function (i) { return i.categoryId === cat.id; }).length;
      job = storage.putItem({
        id: storage.nid("item-"),
        categoryId: cat.id,
        name: name,
        priceCentavos: price,
        position: pos,
        isExample: false,
        favorite: fav,
        soldOutDay: sold ? todayKey() : null
      });
    }
    return job.then(function () { return reloadMenu(); }).then(function () { closeEdit(); });
  }

  function deleteEdit() {
    if (!state.editingItem) return Promise.resolve();
    if (!confirm("Remove " + state.editingItem.name + " from the menu? Past sales will keep the name.")) return Promise.resolve();
    return storage.deleteItem(state.editingItem.id).then(function () { return reloadMenu(); }).then(function () { closeEdit(); });
  }

  function reloadMenu() {
    return storage.getMenu().then(function (menu) {
      state.menu = menu;
      renderCategories();
      renderMenu();
      if (state.view === "settings") renderSettings();
    });
  }

  function reloadSales() {
    return storage.getSales().then(function (rows) { state.sales = rows; tickClock(); });
  }

  /* ---------- persist + SW ---------- */
  function requestPersist() {
    if (!navigator.storage || !navigator.storage.persist) {
      state.persistOk = false;
      return Promise.resolve(false);
    }
    return navigator.storage.persist().then(function (ok) {
      state.persistOk = !!ok;
      if (!ok && navigator.storage.persisted) {
        return navigator.storage.persisted().then(function (already) {
          state.persistOk = !!already;
          return state.persistOk;
        });
      }
      return state.persistOk;
    }).catch(function () { state.persistOk = false; return false; });
  }

  /* ---------- wire ---------- */
  function wire() {
    buildKeypad();
    buildPinPad();
    setAppHeight();
    window.addEventListener("resize", function () { setAppHeight(); fitSlip(); });
    window.addEventListener("orientationchange", function () { setTimeout(function () { setAppHeight(); fitSlip(); }, 80); });
    if (window.visualViewport) {
      visualViewport.addEventListener("resize", function () { setAppHeight(); fitSlip(); });
      visualViewport.addEventListener("scroll", setAppHeight);
    }

    $("nav-counter").addEventListener("click", function () { showView("counter"); });
    $("nav-orders").addEventListener("click", function () { showView("orders"); });
    $("nav-history").addEventListener("click", function () { showView("history"); });
    $("nav-settings").addEventListener("click", requestSettings);

    $("btn-clear-cart").addEventListener("click", function () {
      if (!state.cart.length) return;
      clearCart();
    });
    $("customer-name").addEventListener("input", function () {
      state.customerName = $("customer-name").value;
    });
    $("btn-pay").addEventListener("click", openPay);
    $("btn-pay-back").addEventListener("click", function () { showView("counter"); });
    document.querySelectorAll("#pay-methods .pay-method").forEach(function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-method");
        state.payMethod = m;
        renderPay();
      });
    });
    $("btn-confirm-pay").addEventListener("click", confirmPay);
    $("btn-new-order").addEventListener("click", newOrder);
    $("btn-receipt-close").addEventListener("click", function () {
      closeCustomerView();
      if (state.receiptFromHistory) showView("history");
      else showView("orders");
    });
    $("btn-show-customer").addEventListener("click", openCustomerView);
    $("btn-customer-close").addEventListener("click", function (e) {
      e.stopPropagation();
      closeCustomerView();
    });
    $("customer-stage").addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".slip-shell")) return;
      closeCustomerView();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.customerOpen) closeCustomerView();
    });
    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && state.customerOpen) closeCustomerView();
    });
    document.addEventListener("webkitfullscreenchange", function () {
      if (!document.webkitFullscreenElement && state.customerOpen) closeCustomerView();
    });

    document.querySelectorAll("#orders-tabs .chip").forEach(function (b) {
      b.addEventListener("click", function () {
        state.ordersTab = b.getAttribute("data-otab");
        renderOrders();
      });
    });
    document.querySelectorAll("#settings-tabs .chip").forEach(function (b) {
      b.addEventListener("click", function () {
        state.settingsTab = b.getAttribute("data-stab");
        renderSettings();
      });
    });

    $("btn-export-csv").addEventListener("click", function () {
      receipt.downloadCsv(todaySales(), todayKey());
    });
    $("btn-close-day").addEventListener("click", openCloseDay);
    $("btn-close-cancel").addEventListener("click", function () { $("close-modal").classList.add("hidden"); });
    $("btn-close-confirm").addEventListener("click", confirmCloseDay);
    $("btn-pin-cancel").addEventListener("click", closePin);
    $("btn-edit-cancel").addEventListener("click", closeEdit);
    $("btn-edit-save").addEventListener("click", saveEdit);
    $("btn-edit-delete").addEventListener("click", deleteEdit);
    $("edit-fav").addEventListener("click", function () { setSwitch($("edit-fav"), !$("edit-fav").classList.contains("on")); });
    $("edit-sold").addEventListener("click", function () { setSwitch($("edit-sold"), !$("edit-sold").classList.contains("on")); });

    /* Allow clicking modal backdrop to close (not the sheet). */
    ["pin-modal", "edit-modal", "close-modal"].forEach(function (id) {
      $(id).addEventListener("click", function (e) {
        if (e.target === $(id)) $(id).classList.add("hidden");
      });
    });
  }

  /* ---------- QA hooks for Playwright ---------- */
  window.__bbposQA = {
    state: function () { return state; },
    go: showView,
    addByName: function (name) {
      var item = state.menu.items.filter(function (i) { return i.name === name; })[0];
      if (!item) throw new Error("No item named " + name);
      addToCart(item);
      return cartTotal();
    },
    setQty: setQty,
    setName: function (n) { state.customerName = n; $("customer-name").value = n; },
    cartTotal: cartTotal,
    openPay: openPay,
    setPayMethod: function (m) { state.payMethod = m; renderPay(); },
    setTender: function (text) { state.tenderText = String(text); renderPay(); },
    confirmPay: confirmPay,
    setPrice: function (name, pesosText) {
      var item = state.menu.items.filter(function (i) { return i.name === name; })[0];
      if (!item) return Promise.reject(new Error("No item named " + name));
      var price = money.parse(String(pesosText));
      var next = Object.assign({}, item, { priceCentavos: price, isExample: false });
      return storage.putItem(next).then(reloadMenu);
    },
    todaySales: todaySales,
    lastSale: function () { return state.currentSale || todaySales()[0] || null; },
    callFirst: function () {
      var s = state.sales.filter(function (x) { return x.status === "PREPARING"; })[0];
      return s ? callOrder(s, false) : Promise.resolve(null);
    },
    markFirstDone: function () {
      var s = state.sales.filter(function (x) { return x.status === "CALLED"; })[0];
      return s ? markDone(s) : Promise.resolve(null);
    },
    unlockSettings: function () { state.settingsUnlocked = true; showView("settings"); },
    summarizeToday: function () { return receipt.summarize(todayKey(), state.sales); },
    closeDay: confirmCloseDay,
    money: money,
    reload: function () { return Promise.all([reloadMenu(), reloadSales()]); },
    openReceipt: function (sale, fromHistory) { openReceipt(sale || this.lastSale(), !!fromHistory); },
    showCustomer: openCustomerView,
    closeCustomer: closeCustomerView,
    measureReceipt: function () {
      var root = document.getElementById("receipt-mount") || document;
      var item = root.querySelector(".slip-item");
      var amt = root.querySelector(".slip-amt");
      var total = document.getElementById("receipt-total");
      var official = root.querySelector(".slip-official");
      var btn = document.getElementById("btn-new-order");
      var logo = root.querySelector(".slip-logo");
      function px(el, prop) {
        if (!el) return 0;
        return parseFloat(getComputedStyle(el)[prop] || "0");
      }
      function noteFonts(scope) {
        return Array.prototype.map.call(scope.querySelectorAll(".slip-note, .slip-care"), function (n) {
          return { text: (n.textContent || "").trim(), fontPx: px(n, "fontSize") };
        });
      }
      function logoInfo(img) {
        if (!img) return { widthPx: 0, cssWidthPx: 0, blend: "", bg: "", corners: [] };
        var info = {
          widthPx: img.getBoundingClientRect().width,
          cssWidthPx: px(img, "width"),
          blend: getComputedStyle(img).mixBlendMode,
          bg: getComputedStyle(img).backgroundColor,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          corners: []
        };
        try {
          var c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          var pts = [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1]];
          info.corners = pts.map(function (pt) {
            var d = ctx.getImageData(pt[0], pt[1], 1, 1).data;
            return { r: d[0], g: d[1], b: d[2], a: d[3] };
          });
          var opaqueWhite = 0, sampled = 0;
          var stepX = Math.max(1, Math.floor(c.width / 40));
          var stepY = Math.max(1, Math.floor(c.height / 40));
          for (var y = 0; y < c.height; y += stepY) {
            for (var x = 0; x < c.width; x += stepX) {
              var p = ctx.getImageData(x, y, 1, 1).data;
              sampled += 1;
              if (p[3] > 200 && p[0] > 240 && p[1] > 240 && p[2] > 240) opaqueWhite += 1;
            }
          }
          info.opaqueWhiteSamples = opaqueWhite;
          info.sampled = sampled;
        } catch (e) {
          info.canvasError = String(e);
        }
        return info;
      }
      var customerRoot = document.getElementById("customer-mount");
      var customerShell = customerRoot ? customerRoot.querySelector(".slip-shell") : null;
      var stage = document.getElementById("customer-stage");
      var overlay = document.getElementById("customer-overlay");
      var customer = null;
      if (customerShell && stage && overlay && !overlay.classList.contains("hidden")) {
        var slipR = customerShell.getBoundingClientRect();
        var stageR = stage.getBoundingClientRect();
        var overR = overlay.getBoundingClientRect();
        var eps = 2;
        var body = customerShell.querySelector(".slip-body");
        var scroll = customerShell.querySelector(".slip-scroll") || body;
        var bodyCanScroll = !!(scroll && scroll.scrollHeight > scroll.clientHeight + 2);
        var cut = [];
        Array.prototype.forEach.call(customerShell.querySelectorAll("div, span, img"), function (el) {
          if (el.classList && (el.classList.contains("slip-more") || el.classList.contains("slip-more-fade") || el.classList.contains("slip-more-strip") || el.classList.contains("slip-more-hint") || el.classList.contains("slip-top-fade") || el.classList.contains("slip-tear"))) return;
          var r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return;
          var clipEl = el.closest(".slip-scroll") || el.closest(".slip-body") || customerShell;
          var cr = clipEl.getBoundingClientRect();
          var inScroll = (clipEl === scroll || clipEl === body) && bodyCanScroll;
          var visible = r.bottom > cr.top + 1 && r.top < cr.bottom - 1;
          if (!visible && inScroll) return;
          if (r.left < cr.left - 2 || r.right > cr.right + 2) {
            cut.push({ type: "x", text: (el.textContent || "").trim().slice(0, 40) });
          }
          if (!inScroll && (r.top < slipR.top - 2 || r.bottom > slipR.bottom + 2)) {
            cut.push({ type: "y", text: (el.textContent || "").trim().slice(0, 40) });
          }
        });
        function overlap(a, b, pad) {
          pad = pad || 0;
          return a.left < b.right - pad && a.right > b.left + pad && a.top < b.bottom - pad && a.bottom > b.top + pad;
        }
        function clipRect(r, port) {
          return {
            left: Math.max(r.left, port.left),
            top: Math.max(r.top, port.top),
            right: Math.min(r.right, port.right),
            bottom: Math.min(r.bottom, port.bottom)
          };
        }
        function currentScale() {
          var tr = getComputedStyle(customerShell).transform;
          if (!tr || tr === "none") return 1;
          var m = tr.match(/matrix\(([^,]+)/);
          if (m) return Math.abs(parseFloat(m[1])) || 1;
          return 1;
        }
        function hintVisible(el) {
          if (!el || el.hidden) return false;
          var cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") === 0) return false;
          var r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        function safetyAt(scrollTop) {
          if (scroll) scroll.scrollTop = scrollTop;
          updateMoreHint(customerShell);
          var topZ = customerShell.querySelector(".slip-tear-top");
          var botZ = customerShell.querySelector(".slip-tear-bottom");
          var more = customerShell.querySelector(".slip-more");
          var topFade = customerShell.querySelector(".slip-top-fade");
          var strip = customerShell.querySelector(".slip-more-strip");
          var hintEl = customerShell.querySelector(".slip-more-hint");
          var topR = topZ ? topZ.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
          var botR = botZ ? botZ.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
          var port = scroll ? scroll.getBoundingClientRect() : slipR;
          var hits = [];
          var lastBottom = 0;
          var lastText = "";
          var nodes = customerShell.querySelectorAll(".slip-logo, .slip-brand, .slip-tagline, .slip-city, .slip-ord-label, .slip-ord-no, .slip-cust, .slip-row, .slip-thanks, .slip-note, .slip-care, .slip-official");
          var lineBoxes = [];
          Array.prototype.forEach.call(nodes, function (el) {
            var r = el.getBoundingClientRect();
            if (r.width < 0.5 || r.height < 0.5) return;
            var c = clipRect(r, port);
            if (c.right - c.left < 0.5 || c.bottom - c.top < 0.5) return;
            lineBoxes.push({ el: el, c: c });
            if ((topZ && overlap(c, topR, 0.5)) || (botZ && overlap(c, botR, 0.5))) {
              hits.push({
                text: (el.textContent || el.getAttribute("alt") || "").trim().slice(0, 40),
                top: +c.top.toFixed(2),
                bottom: +c.bottom.toFixed(2),
                zigzag: (topZ && overlap(c, topR, 0.5)) ? "top" : "bottom"
              });
            }
            if (c.bottom > lastBottom) {
              lastBottom = c.bottom;
              lastText = (el.textContent || "").trim().slice(0, 40);
            }
          });
          var hintOn = hintVisible(more);
          var hintOverlaps = [];
          var stripR = null;
          var hintR = null;
          if (hintOn && strip && hintEl) {
            stripR = strip.getBoundingClientRect();
            hintR = hintEl.getBoundingClientRect();
            lineBoxes.forEach(function (item) {
              var c = item.c;
              /* Visible text is the part of the line in the scroll port that is not fully behind the opaque strip. */
              var vis = {
                left: c.left,
                top: c.top,
                right: c.right,
                bottom: Math.min(c.bottom, stripR.top)
              };
              if (vis.bottom - vis.top < 0.5 || vis.right - vis.left < 0.5) return;
              if (overlap(vis, hintR, 0.5)) {
                hintOverlaps.push({
                  text: (item.el.textContent || item.el.getAttribute("alt") || "").trim().slice(0, 40),
                  top: +vis.top.toFixed(2),
                  bottom: +vis.bottom.toFixed(2)
                });
              }
            });
          }
          var scale = currentScale();
          var zoom = parseFloat(document.documentElement.style.zoom || "1") || 1;
          var gapPx = botZ ? (botR.top - lastBottom) : 0;
          var gapCss = scale * zoom ? (gapPx / (scale * zoom)) : gapPx;
          var overflow = !!(scroll && scroll.scrollHeight > scroll.clientHeight + 1);
          var atBottom = !scroll || (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2);
          return {
            scrollTop: scroll ? scroll.scrollTop : 0,
            overflow: overflow,
            atBottom: atBottom,
            hintShown: hintOn,
            topFadeShown: hintVisible(topFade),
            hintOverlaps: hintOverlaps,
            stripHeightPx: stripR ? +stripR.height.toFixed(2) : 0,
            hits: hits,
            lastText: lastText,
            lastLineGapPx: +gapPx.toFixed(2),
            lastLineGapCss: +gapCss.toFixed(2),
            scale: +scale.toFixed(4),
            zoom: zoom
          };
        }
        var savedScroll = scroll ? scroll.scrollTop : 0;
        var zigzagAt0 = safetyAt(0);
        var maxScroll = scroll ? Math.max(0, scroll.scrollHeight - scroll.clientHeight) : 0;
        var zigzagAtMax = safetyAt(maxScroll);
        if (scroll) scroll.scrollTop = savedScroll;
        updateMoreHint(customerShell);
        var custItem = customerRoot.querySelector(".slip-item");
        var custAmt = customerRoot.querySelector(".slip-amt");
        var custTotal = customerRoot.querySelector(".slip-total") || customerRoot.querySelector("#receipt-total");
        customer = {
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
          slipWidthPx: slipR.width,
          slipHeightPx: slipR.height,
          heightRatio: window.innerHeight ? (slipR.height / window.innerHeight) : 0,
          widthRatio: window.innerWidth ? (slipR.width / window.innerWidth) : 0,
          fitsWidth: slipR.width <= window.innerWidth + eps,
          clippedByStage: !(slipR.top >= stageR.top - eps && slipR.bottom <= stageR.bottom + eps && slipR.left >= stageR.left - eps && slipR.right <= stageR.right + eps),
          clippedByOverlay: !(slipR.top >= overR.top - eps && slipR.bottom <= overR.bottom + eps && slipR.left >= overR.left - eps && slipR.right <= overR.right + eps),
          canScroll: bodyCanScroll,
          bodyScrollHeight: scroll ? scroll.scrollHeight : 0,
          bodyClientHeight: scroll ? scroll.clientHeight : 0,
          cutText: cut,
          zigzag: { at0: zigzagAt0, atMax: zigzagAtMax },
          itemFontPx: px(custItem, "fontSize"),
          amtFontPx: px(custAmt, "fontSize"),
          totalFontPx: px(custTotal, "fontSize"),
          totalColor: custTotal ? getComputedStyle(custTotal).color : "",
          footerFonts: noteFonts(customerRoot),
          logo: logoInfo(customerRoot.querySelector(".slip-logo"))
        };
      }
      return {
        itemFontPx: px(item, "fontSize"),
        amtFontPx: px(amt, "fontSize"),
        totalFontPx: px(total, "fontSize"),
        totalColor: total ? getComputedStyle(total).color : "",
        officialWeight: official ? String(getComputedStyle(official).fontWeight) : "",
        officialText: official ? official.textContent : "",
        newOrderHeightPx: btn ? btn.getBoundingClientRect().height : 0,
        brand: (root.querySelector(".slip-brand") || {}).textContent || "",
        facebook: (root.querySelector(".slip-care:last-of-type") && official)
          ? Array.prototype.map.call(root.querySelectorAll(".slip-care"), function (n) { return n.textContent; }).join(" | ")
          : "",
        hasFacebookPH: !!(root.textContent && root.textContent.indexOf("facebook.com/BasqueBlocPH") !== -1),
        footerFonts: noteFonts(root),
        logo: logoInfo(logo),
        customer: customer
      };
    }
  };

  function boot() {
    wire();
    storage.init().then(function () {
      return Promise.all([storage.getSettings(), storage.getMenu(), storage.getSales()]);
    }).then(function (triple) {
      state.settings = triple[0];
      state.menu = triple[1];
      state.sales = triple[2];
      renderCategories();
      renderMenu();
      renderCart();
      tickClock();
      state.clockTimer = setInterval(tickClock, 1000);
      requestPersist();
      showView("counter");
    }).catch(function (err) {
      console.error(err);
      $("menu-grid").innerHTML = '<p class="empty">This browser could not open the local sales store. Avoid private or incognito tabs.</p>';
    });
    if ("serviceWorker" in navigator && !qaMode()) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  boot();
})();
