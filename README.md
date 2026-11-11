# IFD Shop Operations

One system for Innovation Flooring Direct: jobs, stock allocation, the diary, measures and site checks, deliveries and the fitters' own pages.
Shopify stays the single stock authority. This system never keeps a second stock count.

**Status: live on Render since 10 November 2026 and connected to the Innovation Flooring Direct store. Shop screens only so far: fitters and estimators cannot sign in to their own pages yet. Customer emails and texts are built and tested against stand-ins, but nothing is sent from the live system until the mailbox and text service details are typed into the hosting.**

## How it fits together

```
 Shop screen / phone ──► this server ──► Shopify (stock, orders, customers)
        ▲                    │
        └── live updates ────┤──► records (one SQLite file on the service's disk)
                             ├──► pictures (files on the same disk)
                             ├──► Twilio (sign-in codes and customer texts)
                             └──► a mail server (customer emails, over SMTP)
```

- **Sign-in** is by a code texted to a mobile number the owner has approved. A number that is not set up gets no text. Codes last ten minutes, work once, and lock after five wrong tries.
- **The shop's screens** (`app/`) are the ones proven on the Claude-hosted version, unchanged. `public/shim.js` gives them the same building blocks, backed by this server.
- **Shopify** is reached only by the server, with its own key. A screen can only send the named questions and changes listed in `lib/shopify.js`. Every change is written to the audit log with who made it.
- **Fitters and whoever measures** can sign in, but the server refuses them the shop's screens, records, Shopify and pictures. Their own pages are the next stage.
- **One set of rules.** The shop's rules and sums are the first script in `app/ifd-shop-operations.html`. The server loads that same code (`lib/rules.js`), so a rule cannot say one thing on a screen and another on the server.
- **Three things only happen through the server's own commands** (`POST /api/cmd`, in `lib/commands.js`), whichever screen or script asks:
  - *Cutting.* A roll piece is only marked cut when nothing holds the job: sizes verified, no review outstanding, and the carpet sold still covers the floor as measured. Only the owner can override, with a reason that is written on the job.
  - *Money.* A record of money already taken; it never charges a card. More than is owed is refused unless it is recorded as change given or as credit. The same entry sent twice is one entry. Nothing is deleted: a wrong entry is struck out with a reason, a correction sits beside it, and a refund is its own entry.
  - *Messages to customers.* Sent by the server through the mail server or Twilio. A message counts as sent only when that service accepts it and gives a reference; a text counts as delivered only when Twilio reports the handset has it. Copying a message or opening it in an app is recorded as prepared, never sent. Failed sends are kept with the reason, listed on the Today screen, and retried without making a second message. A member of staff who really did send it themselves records that under their own name.
    A send whose answer was lost (the service took the message, or may have, and the line dropped) is recorded as *not known to have gone*. It is never retried blind and a fresh send to the same place is refused until it is settled: a text is looked up with Twilio (found means it went, no record after a minute means it is safe to send again); an email cannot be looked up, so a person checks the mailbox's Sent folder or asks the customer and records which, with how they know.
    Every message keeps its exact words, who sent it, which quote or which revision of the booking it was, and every attempt. Messages are signed by the shop, never by a person.
  The plain record routes refuse to change payments, messages, or a roll line's cut tick.
