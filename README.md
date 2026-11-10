# IFD Shop Operations

One system for Innovation Flooring Direct: jobs, stock allocation, the diary, measures and site checks, deliveries and the fitters' own pages.
Shopify stays the single stock authority. This system never keeps a second stock count.

**Status: live on Render since 10 November 2026 and connected to the Innovation Flooring Direct store. Shop screens only so far: fitters and estimators cannot sign in to their own pages yet, and texts are not switched on.**

## How it fits together

```
 Shop screen / phone ──► this server ──► Shopify (stock, orders, customers)
        ▲                    │
        └── live updates ────┤──► records (one SQLite file on the service's disk)
                             ├──► pictures (files on the same disk)
                             └──► Twilio (sign-in codes and reminder texts)
```

- **Sign-in** is by a code texted to a mobile number the owner has approved. A number that is not set up gets no text. Codes last ten minutes, work once, and lock after five wrong tries.
- **The shop's screens** (`app/`) are the ones proven on the Claude-hosted version, unchanged. `public/shim.js` gives them the same building blocks, backed by this server.
- **Shopify** is reached only by the server, with its own key. A screen can only send the named questions and changes listed in `lib/shopify.js`. Every change is written to the audit log with who made it.
- **Fitters and whoever measures** can sign in, but the server refuses them the shop's screens, records, Shopify and pictures. Their own pages are the next stage.

## Files

| Path | What it is |
|---|---|
| `server.js` | Sign-in, records, the Shopify line, pictures, live updates |
| `lib/store.js` | Records in SQLite. Nested values merge inside one transaction, so two saves at once both land |
| `lib/shopify.js` | Key exchange with Shopify and the list of permitted requests |
| `lib/sms.js` | Texts through Twilio. Until Twilio is set up they are written to the service log instead |
| `app/ifd-shop-operations.html` | The shop's screens |
| `public/` | Sign-in page and the piece that connects the screens to the server |
| `test/` | Server tests: `npm test` |
| `testkit/` | Stand-in Shopify, and a browser run of the real screens: `node testkit/browser-check.js` |
| `render.yaml` | Hosting set-up for Render |

## Settings typed into the hosting (never stored here)

| Name | What it is |
|---|---|
| `OWNER_NAME`, `OWNER_MOBILE` | The owner's name and mobile. The first person who can sign in |
| `SHOP_MOBILE` | The mobile that receives codes for the shared shop screen |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | The key pair from the store's own app in Shopify's Dev Dashboard |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio details. Leave empty to have texts written to the log |
| `SESSION_PEPPER` | Made by the hosting. Protects sign-in records |

## Where the records are and how they are kept safe

Records and pictures are on the service's own disk (`DATA_DIR`). Still to do before real customer data goes in: a nightly copy kept off the service, and a restore carried out and written up.

## What has been proven so far

- `npm test`: sign-in rules, records, live updates, the Shopify line (key reuse, renewal, refusals), pictures, and that a fitter's sign-in is refused everything belonging to the shop.
- `node testkit/browser-check.js`: the real screens signing in, reading website orders, making a job, two screens updating each other, pictures, sign-out.

All of that is against a stand-in for Shopify. Nothing has been run against the live store from this server yet.
