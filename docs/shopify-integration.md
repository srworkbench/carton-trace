# Connecting a Shopify app

This repository defines the packing and handoff boundary. The host app provides Shopify authentication and an Admin GraphQL query function. Keep tokens on the server; do not place them in `index.html` or a browser bundle.

```js
const { createWorkflow } = require("../workflow.js");
const { fileStore } = require("../file-store.js");

// Adapt your authenticated Shopify Admin client to this signature.
const queryFn = (query, variables) => adminGraphql(query, variables);
const workflow = createWorkflow({ queryFn, store: fileStore("./build/private-carton-records") });
const started = await workflow.start(orderId, fulfillmentOrderId, ["1", "2", "3", "4"]);
const lineId = started.record.shopifySource.items.find((item) => item.sku === "BOTTLE").id;
await workflow.assign(orderId, fulfillmentOrderId, "4", lineId, 6);
// Repeat assign for every remaining fulfillment line before sealing.
// Your app can adapt host-server.js and host-ui.html behind its own auth.
const comparison = await workflow.reconcile(orderId, fulfillmentOrderId);
if (comparison.pendingRemoval.length)
  await workflow.acknowledgeRemoval(orderId, fulfillmentOrderId);
for (const box of ["1", "2", "3", "4"])
  await workflow.checkCarton(orderId, fulfillmentOrderId, box);
const { handoff } = await workflow.seal(orderId, fulfillmentOrderId);
const carton = await workflow.findBox(orderId, fulfillmentOrderId, "4");
// Store handoff.boxes with the order; review current fulfillment permissions,
// tracking details, and shipment policy before implementing a Shopify write.
```

The example code is an interface sketch: all units must be assigned before `seal`, and the host should call `acknowledgeRemoval` only after a packer removes any units listed by `reconcile`. `checkCarton` records each carton check after the latest source change or packing edit; either edit clears earlier checks. These calls enforce sequence but cannot observe physical work. Run `npm run demo:packer` for the fixture-backed packer desk or `npm run demo:shopify` for a command-line walkthrough. A real host replaces `adminGraphql` with its authenticated Admin client, places the packer desk behind shop and staff authorization, and replaces the local file store with a tenant-scoped database that handles concurrent writes and retention. The local demo server has no authentication and must stay on loopback.

The query requests `Order.fulfillmentOrders` and each fulfillment order's line items. Shopify's `FulfillmentOrderLineItem` exposes `remainingQuantity` and a line ID. Carton Trace uses that ID for allocation identity, while packing slips show SKU and product name. The importer requires complete connection pages; extend pagination in the host app if an order exceeds the query limits.

`workflow.seal` re-fetches the same order and fulfillment order. It rejects a changed line or quantity. It cannot prove a physical carton was packed correctly; the caller must collect carton checks and confirm physical removals. The static browser interface has a separate JSON-import flow and clears carton checks after a packing change. File-import users must obtain a current Shopify response themselves; repeating an old JSON file cannot establish freshness.

The handoff includes `orderId`, `fulfillmentOrderId`, source lines, and each carton's line IDs and quantities. Shopify's `fulfillmentCreate` uses fulfillment-order line item IDs and requires an authorized write scope and staff permission. It does not, by itself, store Carton Trace's per-carton list. A production app must decide how to retain that mapping, create shipments, handle tracking, permissions, rate limits, retries, and partial fulfillments. No Shopify write is implemented here. The sample file store is only suitable for a single local process; it does not coordinate simultaneous packers or guarantee recovery after a host failure.

Schema references checked September 23, 2026:

- [FulfillmentOrderLineItem](https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentOrderLineItem)
- [fulfillmentCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentCreate)
