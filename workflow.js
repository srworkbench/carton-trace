/* Host-side example. The host supplies an authenticated Shopify query and storage. */
const C = require("./core.js");
const S = require("./shopify.js");
const { fetchSource } = require("./integration.js");

function createWorkflow({ queryFn, store }) {
  if (typeof queryFn !== "function") throw Error("Provide an authenticated Shopify query function.");
  if (!store || typeof store.get !== "function" || typeof store.put !== "function")
    throw Error("Provide a record store with get and put methods.");

  const key = (orderId, fulfillmentOrderId) => {
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId) ||
        !/^gid:\/\/shopify\/FulfillmentOrder\/\d+$/.test(fulfillmentOrderId))
      throw Error("Provide Shopify order and fulfillment-order GIDs.");
    return `${orderId}|${fulfillmentOrderId}`;
  };
  async function read(orderId, fulfillmentOrderId) {
    const raw = await store.get(key(orderId, fulfillmentOrderId));
    if (!raw) throw Error("No carton record exists for this fulfillment order.");
    if (raw.version !== 1 || !raw.record || !Array.isArray(raw.pendingRemoval) ||
        !Array.isArray(raw.checkedCartons) || typeof raw.removalAcknowledged !== "boolean")
      throw Error("Invalid stored carton record.");
    const record = S.restore(JSON.stringify(raw.record));
    if (record.shopifySource?.orderId !== orderId ||
        record.shopifySource?.fulfillmentOrderId !== fulfillmentOrderId)
      throw Error("Stored record belongs to another fulfillment order.");
    return { ...raw, record };
  }
  async function write(orderId, fulfillmentOrderId, state) {
    await store.put(key(orderId, fulfillmentOrderId), state);
    return state;
  }
  async function indexOrderName(orderName, orderId, fulfillmentOrderId) {
    const indexKey = `order-name:${orderName}`;
    const entries = await store.get(indexKey) || [];
    if (!Array.isArray(entries)) throw Error("Invalid stored order index.");
    if (!entries.some((x) => x.orderId === orderId && x.fulfillmentOrderId === fulfillmentOrderId)) {
      entries.push({ orderId, fulfillmentOrderId });
      await store.put(indexKey, entries);
    }
  }
  async function start(orderId, fulfillmentOrderId, cartons) {
    const source = await fetchSource(queryFn, orderId, fulfillmentOrderId);
    fulfillmentOrderId = source.fulfillmentOrderId;
    const id = key(orderId, fulfillmentOrderId);
    if (await store.get(id)) throw Error("A carton record already exists for this fulfillment order.");
    const draft = S.toDraft(source, cartons);
    const state = await write(orderId, fulfillmentOrderId, {
      version: 1, record: S.bundle(draft, null, source), pendingRemoval: [],
      checkedCartons: [], removalAcknowledged: true,
    });
    await indexOrderName(source.orderName, orderId, fulfillmentOrderId);
    return state;
  }
  async function assign(orderId, fulfillmentOrderId, carton, lineId, quantity) {
    const state = await read(orderId, fulfillmentOrderId);
    if (state.record.dispatch) throw Error("Sealed dispatch records cannot be edited.");
    state.record = S.bundle(C.assign(state.record.draft, carton, lineId, quantity),
      null, state.record.shopifySource);
    state.checkedCartons = [];
    return write(orderId, fulfillmentOrderId, state);
  }
  async function unassign(orderId, fulfillmentOrderId, carton, lineId, quantity) {
    const state = await read(orderId, fulfillmentOrderId);
    if (state.record.dispatch) throw Error("Sealed dispatch records cannot be edited.");
    state.record = S.bundle(C.unpack(state.record.draft, carton, lineId, quantity),
      null, state.record.shopifySource);
    state.checkedCartons = [];
    return write(orderId, fulfillmentOrderId, state);
  }
  async function reconcile(orderId, fulfillmentOrderId) {
    const state = await read(orderId, fulfillmentOrderId);
    if (state.record.dispatch) throw Error("Sealed dispatch records cannot be edited.");
    const current = await fetchSource(queryFn, orderId, fulfillmentOrderId);
    const prior = state.record.shopifySource;
    const result = S.rebase(state.record.draft, prior, current);
    if (result.changed.length) {
      state.record = S.bundle(result.state, null, current);
      state.pendingRemoval.push(...result.removed);
      state.checkedCartons = [];
      if (result.removed.length) state.removalAcknowledged = false;
      await write(orderId, fulfillmentOrderId, state);
    }
    await indexOrderName(state.record.shopifySource.orderName, orderId, fulfillmentOrderId);
    return { changed: result.changed, pendingRemoval: state.pendingRemoval,
      record: state.record };
  }
  async function acknowledgeRemoval(orderId, fulfillmentOrderId) {
    const state = await read(orderId, fulfillmentOrderId);
    if (state.record.dispatch) throw Error("Sealed dispatch records cannot be edited.");
    if (!state.pendingRemoval.length) throw Error("No removed units need acknowledgment.");
    state.removalAcknowledged = true;
    return write(orderId, fulfillmentOrderId, state);
  }
  async function checkCarton(orderId, fulfillmentOrderId, carton) {
    const state = await read(orderId, fulfillmentOrderId);
    if (state.record.dispatch) throw Error("Sealed dispatch records cannot be edited.");
    if (!state.removalAcknowledged)
      throw Error("Confirm physical removal before checking cartons.");
    if (!C.contents(state.record.draft, carton).length)
      throw Error("Pack this carton before checking it.");
    if (!state.checkedCartons.includes(carton)) state.checkedCartons.push(carton);
    return write(orderId, fulfillmentOrderId, state);
  }
  async function seal(orderId, fulfillmentOrderId) {
    const state = await read(orderId, fulfillmentOrderId);
    if (state.record.dispatch) throw Error("This fulfillment order is already sealed.");
    if (state.pendingRemoval.length && !state.removalAcknowledged)
      throw Error("Confirm that removed units were physically taken out of their cartons.");
    const draft = state.record.draft;
    if (state.checkedCartons.length !== draft.boxes.length ||
        new Set(state.checkedCartons).size !== draft.boxes.length ||
        state.checkedCartons.some((box) => !draft.boxes.includes(box)))
      throw Error("Check every carton against its current packing list before sealing.");
    const current = await fetchSource(queryFn, orderId, fulfillmentOrderId);
    if (S.changes(state.record.shopifySource, current).length)
      throw Error("Shopify fulfillment lines changed. Reconcile cartons before dispatch.");
    const handoff = S.manifest(draft, current);
    const dispatch = C.seal(draft, new Date().toISOString());
    state.record = S.bundle(draft, dispatch, current);
    state.pendingRemoval = [];
    state.checkedCartons = [];
    await write(orderId, fulfillmentOrderId, state);
    return { dispatch, handoff };
  }
  async function findBox(orderId, fulfillmentOrderId, carton) {
    const state = await read(orderId, fulfillmentOrderId);
    if (!state.record.dispatch) throw Error("This order has no sealed dispatch record.");
    const rows = C.contents(state.record.dispatch.state, carton).map((row) => ({
      name: row.name,
      sku: state.record.shopifySource.items.find((item) => item.id === row.sku).sku,
      fulfillmentOrderLineItemId: row.sku,
      quantity: row.qty,
    }));
    return { orderId, orderName: state.record.shopifySource.orderName,
      fulfillmentOrderId, carton, sealedAt: state.record.dispatch.at, rows };
  }
  async function findBoxByOrderName(orderName, carton) {
    if (typeof orderName !== "string" || !orderName.trim() || orderName.length > 120)
      throw Error("Enter a Shopify order name such as #1042.");
    const entries = await store.get(`order-name:${orderName.trim()}`) || [];
    if (!Array.isArray(entries)) throw Error("Invalid stored order index.");
    if (entries.length !== 1)
      throw Error(entries.length ? "More than one fulfillment order has this name; use Shopify IDs." :
        "No carton record exists for this order name.");
    return findBox(entries[0].orderId, entries[0].fulfillmentOrderId, carton);
  }
  async function get(orderId, fulfillmentOrderId) {
    return read(orderId, fulfillmentOrderId);
  }
  return { start, assign, unassign, reconcile, acknowledgeRemoval, checkCarton, seal, findBox,
    findBoxByOrderName, get };
}

module.exports = { createWorkflow };