- **Test mode for messages** is on by default and can only be changed by the owner, in Setup. While it is on, messages go only to the test details the owner has listed there. Those details live in the system's own records, not in this repository.
- **What customers are sent.** Quotes and fitting confirmations carry the job's reference in the subject and the body, show what is paid to the shop and what is paid straight to the fitter as two amounts with one total, and say how each is paid. A confirmation gives the date, the arrival slot, the fitter, the address, what to do before the fitter arrives, and the shop's contact details. A change to the date, morning or afternoon, arrival time, price, fitter, fitting total or address flags the booking as needing a revised confirmation; the revised one says what changed and the earlier one stays on the job. The owner sets the standing wording (how the shop's part is paid, notes before a fitting) in Setup.
- **Accessories and Shopify stock.** On the yes screen each accessory on the quote is either tied to a Shopify product that staff choose, or marked as not a Shopify stock item. A tied one is reserved on the same Shopify draft as the rest of the sale, so it is reserved once, released once if the job is cancelled (the draft is deleted), and deducted once when the order is fulfilled in Shopify. Ticking it picked here never changes Shopify stock, and the screens say so. Products are offered by tag: `accessory_underlay` (plus `for_carpet` for underlay made for carpet), `accessory_gripper`, `accessory_doorbar`, `accessory_beading`, `accessory_adhesive`. Nothing is matched automatically.
- **Shopify and money.** The Shopify sale is the shop's part only: fitting money the customer pays straight to the fitter is left off it and noted on it. On this Shopify plan an order is either unpaid or paid in full, so staff are told to mark it paid only when the shop has been paid in full here; part payments live in this system's ledger. `Check Shopify` on a finished job reads the order back and says whether the two agree. This system never marks a Shopify order paid or fulfilled itself.

## Files

| Path | What it is |
|---|---|
| `server.js` | Sign-in, records, the Shopify line, pictures, live updates |
| `lib/store.js` | Records in SQLite. Nested values merge inside one transaction, so two saves at once both land |
| `lib/shopify.js` | Key exchange with Shopify and the list of permitted requests |
| `lib/sms.js` | Texts through Twilio. Until Twilio is set up a sign-in code is written to the service log instead; customer texts are never logged in place of sending |
| `lib/mail.js` | Customer emails over SMTP, with no outside packages |
| `lib/rules.js` | Loads the shop's rules from the screens for the server to use |
| `lib/commands.js` | Cutting, money and customer messages, checked and recorded by the server |
| `app/ifd-shop-operations.html` | The shop's screens |
| `public/` | Sign-in page and the piece that connects the screens to the server |
| `test/` | Server tests: `npm test` |
| `testkit/` | Stand-ins for Shopify, the mail server and the text service, and a browser run of the real screens: `node testkit/browser-check.js` |
| `render.yaml` | Hosting set-up for Render |

## Settings typed into the hosting (never stored here)

| Name | What it is |
|---|---|
| `OWNER_NAME`, `OWNER_MOBILE` | The owner's name and mobile. The first person who can sign in |
| `SHOP_MOBILE` | The mobile that receives codes for the shared shop screen |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | The key pair from the store's own app in Shopify's Dev Dashboard |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio details. Without them sign-in codes are written to the log and customer texts cannot be sent |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | The mail server customer emails go out through. Port 465 (the default) or 587. For a Google mailbox: `smtp.gmail.com`, 465, the mailbox address, and an app password made for this system |
| `EMAIL_FROM` | Who emails come from: `Innovation Flooring Direct <help@innovationflooringdirect.com>`. Has to be an address the mail server lets that mailbox send as |
| `EMAIL_REPLY_TO` | Where a customer's reply goes: `help@innovationflooringdirect.com` |

`help@` is its own Google mailbox (not an alias of the owner's), so `SMTP_USER` is `help@innovationflooringdirect.com` and `SMTP_PASS` is an app password made while signed in to Google as `help@`. The owner types `SMTP_PASS` into the hosting directly. It is never put in this repository or in a chat.
| `SESSION_PEPPER` | Made by the hosting. Protects sign-in records |

## Where the records are and how they are kept safe

Records and pictures are on the service's own disk (`DATA_DIR`). Still to do before real customer data goes in: a nightly copy kept off the service, and a restore carried out and written up.

## What has been proven so far

- `npm test`: sign-in rules, records, live updates, the Shopify line (key reuse, renewal, refusals), pictures, that a fitter's sign-in is refused everything belonging to the shop, and the server's own rules for cutting, money and messages (holds, overrides, overpayments, change and credit, duplicates, corrections, refunds, failed sends and retries, test mode, restarts mid-send).
- `node testkit/browser-check.js`: the real screens in a browser, from sign-in through pricing a measure, sending the quote, the customer saying yes, cutting, picking, the diary and the fitting confirmation, payments and receipts, and closing a finished job off against Shopify.

What is still open from the audit is listed in `AUDIT-BACKLOG.md`.

All of that is against stand-ins: a made-up Shopify, a made-up mail server and a made-up text service, with made-up people. Sending real emails and texts from the live system has not been shown yet. That needs the mailbox and Twilio details in the hosting, and then a quote and a booking confirmation arriving at the owner's own test details.
