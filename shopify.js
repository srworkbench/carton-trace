/* Shopify Admin GraphQL response boundary. No credentials or network access. */
(function (root) {
  "use strict";
  const C = typeof module !== "undefined" ? require("./core.js") : root.Carton;
  const orderQuery = `query CartonTraceOrder($id: ID!) {
    order(id: $id) {
      id name
      fulfillmentOrders(first: 50) {
        pageInfo { hasNextPage }
        nodes {
          id status
          lineItems(first: 100) {
            pageInfo { hasNextPage }
            nodes { id sku productTitle variantTitle remainingQuantity requiresShipping }
          }
        }
      }
    }
  }`;
  function label(value, name) {
    if (typeof value !== "string" || !value.trim() || value.length > 120)
      throw Error("Invalid Shopify " + name + ".");
    return value.trim();
  }
  function nodes(connection, name) {
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo ||
        connection.pageInfo.hasNextPage !== false)
      throw Error(name + " must be a complete, unpaginated query result.");
    return connection.nodes;
  }
  function fromResponse(raw, requestedId) {
    const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (payload?.errors?.length) throw Error("Shopify returned GraphQL errors.");
    const order = payload?.data?.order;
    if (!order) throw Error("Expected data.order from the Shopify Admin query.");
    const orderId = label(order.id, "order ID");
    const orderName = label(order.name, "order name");
    const fulfillmentOrders = nodes(order.fulfillmentOrders, "Fulfillment orders");
    let matches = fulfillmentOrders;
    if (requestedId) matches = matches.filter((x) => x.id === requestedId.trim());
    if (matches.length !== 1)
      throw Error("Choose one fulfillment order ID from this response (found " + matches.length + ").");
    const selected = matches[0];
    const fulfillmentOrderId = label(selected.id, "fulfillment order ID");
    const status = label(selected.status, "fulfillment order status");
    if (status !== "OPEN" && status !== "IN_PROGRESS")
      throw Error("Fulfillment order is " + status + "; packing handoff requires OPEN or IN_PROGRESS.");
    const all = nodes(selected.lineItems, "Fulfillment order line items");
    if (!all.length || all.length > 100) throw Error("Expected 1–100 fulfillment order lines.");
    const seen = new Set();
    const items = [];
    for (const item of all) {
      const id = label(item?.id, "line ID");
      if (seen.has(id)) throw Error("Duplicate fulfillment order line ID.");
      seen.add(id);
      if (!Number.isSafeInteger(item.remainingQuantity) || item.remainingQuantity < 0 || item.remainingQuantity > 1000000)
        throw Error("Invalid remaining quantity for " + id + ".");
      if (typeof item.requiresShipping !== "boolean") throw Error("Missing shipping flag for " + id + ".");
      if (!item.requiresShipping || item.remainingQuantity === 0) continue;
      const name = label(item.productTitle, "product title");
      const sku = typeof item.sku === "string" && item.sku.trim() ? label(item.sku, "SKU") : "—";
      const variant = typeof item.variantTitle === "string" && item.variantTitle !== "Default Title"
        ? " · " + label(item.variantTitle, "variant") : "";
      items.push({ id, sku, name: (name + variant).slice(0, 120), qty: item.remainingQuantity });
    }
    if (!items.length) throw Error("No remaining shippable units in this fulfillment order.");
    items.sort((a, b) => a.id.localeCompare(b.id));
    return { orderId, orderName, fulfillmentOrderId, status, items };
  }
  function toDraft(source, boxes) {
    return C.create(source.orderName,
      source.items.map((x) => ({ sku: x.id, name: x.name, qty: x.qty })), boxes);
  }
  function validateSource(source, draft) {
    if (!source || typeof source !== "object" || !Array.isArray(source.items))
      throw Error("Invalid Shopify source snapshot.");
    label(source.orderId, "order ID");
    label(source.fulfillmentOrderId, "fulfillment order ID");
    label(source.orderName, "order name");
    if (source.status !== "OPEN" && source.status !== "IN_PROGRESS")
      throw Error("Shopify fulfillment order is not ready for packing.");
    if (!source.items.length || source.items.length > 100 ||
        source.items.some((x) => !x || !Number.isSafeInteger(x.qty) || x.qty < 1 || x.qty > 1000000 ||
          typeof x.sku !== "string" || x.sku.length > 120 ||
          typeof x.id !== "string" || !x.id.trim() || x.id.length > 120 ||
          typeof x.name !== "string" || !x.name.trim() || x.name.length > 120))
      throw Error("Invalid Shopify source line.");
    if (new Set(source.items.map((x) => x.id)).size !== source.items.length)
      throw Error("Duplicate Shopify source line ID.");
    const expected = toDraft(source, draft.boxes);
    if (expected.order !== draft.order || JSON.stringify(expected.lines) !== JSON.stringify(draft.lines))
      throw Error("Packing draft does not match Shopify source snapshot.");
    return source;
  }
  function bundle(draft, dispatch, source) {
    const record = C.bundle(draft, dispatch);
    if (source) record.shopifySource = validateSource(source, record.draft);
    return record;
  }
  function restore(raw) {
    const record = C.restore(raw);
    const parsed = JSON.parse(raw);
    return { ...record, shopifySource: parsed.shopifySource
      ? validateSource(parsed.shopifySource, record.draft) : null };
  }
  function changes(before, after) {
    if (before.orderId !== after.orderId || before.fulfillmentOrderId !== after.fulfillmentOrderId)
      throw Error("This response belongs to a different order or fulfillment order.");
    const prior = new Map(before.items.map((x) => [x.id, x]));
    const next = new Map(after.items.map((x) => [x.id, x]));
    const result = [];
    if (before.status !== after.status || before.orderName !== after.orderName)
      result.push({ id: "order-status-or-name", before: { status: before.status, name: before.orderName },
        after: { status: after.status, name: after.orderName } });
    for (const id of new Set([...prior.keys(), ...next.keys()])) {
      const a = prior.get(id), b = next.get(id);
      if (!a || !b || a.qty !== b.qty || a.name !== b.name || a.sku !== b.sku)
        result.push({ id, before: a || null, after: b || null });
    }
    return result;
  }
  function rebase(draft, before, after) {
    const changed = changes(before, after);
    let state = toDraft(after, draft.boxes);
    const removed = [];
    for (const allocation of draft.allocations) {
      const available = state.lines.some((x) => x.sku === allocation.sku)
        ? C.remaining(state, allocation.sku) : 0;
      const retained = Math.min(available, allocation.qty);
      if (retained) state = C.assign(state, allocation.box, allocation.sku, retained);
      if (retained < allocation.qty)
        removed.push({ box: allocation.box, id: allocation.sku, qty: allocation.qty - retained });
    }
    return { state, changed, removed };
  }
  function manifest(draft, source) {
    validateSource(source, draft);
    if (!C.complete(draft)) throw Error("Complete every carton before creating a manifest.");
    const boxes = draft.boxes.map((name) => ({ name, items: C.contents(draft, name).map((x) => ({
      fulfillmentOrderLineItemId: x.sku, sku: source.items.find((i) => i.id === x.sku).sku,
      name: x.name, quantity: x.qty,
    })) }));
    return { format: "carton-trace-shopify-handoff-v1", orderId: source.orderId,
      orderName: source.orderName, fulfillmentOrderId: source.fulfillmentOrderId,
      sourceItems: source.items, boxes };
  }
  const api = { orderQuery, fromResponse, toDraft, changes, rebase, manifest,
    validateSource, bundle, restore };
  if (typeof module !== "undefined") module.exports = api;
  else root.CartonShopify = api;
})(typeof globalThis === "undefined" ? this : globalThis);
