const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const SHOTS = path.join(__dirname, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { id: "phone_port", width: 390, height: 844 },
  { id: "phone_land", width: 844, height: 390 },
  { id: "android_tab_port", width: 800, height: 1280 },
  { id: "android_tab_land", width: 1280, height: 800 },
  { id: "ipad_mini_port", width: 768, height: 1024 },
  { id: "ipad_mini_land", width: 1024, height: 768 },
  { id: "ipad13_port", width: 1024, height: 1366 },
  { id: "ipad13_land", width: 1366, height: 1024 }
];

/* Sizes Ric asked to re-check for Show customer at ~85% width and <=90% height. */
const CUSTOMER_VIEWPORTS = [
  { id: "phone_port", width: 390, height: 844 },
  { id: "ipad_mini_land", width: 1024, height: 768 },
  { id: "ipad_mini_port", width: 768, height: 1024 },
  { id: "android_tab_land", width: 1280, height: 800 },
  { id: "android_tab_port", width: 800, height: 1280 },
  { id: "ipad13_land", width: 1366, height: 1024 },
  { id: "ipad13_port", width: 1024, height: 1366 }
];


function expectSlipSafe(customer, tag, opts) {
  opts = opts || {};
  expect(customer, tag + " measurements").toBeTruthy();
  if (!opts.skipBox) {
    expect(customer.fitsWidth, tag + " fits width").toBeTruthy();
    expect(customer.clippedByStage, tag + " clipped by stage").toBeFalsy();
    expect(customer.clippedByOverlay, tag + " clipped by overlay").toBeFalsy();
    expect(customer.heightRatio, tag + " height cap").toBeLessThanOrEqual(0.90);
    expect(customer.widthRatio, tag + " width ratio").toBeGreaterThanOrEqual(0.83);
    expect(customer.widthRatio, tag + " width ratio upper").toBeLessThanOrEqual(0.87);
  }
  expect(customer.cutText || [], tag + " cut text").toEqual([]);
  const z = customer.zigzag;
  expect(z, tag + " zigzag metrics").toBeTruthy();
  expect(z.at0.hits || [], tag + " zigzag overlap at top").toEqual([]);
  expect(z.atMax.hits || [], tag + " zigzag overlap at bottom").toEqual([]);
  expect(z.atMax.lastLineGapCss, tag + " last-line gap css px (" + (z.atMax.lastText || "") + ")").toBeGreaterThanOrEqual(11.5);
  expect(z.at0.hintShown, tag + " hint at top").toBe(!!(z.at0.overflow && !z.at0.atBottom));
  expect(z.atMax.hintShown, tag + " hint at bottom").toBe(false);
  expect(z.at0.topFadeShown, tag + " top fade at top").toBe(false);
  expect(z.atMax.topFadeShown, tag + " top fade at bottom").toBe(!!z.atMax.overflow);
}


async function scrollCustomerSlip(page, where) {
  await page.evaluate((where) => {
    const sc = document.querySelector("#customer-mount .slip-scroll");
    if (!sc) return;
    if (where === "mid") {
      sc.scrollTop = Math.round(Math.max(0, sc.scrollHeight - sc.clientHeight) / 2);
    } else if (where === true || where === "bottom") {
      sc.scrollTop = sc.scrollHeight;
    } else {
      sc.scrollTop = 0;
    }
  }, where);
  await page.waitForTimeout(80);
}

async function ready(page) {
  await page.waitForFunction(() => window.__bbposQA && window.__bbposQA.state().menu.items.length > 0);
}

async function seedPrices(page) {
  await page.evaluate(async () => {
    await window.__bbposQA.setPrice("Classic Slice", "150");
    await window.__bbposQA.setPrice("Ube Slice", "160");
    await window.__bbposQA.setPrice("Strawberry Cup", "95");
    await window.__bbposQA.setPrice("Iced Latte", "90");
  });
}

test.describe.configure({ mode: "serial" });

