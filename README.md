# Basque Bloc POS (web)

A basic, single-device, fully offline point-of-sale website for **The Basque Bloc**, Tagum, Philippines.

After each sale the full receipt is shown large on screen so the customer can read it or take a photo. There is no printer and no Bluetooth in this version.

Live: <https://cyberabellanacarlo.github.io/basquebloc-pos/>

## On a tablet or phone

1. Open the link in **Android Chrome** or **iPad Safari**.
2. Add it to the Home Screen (browser menu → Add to Home Screen / Add to Dock).
3. Use it from that icon so sales stay saved even without internet.

The first visit needs a connection so the app can download. After that it works offline.

## What it does

- **Counter** — menu grid, cart with +/−, optional customer name, Pay.
- **Checkout** — Cash (amount tendered, quick-cash bills, change) or GCash / Maya as a simple paid label. No discounts, no Senior/PWD, no VAT switch.
- **On-screen receipt** — looks like a thermal slip: business name, order number, items, totals, payment, change, date and time, footer. Tap **New order** when the customer is done photographing it.
- **Order List** — same device, Preparing → Ready · Call (speaks “Order 12, Anna, your order is ready!”) → Again / Done. Cards turn red after 8 minutes.
- **History** — today’s sales, reopen a receipt, daily total, CSV export, end-of-day summary.
- **Settings** (PIN, default **1234**) — set real prices (items start at ₱0 and show Sample), favorites, sold out today, receipt footer, change PIN.

Menu names and branding match the Basque Bloc Android POS app. Set the real prices in Settings before a busy day.

## Privacy

Everything stays in this browser on this device (IndexedDB). There are no accounts, keys, or cloud backups in this version.

## For developers

This is a static PWA (no build step). Serve the folder over HTTPS or localhost.

    python3 -m http.server 8787

Inter is included under the SIL Open Font License. Shop logos come from the Basque Bloc POS app.
