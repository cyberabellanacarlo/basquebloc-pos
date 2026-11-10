/* IndexedDB for menu, settings and sales. All data stays on this device. */
(function (global) {
  "use strict";

  var DB_NAME = "basquebloc-pos";
  var DB_VER = 1;
  var DEFAULT_PIN = "1234";
  var db = null;

  var SEED_CATEGORIES = ["Basque", "Cups", "Tarts", "Drinks"];
  var SEED_ITEMS = {
    Basque: ["Classic Slice", "Classic 6\"", "Classic 8\"", "Ube Slice", "Matcha Slice", "Biscoff Slice", "Whole 4\""],
    Cups: ["Strawberry Cup", "Classic Cup", "Blueberry Cup"],
    Tarts: ["Classic Tart", "Cheesecake Tart"],
    Drinks: ["Iced Latte", "Hot Americano", "Iced Tea"]
  };
  var FAVORITES = { "Classic Slice": 1, "Ube Slice": 1, "Strawberry Cup": 1, "Iced Latte": 1 };
  var DEFAULT_CARE = "Best enjoyed within 3 days, kept chilled.";

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv", { keyPath: "key" });
        if (!d.objectStoreNames.contains("categories")) d.createObjectStore("categories", { keyPath: "id" });
        if (!d.objectStoreNames.contains("items")) {
          var items = d.createObjectStore("items", { keyPath: "id" });
          items.createIndex("byCategory", "categoryId", { unique: false });
        }
        if (!d.objectStoreNames.contains("sales")) {
          var sales = d.createObjectStore("sales", { keyPath: "id" });
          sales.createIndex("byDay", "dayKey", { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(stores, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(stores, mode || "readonly");
      var out;
      t.oncomplete = function () { resolve(out); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error("aborted")); };
      var ret = fn(t);
      if (ret && typeof ret.then === "function") {
        ret.then(function (v) { out = v; }, reject);
      } else {
        out = ret;
      }
    });
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function nid(prefix) {
    if (global.crypto && crypto.randomUUID) return (prefix || "") + crypto.randomUUID();
    return (prefix || "") + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function defaultSettings() {
    return {
      key: "settings",
      pin: DEFAULT_PIN,
      cashier: "",
      careNote: DEFAULT_CARE,
      facebook: "",
      notOfficial: true,
      receiptSeq: 0,
      persistOk: false
    };
  }

  function seedIfEmpty() {
    return tx(["categories", "items", "kv"], "readwrite", function (t) {
      var cats = t.objectStore("categories");
      var items = t.objectStore("items");
      var kv = t.objectStore("kv");
      /* Use onsuccess (not Promise.then) so puts stay inside this transaction. */
      var countReq = cats.count();
      countReq.onsuccess = function () {
        if (countReq.result > 0) return;
        SEED_CATEGORIES.forEach(function (name, i) {
          var id = "cat-" + (i + 1);
          cats.put({ id: id, name: name, position: i });
          (SEED_ITEMS[name] || []).forEach(function (item, j) {
            items.put({
              id: "item-" + id + "-" + j,
              categoryId: id,
              name: item,
              priceCentavos: 0,
              position: j,
              isExample: true,
              favorite: !!FAVORITES[item],
              soldOutDay: null
            });
          });
        });
      };
      var sReq = kv.get("settings");
      sReq.onsuccess = function () {
        if (!sReq.result) kv.put(defaultSettings());
      };
    });
  }

  function init() {
    return openDb().then(function (d) {
      db = d;
      return seedIfEmpty();
    });
  }

  function getSettings() {
    return tx(["kv"], "readonly", function (t) {
      return req(t.objectStore("kv").get("settings"));
    }).then(function (s) { return s || defaultSettings(); });
  }

  function setSettings(partial) {
    return getSettings().then(function (s) {
      var next = Object.assign({}, s, partial, { key: "settings" });
      return tx(["kv"], "readwrite", function (t) {
        t.objectStore("kv").put(next);
        return next;
      });
    });
  }

  function getMenu() {
    return tx(["categories", "items"], "readonly", function (t) {
      return Promise.all([
        req(t.objectStore("categories").getAll()),
        req(t.objectStore("items").getAll())
      ]);
    }).then(function (pair) {
      var cats = (pair[0] || []).slice().sort(function (a, b) { return a.position - b.position; });
      var items = (pair[1] || []).slice().sort(function (a, b) {
        if (a.categoryId !== b.categoryId) return a.categoryId < b.categoryId ? -1 : 1;
        return a.position - b.position;
      });
      return { categories: cats, items: items };
    });
  }

  function putCategory(cat) {
    return tx(["categories"], "readwrite", function (t) { t.objectStore("categories").put(cat); return cat; });
  }

  function putItem(item) {
    return tx(["items"], "readwrite", function (t) { t.objectStore("items").put(item); return item; });
  }

  function deleteItem(id) {
    return tx(["items"], "readwrite", function (t) { t.objectStore("items").delete(id); });
  }

  function deleteCategory(id) {
    return getMenu().then(function (menu) {
      return tx(["categories", "items"], "readwrite", function (t) {
        t.objectStore("categories").delete(id);
        menu.items.forEach(function (it) {
          if (it.categoryId === id) t.objectStore("items").delete(it.id);
        });
      });
    });
  }

  function getSales() {
    return tx(["sales"], "readonly", function (t) {
      return req(t.objectStore("sales").getAll());
    }).then(function (rows) {
      return (rows || []).slice().sort(function (a, b) { return b.timeMillis - a.timeMillis; });
    });
  }

  function getSalesForDay(day) {
    return tx(["sales"], "readonly", function (t) {
      return req(t.objectStore("sales").index("byDay").getAll(day));
    }).then(function (rows) {
      return (rows || []).slice().sort(function (a, b) { return b.timeMillis - a.timeMillis; });
    });
  }

  function getSale(id) {
    return tx(["sales"], "readonly", function (t) { return req(t.objectStore("sales").get(id)); });
  }

  function nextOrderSeq(dayKey) {
    return getSalesForDay(dayKey).then(function (rows) {
      var max = 0;
      rows.forEach(function (s) { if (s.orderSeq > max) max = s.orderSeq; });
      return max + 1;
    });
  }

  function addSale(sale) {
    return tx(["sales"], "readwrite", function (t) { t.objectStore("sales").put(sale); return sale; });
  }

  function updateSale(sale) {
    return addSale(sale);
  }

  function recordSale(input) {
    var now = input.timeMillis || Date.now();
    var day = global.BBMoney.dayKey(now);
    return Promise.all([nextOrderSeq(day), getSettings()]).then(function (pair) {
      var seq = pair[0];
      var settings = pair[1];
      var receiptSeq = (settings.receiptSeq || 0) + 1;
      var sale = {
        id: nid("sale-"),
        receiptNo: String(receiptSeq).padStart(6, "0"),
        dayKey: day,
        orderSeq: seq,
        orderNo: global.BBMoney.orderNo(seq),
        customerName: (input.customerName || "").trim(),
        timeMillis: now,
        lines: input.lines,
        totalCentavos: input.totalCentavos,
        paymentType: input.paymentType,
        platformName: input.platformName || null,
        tenderedCentavos: input.tenderedCentavos == null ? null : input.tenderedCentavos,
        changeCentavos: input.changeCentavos == null ? null : input.changeCentavos,
        status: "PREPARING",
        callCount: 0,
        paidAt: now,
        statusAtMillis: now
      };
      return setSettings({ receiptSeq: receiptSeq }).then(function () { return addSale(sale); });
    });
  }

  global.BBStorage = {
    DEFAULT_PIN: DEFAULT_PIN,
    DEFAULT_CARE: DEFAULT_CARE,
    nid: nid,
    init: init,
    getSettings: getSettings,
    setSettings: setSettings,
    getMenu: getMenu,
    putCategory: putCategory,
    putItem: putItem,
    deleteItem: deleteItem,
    deleteCategory: deleteCategory,
    getSales: getSales,
    getSalesForDay: getSalesForDay,
    getSale: getSale,
    addSale: addSale,
    updateSale: updateSale,
    recordSale: recordSale,
    nextOrderSeq: nextOrderSeq
  };
})(window);