test("full cash checkout, receipt, history, reload, offline", async ({ page, context, browser }) => {
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?qa=1");
  await ready(page);
  await seedPrices(page);

  /* 2 Classic Slice (150) + 1 Ube Slice (160) + 1 Iced Latte (90) = 550 */
  await page.evaluate(() => {
    window.__bbposQA.addByName("Classic Slice");
    window.__bbposQA.addByName("Classic Slice");
    window.__bbposQA.addByName("Ube Slice");
    window.__bbposQA.addByName("Iced Latte");
    window.__bbposQA.setName("Anna");
  });
  const total = await page.evaluate(() => window.__bbposQA.cartTotal());
  expect(total).toBe(55000);

  await page.locator("#btn-pay").click();
  await expect(page.locator("#view-pay")).toBeVisible();
  await expect(page.locator("#pay-total")).toHaveText("₱550");

  await page.evaluate(() => window.__bbposQA.setTender("1000"));
  await expect(page.locator("#change-display")).toHaveText("₱450");

  await page.locator("#btn-confirm-pay").click();
  await expect(page.locator("#view-receipt")).toBeVisible();
  await expect(page.locator(".slip-ord-no")).toHaveText("01");
  await expect(page.locator(".slip-cust")).toHaveText("Anna");
  await expect(page.locator("#receipt-total")).toHaveText("₱550.00");
  await expect(page.locator(".slip-change")).toContainText("₱450.00");
  await expect(page.locator(".slip-body")).toContainText("2 x Classic Slice");
  await expect(page.locator(".slip-body")).toContainText("1 x Ube Slice");
  await expect(page.locator(".slip-body")).toContainText("1 x Iced Latte");
  await expect(page.locator(".slip-body")).toContainText("SALAMAT!");
  await expect(page.locator(".slip-body")).toContainText("TAGUM CITY");
  await expect(page.locator(".slip-body")).toContainText("Mindanao's Best Tasting Cheesecake!");
  await expect(page.locator(".slip-body")).toContainText("This is not an official receipt.");
  await expect(page.locator(".slip-brand")).toHaveText("BASQUE BLOC");
  await expect(page.locator(".slip-body")).toContainText("facebook.com/BasqueBlocPH");
  await expect(page.locator("#btn-show-customer")).toBeVisible();

  const measured = await page.evaluate(() => window.__bbposQA.measureReceipt());
  expect(measured.itemFontPx, "item line font").toBeGreaterThanOrEqual(20);
  expect(measured.amtFontPx, "qty/price font").toBeGreaterThanOrEqual(20);
  expect(measured.totalFontPx, "TOTAL font").toBeGreaterThanOrEqual(40);
  expect(measured.totalColor).toBe("rgb(138, 100, 32)"); /* #8A6420 */
  expect(measured.newOrderHeightPx, "New order height").toBeGreaterThanOrEqual(64);
  expect(Number(measured.officialWeight), "official line bold").toBeGreaterThanOrEqual(700);
  expect(measured.officialText).toBe("This is not an official receipt.");
  expect(measured.hasFacebookPH).toBeTruthy();
  expect(measured.logo.cssWidthPx, "logo css width").toBe(120);
  expect(measured.logo.corners.every((c) => c.a === 0), "logo corners transparent").toBeTruthy();
  expect(measured.logo.opaqueWhiteSamples, "no opaque white in logo").toBe(0);
  expect(measured.footerFonts.length).toBeGreaterThanOrEqual(3);
  for (const n of measured.footerFonts) {
    expect(n.fontPx, n.text).toBeGreaterThanOrEqual(14);
  }
  require("fs").mkdirSync(require("path").join(__dirname, "..", "shots", "receipt_v5_1"), { recursive: true });
  require("fs").writeFileSync(
    require("path").join(__dirname, "..", "shots", "receipt_v5_1", "measured.json"),
    JSON.stringify(measured, null, 2)
  );

  /* History — the top bar is hidden on the receipt so the slip can be photographed. */
  await page.evaluate(() => window.__bbposQA.go("history"));
  await expect(page.locator("#view-history")).toBeVisible();
  await expect(page.locator("#history-summary")).toContainText("₱550");
  await expect(page.locator("#history-list")).toContainText("No. 01");
  await expect(page.locator("#history-list")).toContainText("Anna");

  /* Order list still has the preparing order */
  await page.locator("#nav-orders").click();
  await expect(page.locator("#orders-list")).toContainText("01");
  await expect(page.locator("#orders-list")).toContainText("Anna");
  await expect(page.locator("#orders-list")).toContainText("Ready · Call");

  await page.evaluate(() => {
    window.__bbposSpoken = [];
    const synth = window.speechSynthesis;
    if (synth && !synth.__bbposWrapped) {
      const orig = synth.speak.bind(synth);
      synth.speak = function (u) {
        window.__bbposSpoken.push(u && u.text);
        return orig(u);
      };
      synth.__bbposWrapped = true;
    }
  });
  await page.locator(".order-card .gold-btn").click();
  await expect(page.locator("#orders-list")).toContainText("Called 1");
  await expect(page.locator("#orders-list")).toContainText("Again");
  const spoken = await page.evaluate(() => window.__bbposSpoken || []);
  expect(spoken.join(" ")).toContain("Order 1, Anna, your order is ready!");

  /* Reload persistence (same origin, IndexedDB) */
  await page.reload();
  await page.goto("/?qa=1");
  await ready(page);
  const persisted = await page.evaluate(() => {
    const s = window.__bbposQA.todaySales();
    return s.length && s[0].orderNo === "01" && s[0].totalCentavos === 55000 && s[0].changeCentavos === 45000 && s[0].customerName === "Anna" && s[0].status === "CALLED";
  });
  expect(persisted).toBeTruthy();

  /* Offline reload: need the service worker, so load without qa=1, then go offline. */
  const offlinePage = await context.newPage();
  await offlinePage.setViewportSize({ width: 1280, height: 800 });
  await offlinePage.goto("/");
  await offlinePage.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || navigator.serviceWorker.ready);
  /* Give the SW a moment to finish caching if this is the first activate. */
  await offlinePage.waitForTimeout(1500);
  await context.setOffline(true);
  await offlinePage.reload({ waitUntil: "domcontentloaded" });
  await offlinePage.waitForFunction(() => window.__bbposQA && window.__bbposQA.state().menu.items.length > 0);
  const offlineOk = await offlinePage.evaluate(() => {
    const s = window.__bbposQA.todaySales();
    return document.getElementById("view-counter") && s.some((x) => x.orderNo === "01" && x.totalCentavos === 55000);
  });
  expect(offlineOk).toBeTruthy();
  await expect(offlinePage.locator("#nav-counter")).toBeVisible();
  await context.setOffline(false);
  await offlinePage.close();
  expect(consoleErrors, "console errors during checkout").toEqual([]);
});

