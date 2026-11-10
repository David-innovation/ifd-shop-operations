# IFD Shop Operations

One system for Innovation Flooring Direct: jobs, stock allocation, the diary, measures and site checks, deliveries and the fitters' own pages.
Shopify stays the single stock authority. This system never keeps a second stock count.

**Status: being moved from the Claude-hosted page to its own hosting. Not live yet.**

## What is in here

| Path | What it is |
|---|---|
| `app/ifd-shop-operations.html` | The shop's screens, exactly as proven on the Claude-hosted version |
| `lib/store.js` | Records, kept in one SQLite file on the service's disk |
| `lib/shopify.js` | The system's own line to Shopify. Only named questions and changes are passed on |
| `lib/sms.js` | Texts through Twilio. Until Twilio is set up, texts are written to the service log instead |
| `render.yaml` | Hosting set-up for Render |

## Secrets

No password, key or phone number is stored in this repository. They are typed into Render by the owner.
