# Measure-to-fitting handover fixes — 11 November 2026

## Implemented

- Accepted/delivered appointment SMS update the job or estimator visit arrival fields. Failed or uncertain delays preserve the last accepted slot. Moving the date or changing the assigned person clears an obsolete SMS projection. Existing accepted SMS are reconciled on restart, without resending.
- Quotes save the room-by-room carpet cutting plan. Straight stairs include width and run allowances and strip instructions. The same quantities feed acceptance, reservation and the cutting list. Turning stairs and joins require the reviewed room-plan editor, with explicit pieces, instructions and staff name; changed measurements invalidate that review.
- Gripper and beading keep their quantities in lengths. A quantity adjustment on the pricing screen carries through to acceptance and picking. Changing the price does not discard the physical quantity.
- Saved carpet plans cannot silently be replaced by changed room sizes on acceptance. Legacy stair quotes require repricing to establish a saved plan.
- Accepted jobs opt into diary handover after stock is prepared and checked, dates/assignments are valid and diary checks pass. No customer confirmation is sent automatically. The existing To send queue remains responsible for it. Explicit removal from the diary disables automatic re-entry.
- Manual diary confirmation is checked on the server, including preparation/checking. The server checks that reserved carpet covers the saved cutting plan before allowing cutting, with the existing recorded owner override.
- Super Soft 10mm and Superior 12mm names are used for carpet underlay. Superior is always £2/m² above Super Soft for new calculations. Existing quote totals remain unchanged.

## Validation

- 35 server/rules tests pass, including message-to-arrival integration, failed delay handling, diary gates, accessory units and the four-bedroom/HSL case.
- Focused browser test creates a quote, chooses Superior 12mm, changes gripper to 50 lengths, accepts the quote with a fitter/date, creates one simulated Shopify draft and verifies seven saved room cuts and picking quantities.
- The old broad browser harness stops at the old Today inbox selector, which no longer exists on the simplified dashboard. Its historical pass count is not a current result.

## Still open

- Live email sending needs authenticated sender credentials or verified provider/domain access. David's open Gmail session has no sales@ send-as address. Browser sign-in alone does not give the hosted app permission to send mail.
- Carpet accessory product selling units and physical stock counts are not confirmed. Door-bar variations/names will be supplied tomorrow. Foam Underlay's 9,999 figure is unverified. Do not invent replacement quantities or mark the opening stocktake complete.
- Gold Underlay was confirmed by David as 15m² per roll; Shopify title and description were corrected to match the known coverage.
- Laminate and wood quotes now retain an exact variant/coverage/whole-pack snapshot, combining rooms using the same variant before rounding. Acceptance carries it into reservation and picking without Add items. Quoted underlay defaults to its saved product; untracked accessories remain picking items. Agreed prices and separate fitter payment are unchanged. Shortages retain the variant and quantity in To order and cannot enter the diary until received, put away, picked and checked. Older quotes require one review/save to create the snapshot. Changed sizes, choices or pack coverage require review.
- Pack regression checks cover laminate, engineered wood, shortage routing, combined-room rounding, preserved totals and diary safeguards using simulated Shopify. No real stock or money is changed by these tests.

The existing live job M-IRIN5 is a labelled simulation. Do not fulfil its Shopify draft or treat its bank-transfer entry as real money.

## Glue-down LVT automatic pricing

- Live Build My Quote settings checked 11 November 2026: straight £18/m², herringbone/chevron £25/m², tile £20/m², basket weave £35/m², border £30/m² or the higher pattern rate. Fitting minimum £200/job. Preparation £14/m², minimum £150/job. Adhesive uses David's explicit £3/m² instruction instead of the website's older adhesive rate.
- Product fitting_method and format tags identify glue-down products even with private-label shop names. New quotes automatically include adhesive and preparation, retain quantities, and carry into the existing pack acceptance/reservation/picking route. Existing quotes retain their agreed prices until reviewed. The quote's border checkbox recalculates fitting and persists its selection.
- Separate underlay is disabled in the glue-down catalogue calculator. Adhesive picking records show the measured area requiring adhesive; tub size and physical stock are not invented.
- 37 server/rules tests pass. Focused browser journeys pass for laminate, engineered wood, metadata-identified glue-down LVT and shortages with simulated Shopify, without touching real stock or money. Shopify product queries validated against API 2026-10.
- Rate source: https://innovationflooringdirect.com/pages/quote-v2 . Shopify metafield reference: https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Metafield .
