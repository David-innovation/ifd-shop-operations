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
- Flooring-pack allocation on quote acceptance remains a separate Add items step. This change covers the audited carpet journey, not a complete redesign of every existing workflow.

The existing live job M-IRIN5 is a labelled simulation. Do not fulfil its Shopify draft or treat its bank-transfer entry as real money.
