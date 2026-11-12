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
  { id: "ipad13_port", width: 1024, height: 1366 },
  { id: "ipad13_land", width: 1366, height: 1024 }
];

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
  require("fs").mkdirSync(require("path").join(__dirname, "..", "shots", "receipt_v3"), { recursive: true });
  require("fs").writeFileSync(
    require("path").join(__dirname, "..", "shots", "receipt_v3", "measured.json"),
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

  await page.locator(".order-card .gold-btn").click();
  await expect(page.locator("#orders-list")).toContainText("Called 1");
  await expect(page.locator("#orders-list")).toContainText("Again");

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
  const recDir = path.join(SHOTS, "receipt_v3");
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
    expect(cust.customer, "customer measurements").toBeTruthy();
    expect(cust.customer.fitsWidth, vp.id + " fits width").toBeTruthy();
    expect(cust.customer.clippedByStage, vp.id + " clipped by stage").toBeFalsy();
    expect(cust.customer.clippedByOverlay, vp.id + " clipped by overlay").toBeFalsy();
    /* Tall screens can reach ~90% height; short landscape is limited by the Close button. */
    if (vp.height >= 800) {
      expect(cust.customer.heightRatio, vp.id + " height ratio").toBeGreaterThanOrEqual(0.80);
      expect(cust.customer.heightRatio, vp.id + " height ratio upper").toBeLessThanOrEqual(0.96);
    } else {
      expect(cust.customer.heightRatio, vp.id + " short height ratio").toBeGreaterThanOrEqual(0.60);
    }
    /* iPad portrait: grow to about 85% of the viewport width, still within ~90% height. */
    if (vp.height > vp.width && vp.width >= 1000 && vp.width <= 1100) {
      expect(cust.customer.widthRatio, vp.id + " ipad port width ratio").toBeGreaterThanOrEqual(0.80);
      expect(cust.customer.widthRatio, vp.id + " ipad port width ratio upper").toBeLessThanOrEqual(0.90);
      expect(cust.customer.heightRatio, vp.id + " ipad port height cap").toBeLessThanOrEqual(0.92);
    }
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
    expect(cust.customer.clippedByStage).toBeFalsy();
    expect(cust.customer.clippedByOverlay).toBeFalsy();
    expect(cust.customer.widthRatio, "1032 width ratio").toBeGreaterThanOrEqual(0.80);
    expect(cust.customer.widthRatio, "1032 width ratio upper").toBeLessThanOrEqual(0.90);
    expect(cust.customer.heightRatio, "1032 height cap").toBeLessThanOrEqual(0.92);
    expect(cust.customer.heightRatio, "1032 height ratio").toBeGreaterThanOrEqual(0.80);
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
    await page.locator("#btn-customer-close").click();
    reports.push({ viewport: { id: "ipad13_port_" + tag, width: 1024, height: 1366, zoom }, customer: zoomed.customer, staffFooter: zoomed.footerFonts, logo: zoomed.logo });
  }
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  /* Long 8-item order must scale down or scroll, never clip. */
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.evaluate(async () => {
    const names = window.__bbposQA.state().menu.items.map((i) => i.name);
    window.__bbposQA.state().cart = [];
    names.slice(0, 8).forEach((n) => window.__bbposQA.addByName(n));
    window.__bbposQA.setName("Long Order");
    window.__bbposQA.openPay();
    window.__bbposQA.setTender("20000");
    await window.__bbposQA.confirmPay();
  });
  await expect(page.locator("#view-receipt")).toBeVisible();
  await page.waitForTimeout(160);
  await page.screenshot({ path: path.join(recDir, "ipad13_port_staff_long.png"), fullPage: false });
  await page.evaluate(() => {
    const el = document.getElementById("customer-overlay");
    el.requestFullscreen = undefined;
    el.webkitRequestFullscreen = undefined;
  });
  await page.locator("#btn-show-customer").click();
  await expect(page.locator("#customer-overlay")).toBeVisible();
  await page.waitForTimeout(160);
  await page.screenshot({ path: path.join(recDir, "ipad13_port_customer_long.png"), fullPage: false });
  const longM = await page.evaluate(() => window.__bbposQA.measureReceipt());
  expect(longM.customer.clippedByStage, "long order clipped by stage").toBeFalsy();
  expect(longM.customer.clippedByOverlay, "long order clipped by overlay").toBeFalsy();
  expect(longM.customer.fitsWidth, "long order fits width").toBeTruthy();
  expect(longM.customer.widthRatio, "long order width ratio").toBeGreaterThanOrEqual(0.80);
  expect(longM.customer.widthRatio, "long order width ratio upper").toBeLessThanOrEqual(0.90);
  expect(longM.customer.heightRatio, "long order height cap").toBeLessThanOrEqual(0.92);
  reports.push({ viewport: { id: "ipad13_port_long", width: 1024, height: 1366 }, customer: longM.customer });

  fs.writeFileSync(path.join(recDir, "customer_measured.json"), JSON.stringify(reports, null, 2));
});
