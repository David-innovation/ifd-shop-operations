# Audit backlog

Where each finding from the November 2026 functional audit stands. "Tested" means against stand-ins for Shopify, the mail
server and the text service, with made-up people, unless it says live. Nothing here means the system is finished.

## Stage 1

| # | Finding | Status |
|---|---|---|
| 1 | Messages marked sent when they were not | **Built and tested, not yet proven live.** Server-side email and text sending, prepared / sending / sent / delivered / failed / not known / sent by hand, failed and uncertain sends on the Today screen, retries without duplicates, lost answers never resent blind. Still open: the live system has no mailbox password or Twilio details, so no real quote or booking message has reached the owner's test details. Email has no delivery receipt: "sent" means the mail server accepted it, and a bounce arrives in the help@ mailbox, not in this system. |
| 2 | Cutting possible despite a hold | **Fixed and tested**, and the refusals checked on the live server. One rule for the job sheet tick, the job sheet button, the cutting list and the server. |
| 3 | Shopify close-off told staff to mark an unpaid order paid | **Fixed and tested.** The read-back query was checked against the live store. Not yet run end to end on a live order: that needs a real test order made, paid and fulfilled in Shopify. |
| 4 | Overpayments and corrections | **Fixed and tested.** A sale made in the shop with a payment bigger than the sale is refused on the server too. |
| 5 | Accessories missing from picking | **Fixed and tested** as picking requirements. Tying them to Shopify stock is built and tested, but the live catalogue has no carpet underlay, gripper or door bar products, so on carpet jobs they are picked only and Shopify stock is not changed. See "Needed from the owner". |

## Stage 2 (not started unless it says so)

| # | Finding | Status |
|---|---|---|
| 6 | Fitter and estimator access | Not started. They can sign in but get a holding page. |
| 7 | Engineered-wood rules (herringbone £30/m², straight plank £22/m², glue £5/m², mandatory preparation) | Partly done with catalogue pricing: the pricing screen works out herringbone at £30/m², straight plank at £22/m² and glue at £5/m² from the price list, always adds the glue line, and will not save an engineered wood quote without floor preparation priced. Still open: a chevron fitting rate, whether preparation is the shop's money or the fitter's, and the same rules on a sale typed straight into the sale screen without a measure. |
| 8 | Backups and a proven restore | Not started. Records are on the hosting disk only. |

## Stage 3 (not started unless it says so)

| # | Finding | Status |
|---|---|---|
| 9 | Booking changes trigger renewed confirmation | **Built and server-tested.** Date, morning or afternoon, arrival time, fitter, fitting total, price, address and the flooring/accessory items are covered, with numbered revisions. Picking/bay changes do not cause customer revisions. Earlier confirmations without item snapshots conservatively need re-confirmation. |
| 10 | Fitting lifecycle before completion | Not started. |
| 11 | Fitter capacity checks | Not started. |
| 12 | Enquiry capture through to a sale | Not started. Also open: sending a quote again restarts the five days without saying so. |
| 13 | Exact message snapshots and quote revisions | **Partly done.** Exact words kept and shown again; shop sign-off with no person's name; quote reference; shop and fitter amounts apart. Open: immutable quote revisions, validity period, acceptance refused when the quote has changed since. |
| 14 | Server-enforced commands | **Partly done.** Cutting, payments and messages are server commands with duplicate protection. Open: accepting a quote, reserving stock, receiving goods, booking a fitting, completing a job, deleting a job. |
| 15 | Supplier receipts with shortages and damage | Not started. |
| 16 | Real calendar dates (2026-02-31 is accepted) | Not started. |
| – | Task form: owner and job link; the word "null" in an empty task | Not started. |

## Needed from the owner

### Takeover check, 11 November

- 19 server tests pass on the deployed Node version, 22.14.0. This is not proof of real customer delivery.
- Manual resolution of an uncertain send now requires an explanation for either outcome, retained on the job history.
- A truncated or malformed provider lookup cannot clear an uncertain text for retry.
- David approved Twilio with an initial spending limit of GBP 20 and automatic top-ups off. Registration/verification and the final connection are still outstanding.
- David is checking accessory counts and Gold Underlay coverage; no quantities or coverage were guessed or changed.

- **Email:** an app password for the help@ Google account, typed into the hosting as `SMTP_PASS`.
- **Texts:** a decision on Twilio and its cost, then the three Twilio values typed into the hosting.
- **Payment wording:** confirm or change "is due before your fitting day" and the notes sent before a fitting (Setup, Wording on customer messages).
- **Carpet accessories in Shopify:** for carpet underlay, gripper and door bars: the product name, what one unit is (a roll of how many m², a length of how many metres, a single bar), and a counted stock figure. Tag them `accessory_underlay` + `for_carpet`, `accessory_gripper`, `accessory_doorbar`.
- **Price list:** confirm or change the rates in Setup, Price list. They were loaded from the online carpet builder and the audit instruction. No rate is set yet for fitting laminate, click vinyl or engineered chevron, so those are typed by hand. Say whether floor preparation and uplift are paid to the shop (as now) or to the fitter.
- **Carpet prices:** most catalogue carpets have no price in Shopify, so the price per m² is typed on the pricing screen. Adding the price per m² to each carpet in Shopify would let the screen work it out.
- **Stairs:** how carpet for stairs is cut from the roll is still undecided, so the m² for stairs is added by hand on the pricing screen.
- **Underlay data to check:** "10 m2 Premium Quality Gold Underlay" says 10 m² in its name but 15 in its coverage field. "Foam Laminate Underlay" shows 9,999 in stock and, like the Fibreboard, allows overselling, so its figure cannot be relied on. Beading and adhesive are not stock-counted.

## Next improvement requested by David — private fitter feedback (12 November 2026)
Add a customer-email link to rate the fitter privately and leave comments. Keep feedback linked to the job and assigned fitter, with a separate shop-only page for each fitter so the shop can review performance, discuss concerns and track follow-up. This is internal service improvement, separate from public Google/Facebook review requests. Do not use the private score to gate public reviews. Implement after the estimator photos, sketches and catalogue work.
