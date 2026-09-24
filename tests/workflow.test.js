const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const S = require("../shopify.js");
const { fileStore } = require("../file-store.js");
const { createWorkflow } = require("../workflow.js");

test("authenticated query seam retains a carton lookup across host instances", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "carton-trace-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const originals = await fs.readFile(path.join(__dirname, "../fixtures/shopify-order.json"), "utf8");
  const changed = await fs.readFile(path.join(__dirname, "../fixtures/shopify-order-changed.json"), "utf8");
  const orderId = "gid://shopify/Order/1042", foId = "gid://shopify/FulfillmentOrder/2201";
  let active = originals;
  const queryFn = async () => JSON.parse(active);
  const store = fileStore(dir);
  const host = createWorkflow({ queryFn, store });
  const items = S.fromResponse(originals).items;
  await host.start(orderId, foId, ["1", "2", "3", "4"]);
  for (const [box, index, qty] of [["1", 0, 12], ["2", 0, 12],
    ["2", 1, 6], ["3", 1, 6], ["4", 2, 8]])
    await host.assign(orderId, foId, box, items[index].id, qty);
  for (const box of ["1", "2", "3", "4"])
    await host.checkCarton(orderId, foId, box);
  active = changed;
  await assert.rejects(host.seal(orderId, foId), /changed/i);
  const compared = await host.reconcile(orderId, foId);
  assert.deepEqual(compared.pendingRemoval.map(({ box, qty }) => ({ box, qty })),
    [{ box: "4", qty: 2 }]);
  await assert.rejects(host.seal(orderId, foId), /physically/i);
  await assert.rejects(host.checkCarton(orderId, foId, "4"), /physical removal/i);
  await host.acknowledgeRemoval(orderId, foId);
  await assert.rejects(host.seal(orderId, foId), /every carton/i);
  const afterChangeHost = createWorkflow({ queryFn, store: fileStore(dir) });
  for (const box of ["1", "2", "3", "4"])
    await afterChangeHost.checkCarton(orderId, foId, box);
  const sealingHost = createWorkflow({ queryFn, store: fileStore(dir) });
  const sealed = await sealingHost.seal(orderId, foId);
  assert.equal(sealed.handoff.boxes[3].items[0].quantity, 6);
  const reopened = createWorkflow({ queryFn, store: fileStore(dir) });
  const box = await reopened.findBox(orderId, foId, "4");
  assert.equal(box.rows[0].sku, "BOTTLE");
  assert.equal(box.rows[0].quantity, 6);
  assert.equal(box.rows[0].fulfillmentOrderLineItemId, items[2].id);
  await assert.rejects(reopened.assign(orderId, foId, "4", items[2].id, 1), /sealed/i);
});

test("reconciled Shopify order name remains a usable saved carton lookup", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "carton-rename-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const raw = JSON.parse(await fs.readFile(path.join(__dirname, "../fixtures/shopify-order.json"), "utf8"));
  let response = raw;
  const host = createWorkflow({ queryFn: async () => response, store: fileStore(dir) });
  const orderId = "gid://shopify/Order/1042", foId = "gid://shopify/FulfillmentOrder/2201";
  await host.start(orderId, foId, ["1"]);
  for (const item of S.fromResponse(raw).items)
    await host.assign(orderId, foId, "1", item.id, item.qty);
  response = structuredClone(raw);
  response.data.order.name = "#1042A";
  assert.equal((await host.reconcile(orderId, foId)).changed.length, 1);
  await host.checkCarton(orderId, foId, "1");
  await host.seal(orderId, foId);
  const reopened = createWorkflow({ queryFn: async () => response, store: fileStore(dir) });
  const found = await reopened.findBoxByOrderName("#1042A", "1");
  assert.equal(found.orderName, "#1042A");
  assert.equal(found.rows.reduce((sum, row) => sum + row.quantity, 0), 44);
});