test("cash ₱200 on ₱150 gives ₱50 change and history reopens the receipt", async ({ page }) => {
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?qa=1");
  await ready(page);
  await seedPrices(page);
  await page.evaluate(async () => {
    window.__bbposQA.state().cart = [];
    window.__bbposQA.addByName("Classic Slice");
    window.__bbposQA.setName("Mia");
    window.__bbposQA.openPay();
    window.__bbposQA.setTender("200");
    await window.__bbposQA.confirmPay();
  });
  await expect(page.locator("#view-receipt")).toBeVisible();
  await expect(page.locator("#receipt-total")).toHaveText("₱150.00");
  await expect(page.locator(".slip-change")).toContainText("₱50.00");
  const orderNo = await page.locator(".slip-ord-no").innerText();
  await page.evaluate(() => window.__bbposQA.go("history"));
  await expect(page.locator("#view-history")).toBeVisible();
  await expect(page.locator("#history-list")).toContainText("Mia");
  await page.locator(".hist-card", { hasText: "Mia" }).first().click();
  await expect(page.locator("#view-receipt")).toBeVisible();
  await expect(page.locator(".slip-ord-no")).toHaveText(orderNo);
  await expect(page.locator(".slip-cust")).toHaveText("Mia");
  await expect(page.locator("#receipt-total")).toHaveText("₱150.00");
  await expect(page.locator(".slip-change")).toContainText("₱50.00");
  expect(consoleErrors, "console errors during ₱50 change sale").toEqual([]);
});

