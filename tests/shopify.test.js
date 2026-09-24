const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../shopify.js");
const C = require("../core.js");
const R = require("../report.js");
const I = require("../integration.js");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures", name), "utf8"));

test("Shopify fulfillment lines import without transcribing order totals or mixing nonshippable goods", () => {
  const source = S.fromResponse(fixture("shopify-order.json"));
  const draft = S.toDraft(source, ["1", "2", "3", "4"]);
  assert.equal(source.items.length, 3);
  assert.equal(draft.lines.reduce((n, x) => n + x.qty, 0), 44);
  assert.equal(draft.lines[0].sku, "gid://shopify/FulfillmentOrderLineItem/301");
  assert.equal(source.items[0].sku, "MUG-BLUE");
});

test("incomplete pagination, GraphQL errors and ambiguous fulfillment orders fail closed", () => {
  const partial = fixture("shopify-order.json");
  partial.data.order.fulfillmentOrders.pageInfo.hasNextPage = true;
  assert.throws(() => S.fromResponse(partial), /complete/);
  const failed = fixture("shopify-order.json");
  failed.errors = [{ message: "Access denied" }];
  assert.throws(() => S.fromResponse(failed), /GraphQL errors/);
  const held = fixture("shopify-order.json");
  held.data.order.fulfillmentOrders.nodes[0].status = "ON_HOLD";
  assert.throws(() => S.fromResponse(held), /requires OPEN/);
  const split = fixture("shopify-order.json");
  split.data.order.fulfillmentOrders.nodes.push({ ...split.data.order.fulfillmentOrders.nodes[0], id: "gid://shopify/FulfillmentOrder/2202" });
  assert.throws(() => S.fromResponse(split), /Choose one/);
  assert.equal(S.fromResponse(split, "gid://shopify/FulfillmentOrder/2202").fulfillmentOrderId,
    "gid://shopify/FulfillmentOrder/2202");
});

test("source change rebases carton allocations without retaining excess units", () => {
  const source = S.fromResponse(fixture("shopify-order.json"));
  const changed = S.fromResponse(fixture("shopify-order-changed.json"));
  let draft = S.toDraft(source, ["1", "2"]);
  for (const item of source.items) draft = C.assign(draft, "1", item.id, item.qty);
  draft = C.assign(C.unpack(draft, "1", source.items[2].id, 4), "2", source.items[2].id, 4);
  const result = S.rebase(draft, source, changed);
  assert.equal(result.changed.length, 1);
  assert.equal(result.removed.reduce((n, x) => n + x.qty, 0), 2);
  assert.equal(result.state.lines.reduce((n, x) => n + x.qty, 0), 42);
  assert.equal(C.complete(result.state), true);
  assert.equal(draft.lines.reduce((n, x) => n + x.qty, 0), 44);
});

test("Shopify handoff maps checked cartons back to fulfillment order line IDs", () => {
  const source = S.fromResponse(fixture("shopify-order.json"));
  let draft = S.toDraft(source, ["1", "2"]);
  for (const item of source.items) draft = C.assign(draft, "1", item.id, item.qty - (item.qty > 1 ? 1 : 0));
  for (const item of source.items) if (item.qty > 1) draft = C.assign(draft, "2", item.id, 1);
  const manifest = S.manifest(draft, source);
  assert.equal(manifest.fulfillmentOrderId, source.fulfillmentOrderId);
  assert.equal(manifest.boxes[1].items.length, 3);
  assert.equal(manifest.boxes[1].items[0].sku, "MUG-BLUE");
  const html = R.slips(C.seal(draft, "2026-09-23T12:00:00Z"), source);
  assert.match(html, /MUG-BLUE/);
  assert.doesNotMatch(html, /FulfillmentOrderLineItem/);
  const saved = S.restore(JSON.stringify(S.bundle(draft, null, source)));
  assert.equal(saved.shopifySource.orderId, source.orderId);
});

test("tampered Shopify source snapshot cannot be silently reopened", () => {
  const source = S.fromResponse(fixture("shopify-order.json"));
  const draft = S.toDraft(source, ["1"]);
  const record = S.bundle(draft, null, source);
  record.shopifySource.items[0].qty = 2;
  assert.throws(() => S.restore(JSON.stringify(record)), /does not match/);
});

test("authenticated-query seam refuses a changed fulfillment line before handoff", async () => {
  const source = S.fromResponse(fixture("shopify-order.json"));
  let draft = S.toDraft(source, ["1"]);
  for (const item of source.items) draft = C.assign(draft, "1", item.id, item.qty);
  const oldQuery = async (query, variables) => {
    assert.match(query, /fulfillmentOrders/);
    assert.equal(variables.id, source.orderId);
    return fixture("shopify-order.json");
  };
  const handoff = await I.checkedHandoff(oldQuery, draft, source);
  assert.equal(handoff.boxes[0].items.length, 3);
  await assert.rejects(() => I.checkedHandoff(async () => fixture("shopify-order-changed.json"), draft, source), /changed/);
  await assert.rejects(() => I.fetchSource(async () => fixture("shopify-order.json"),
    "gid://shopify/Order/9999", source.fulfillmentOrderId), /different order/);
});
