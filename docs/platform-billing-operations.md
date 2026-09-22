# Platform billing operations

The platform billing role and owner can change configured plans, extend existing trials, schedule cancellation at period end, and issue partial/full invoice-payment refunds. Every mutation requires a reason and a client-generated UUID. Local trials are supported without Stripe. Provider subscriptions and invoice/customer relationships are fetched and verified before provider mutations.

The existing Stripe client is intentionally retained at its explicit `2024-06-20` API contract. Invoice `subscription` and `payment_intent` fields in this implementation match that contract; changing the global version requires coordinated webhook and billing-route migration. No Stripe SDK or API upgrade is part of this feature.

Plan changes preserve the current item quantity, use the catalog's configured Stripe price, disable proration, and fail if required immediate payment fails. Changing billing intervals can still charge immediately. Multi-item subscriptions require provider review. Cancellation is scheduled, not immediate. Refund amounts are integer currency minor units, and Stripe enforces the remaining refundable amount. Local subscription mirrors update through the existing verified webhook flow.

## Durable retries and reconciliation

Requests are persisted before provider calls and audited at request and outcome. The same UUID cannot be used with a different actor, organization or payload. Stripe receives a stable `platform-billing-<UUID>` idempotency key. Ambiguous provider exceptions keep the request pending, blocking other new actions on the same effective billing account. The original actor may retry the identical payload after two minutes and within 23 hours of creation. Completed requests return the recorded response. A late failure cannot overwrite completion.

The billing context returns the actor's latest 20 requests so a reload does not lose recovery. `POST /api/platform/billing/reconcile` can verify a previously accepted provider operation without replaying it. For refunds it requires the provider refund ID and checks the original request metadata, invoice payment, customer/subscription and exact amount. Subscription reconciliation checks the desired provider plan, trial end or scheduled cancellation. It records completion only after a match. A request whose provider result cannot be verified remains unresolved for provider investigation; creating another refund is deliberately blocked.

## Reporting definitions

- MRR and ARR are current catalog-based estimates of active subscriptions, normalized for monthly/yearly plans and deduplicated by provider subscription. Quantity, discounts, tax and usage are not included; these values are not historical booked revenue.
- Collections are mirrored paid invoice amounts in the selected date range using issued date, with created date as fallback. Outstanding is the current open-invoice remaining amount.
- Refund-adjusted collections include successful console refunds and verified `refund.created`/`refund.updated` events in the event ledger, deduplicated by refund ID. Configure those events in Stripe. Historical external refunds preceding event capture are not reconstructed.
- Churn uses subscriptions present before the selected period and their `ended_at`. Deleted organizations and replaced subscriptions can leave incomplete history. No denominator produces an unavailable rate.
- Currency totals are separate and never converted or summed together.

Health reports actual failed webhook ledger entries, unresolved organization cleanup jobs, storage object metadata and device heartbeat age. Stale means no heartbeat for 24 hours, not proof of a sync failure. Unknown storage sizes are unavailable, not zero. Details are limited to 100 records with full summary counts. Alerts for payment problems, trials ending in seven days and cleanup failures are evaluated on refresh; acknowledgements are per platform user. This does not send email or background notifications.

Tax settings and existing provider tax registrations are unchanged by these controls.