test("screenshots at phone, Android tablet, and 13-inch iPad sizes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?qa=1");
  await ready(page);
  await seedPrices(page);

  const hasSale = await page.evaluate(() => window.__bbposQA.todaySales().length > 0);
  if (!hasSale) {
    await page.evaluate(async () => {
      window.__bbposQA.addByName("Classic Slice");
      window.__bbposQA.addByName("Classic Slice");
      window.__bbposQA.addByName("Ube Slice");
      window.__bbposQA.addByName("Iced Latte");
      window.__bbposQA.setName("Anna");
      window.__bbposQA.openPay();
      window.__bbposQA.setTender("1000");
      await window.__bbposQA.confirmPay();
    });
  } else {
    await page.evaluate(() => {
      const s = window.__bbposQA.todaySales()[0];
      window.__bbposQA.go("receipt");
      /* openReceipt is not exposed; go to history and click, or render via confirm path */
    });
    /* Put a sale on the receipt view */
    await page.evaluate(() => {
      const s = window.__bbposQA.todaySales()[0];
      window.__bbposQA.go("history");
    });
    await page.locator(".hist-card").first().click();
  }

  /* Build a fresh on-screen cart too, then walk views per viewport. */
  await page.locator("#btn-new-order").click().catch(() => {});
  await page.evaluate(() => {
    const st = window.__bbposQA.state();
    st.cart = [];
    window.__bbposQA.addByName("Classic Slice");
    window.__bbposQA.addByName("Ube Slice");
    window.__bbposQA.setName("Carlo");
  });

  const views = [
    { name: "counter", go: async () => { await page.evaluate(() => window.__bbposQA.go("counter")); } },
    { name: "pay", go: async () => { await page.evaluate(() => window.__bbposQA.openPay()); } },
    { name: "receipt", go: async () => {
      await page.evaluate(() => {
        const s = window.__bbposQA.todaySales()[0];
        if (!s) return;
        window.BBReceipt.render(s, window.__bbposQA.state().settings, document.getElementById("receipt-mount"));
        window.__bbposQA.go("receipt");
      });
    } },
    { name: "orders", go: async () => { await page.evaluate(() => window.__bbposQA.go("orders")); } },
    { name: "history", go: async () => { await page.evaluate(() => window.__bbposQA.go("history")); } }
  ];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(200);
    for (const v of views) {
      await v.go();
      await page.waitForTimeout(150);
      await page.screenshot({
        path: path.join(SHOTS, `${vp.id}_${v.name}.png`),
        fullPage: false
      });
    }
  }
});

test("receipt typography, torn edges, and Show customer at every size", async ({ page }) => {
  const recDir = path.join(SHOTS, "receipt_v5_1");
  fs.mkdirSync(recDir, { recursive: true });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?qa=1");
  await ready(page);
  await seedPrices(page);

  const hasSale = await page.evaluate(() => window.__bbposQA.todaySales().length > 0);
  if (!hasSale) {
    await page.evaluate(async () => {
      window.__bbposQA.addByName("Classic Slice");
      window.__bbposQA.addByName("Classic Slice");
      window.__bbposQA.addByName("Ube Slice");
      window.__bbposQA.addByName("Iced Latte");
      window.__bbposQA.setName("Anna");
      window.__bbposQA.openPay();
      window.__bbposQA.setTender("1000");
      await window.__bbposQA.confirmPay();
    });
  } else {
    await page.evaluate(() => window.__bbposQA.openReceipt(window.__bbposQA.todaySales()[0], false));
  }
  await expect(page.locator("#view-receipt")).toBeVisible();
  await page.waitForFunction(() => {
    const img = document.querySelector("#receipt-mount .slip-logo");
    return img && img.complete && img.naturalWidth > 0;
  });
  await page.waitForTimeout(80);

  const measured = await page.evaluate(() => window.__bbposQA.measureReceipt());
  expect(measured.itemFontPx).toBeGreaterThanOrEqual(20);
  expect(measured.amtFontPx).toBeGreaterThanOrEqual(20);
  expect(measured.totalFontPx).toBeGreaterThanOrEqual(40);
  expect(measured.totalColor).toBe("rgb(138, 100, 32)");
  expect(measured.newOrderHeightPx).toBeGreaterThanOrEqual(64);
  expect(Number(measured.officialWeight)).toBeGreaterThanOrEqual(700);
  expect(measured.logo.cssWidthPx).toBe(120);
  expect(measured.logo.corners.every((c) => c.a === 0)).toBeTruthy();
  expect(measured.logo.opaqueWhiteSamples).toBe(0);
  expect(measured.blend || measured.logo.blend).toBeTruthy();
  expect(measured.logo.blend).toBe("multiply");
  for (const n of measured.footerFonts) {
    expect(n.fontPx, n.text).toBeGreaterThanOrEqual(14);
  }
  fs.writeFileSync(path.join(recDir, "measured.json"), JSON.stringify(measured, null, 2));

  /* Overlay fallback must work even when Fullscreen API is missing (iPad Safari). */
  await page.evaluate(() => {
    const el = document.getElementById("customer-overlay");
    el.requestFullscreen = undefined;
    el.webkitRequestFullscreen = undefined;
  });

  const reports = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.evaluate(() => window.__bbposQA.closeCustomer());
    await page.evaluate(() => window.__bbposQA.openReceipt(window.__bbposQA.todaySales()[0], false));
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(recDir, vp.id + "_staff.png"), fullPage: false });
    const staffVis = await page.evaluate(() => {
      const shell = document.querySelector("#receipt-mount .slip-shell");
      if (!shell) return { inView: false };
      const r = shell.getBoundingClientRect();
      return {
        inView: r.bottom > 8 && r.top < window.innerHeight - 8 && r.height > 40 && r.width > 40,
        top: r.top, bottom: r.bottom, width: r.width, height: r.height
      };
    });
    expect(staffVis.inView, vp.id + " staff slip on screen").toBeTruthy();

    await page.locator("#btn-show-customer").click();
    await expect(page.locator("#customer-overlay")).toBeVisible();
    await expect(page.locator("#customer-mount .slip-shell")).toBeVisible();
    await expect(page.locator("#customer-mount")).toContainText("BASQUE BLOC");
    await expect(page.locator("#customer-mount")).toContainText("facebook.com/BasqueBlocPH");
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(recDir, vp.id + "_customer.png"), fullPage: false });

    const cust = await page.evaluate(() => window.__bbposQA.measureReceipt());
    expectSlipSafe(cust.customer, vp.id);
    if (cust.customer.itemFontPx) expect(cust.customer.itemFontPx, vp.id + " item font").toBeGreaterThanOrEqual(20);
    if (cust.customer.amtFontPx) expect(cust.customer.amtFontPx, vp.id + " amt font").toBeGreaterThanOrEqual(20);
    if (cust.customer.totalFontPx) expect(cust.customer.totalFontPx, vp.id + " total font").toBeGreaterThanOrEqual(40);
    for (const n of cust.customer.footerFonts) {
      expect(n.fontPx, vp.id + " " + n.text).toBeGreaterThanOrEqual(14);
    }
    reports.push({ viewport: vp, customer: cust.customer, logoStaff: { width: cust.logo && cust.logo.widthPx, css: cust.logo && cust.logo.cssWidthPx } });

    /* Close button exits. */
    await page.locator("#btn-customer-close").click();
    await expect(page.locator("#customer-overlay")).toBeHidden();

    /* Re-open and a tap on the stage also exits. */
    await page.locator("#btn-show-customer").click();
    await expect(page.locator("#customer-overlay")).toBeVisible();
    await page.locator("#customer-stage").click({ position: { x: 8, y: 8 } });
    await expect(page.locator("#customer-overlay")).toBeHidden();
  }

  /* Also measure the slightly taller 13-inch iPad portrait size Uma named. */
  {
    const vp = { id: "ipad13_port_1032", width: 1032, height: 1376 };
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.evaluate(() => window.__bbposQA.closeCustomer());
    await page.evaluate(() => window.__bbposQA.openReceipt(window.__bbposQA.todaySales()[0], false));
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(recDir, vp.id + "_staff.png"), fullPage: false });
    await page.locator("#btn-show-customer").click();
    await expect(page.locator("#customer-overlay")).toBeVisible();
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(recDir, vp.id + "_customer.png"), fullPage: false });
    const cust = await page.evaluate(() => window.__bbposQA.measureReceipt());
    expectSlipSafe(cust.customer, "1032");
    reports.push({ viewport: vp, customer: cust.customer });
    await page.locator("#btn-customer-close").click();
  }

  /* 150% and 200% page zoom on 13-inch iPad portrait (receipt uses px, so this is zoom, not font inflation). */
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.evaluate(() => window.__bbposQA.closeCustomer());
  await page.evaluate(() => window.__bbposQA.openReceipt(window.__bbposQA.todaySales()[0], false));
  for (const zoom of [1.5, 2]) {
    const tag = "text" + Math.round(zoom * 100);
    await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(recDir, "ipad13_port_staff_" + tag + ".png"), fullPage: false });
    await page.locator("#btn-show-customer").click();
    await expect(page.locator("#customer-overlay")).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(recDir, "ipad13_port_customer_" + tag + ".png"), fullPage: false });
    const zoomed = await page.evaluate(() => window.__bbposQA.measureReceipt());
    expect(zoomed.customer.clippedByOverlay, tag + " clip").toBeFalsy();
    expectSlipSafe(zoomed.customer, "ipad13_port_" + tag, { skipBox: true });
    if (zoom === 2) {
      await scrollCustomerSlip(page, true);
      await page.screenshot({ path: path.join(recDir, "ipad13_port_customer_" + tag + "_bottom.png"), fullPage: false });
      await scrollCustomerSlip(page, false);
    }
    await page.locator("#btn-customer-close").click();
    reports.push({ viewport: { id: "ipad13_port_" + tag, width: 1024, height: 1366, zoom }, customer: zoomed.customer, staffFooter: zoomed.footerFonts, logo: zoomed.logo });
  }
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  /* 1-item and 8-item Show customer at every size Ric asked to re-check. */
  async function checkoutCart(itemCount, customerName, tender) {
    await page.evaluate(async ({ itemCount, customerName, tender }) => {
      const names = window.__bbposQA.state().menu.items.map((i) => i.name);
      if (itemCount === 1) {
        window.__bbposQA.state().cart = [];
        window.__bbposQA.addByName("Classic Slice");
      } else {
        if (names.length < itemCount) throw new Error("menu has only " + names.length + " items");
        window.__bbposQA.state().cart = [];
        names.slice(0, itemCount).forEach((n) => window.__bbposQA.addByName(n));
      }
      window.__bbposQA.setName(customerName);
      window.__bbposQA.openPay();
      window.__bbposQA.setTender(String(tender));
      await window.__bbposQA.confirmPay();
    }, { itemCount, customerName, tender });
    await expect(page.locator("#view-receipt")).toBeVisible();
    await page.evaluate(() => {
      const el = document.getElementById("customer-overlay");
      el.requestFullscreen = undefined;
      el.webkitRequestFullscreen = undefined;
    });
  }

  const sizeReports = [];
  for (const count of [1, 8]) {
    const who = count === 1 ? "One Item" : "Long Order";
    const tender = count === 1 ? "200" : "20000";
    await page.evaluate(() => window.__bbposQA.closeCustomer());
    await checkoutCart(count, who, tender);
    if (count === 1) {
      await expect(page.locator("#receipt-total")).toHaveText("₱150.00");
      await expect(page.locator(".slip-change")).toContainText("₱50.00");
    }
    await page.waitForTimeout(120);
    if (count === 8) {
      await page.screenshot({ path: path.join(recDir, "ipad13_port_staff_long.png"), fullPage: false });
    }
    for (const vp of CUSTOMER_VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.evaluate(() => window.__bbposQA.closeCustomer());
      await page.evaluate(() => window.__bbposQA.openReceipt(window.__bbposQA.lastSale(), false));
      await page.waitForTimeout(120);
      await page.locator("#btn-show-customer").click();
      await expect(page.locator("#customer-overlay")).toBeVisible();
      await page.waitForFunction(() => {
        const img = document.querySelector("#customer-mount .slip-logo");
        return img && img.complete && img.naturalWidth > 0;
      });
      await page.waitForTimeout(160);
      const tag = vp.id + "_" + count + "item";
      await page.screenshot({ path: path.join(recDir, tag + "_customer.png"), fullPage: false });
      if (count === 8 && vp.id === "android_tab_land") {
        await page.screenshot({ path: path.join(recDir, tag + "_customer_more.png"), fullPage: false });
        await scrollCustomerSlip(page, "mid");
        await page.screenshot({ path: path.join(recDir, tag + "_customer_mid.png"), fullPage: false });
        const mid = await page.evaluate(() => {
          const shell = document.querySelector("#customer-mount .slip-shell");
          const sc = document.querySelector("#customer-mount .slip-scroll");
          const more = shell && shell.querySelector(".slip-more");
          const topFade = shell && shell.querySelector(".slip-top-fade");
          return {
            scrollTop: sc ? sc.scrollTop : 0,
            max: sc ? sc.scrollHeight - sc.clientHeight : 0,
            topFade: !!(topFade && !topFade.hidden),
            bottomHint: !!(more && !more.hidden)
          };
        });
        expect(mid.scrollTop, tag + " mid scroll").toBeGreaterThan(1);
        expect(mid.scrollTop, tag + " mid not at bottom").toBeLessThan(mid.max - 1);
        expect(mid.topFade, tag + " mid top fade").toBe(true);
        expect(mid.bottomHint, tag + " mid bottom hint").toBe(true);
      }
      if (count === 8 && (vp.id === "android_tab_land" || vp.id === "phone_port")) {
        await scrollCustomerSlip(page, "bottom");
        await page.screenshot({ path: path.join(recDir, tag + "_customer_bottom.png"), fullPage: false });
        await scrollCustomerSlip(page, "top");
      }
      const measured = await page.evaluate(() => window.__bbposQA.measureReceipt());
      const c = measured.customer;
      expectSlipSafe(c, tag);
      expect(c.itemFontPx, tag + " item font").toBeGreaterThanOrEqual(20);
      expect(c.amtFontPx, tag + " amt font").toBeGreaterThanOrEqual(20);
      expect(c.totalFontPx, tag + " total font").toBeGreaterThanOrEqual(40);
      expect(c.totalColor, tag + " total color").toBe("rgb(138, 100, 32)");
      sizeReports.push({ viewport: { ...vp, items: count }, customer: c });
      await page.locator("#btn-customer-close").click();
      await expect(page.locator("#customer-overlay")).toBeHidden();
    }
  }
  reports.push(...sizeReports);
  fs.writeFileSync(path.join(recDir, "customer_measured.json"), JSON.stringify(reports, null, 2));
  fs.writeFileSync(path.join(recDir, "size_matrix.json"), JSON.stringify(sizeReports, null, 2));
});
