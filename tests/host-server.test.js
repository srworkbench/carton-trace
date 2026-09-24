const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHostServer } = require("../host-server.js");
const { fileStore } = require("../file-store.js");
const S = require("../shopify.js");

test("packer HTTP path saves a sealed carton and finds it by order name after restart", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "carton-host-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = JSON.parse(await fs.readFile(path.join(__dirname, "../fixtures/shopify-order.json"), "utf8"));
  const changed = JSON.parse(await fs.readFile(path.join(__dirname, "../fixtures/shopify-order-changed.json"), "utf8"));
  let current = original;
  const queryFn = async () => current;
  let server = createHostServer({ queryFn, store: fileStore(dir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  let base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, data) => {
    const res = await fetch(`${base}/api/${route}`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    return { status: res.status, data: await res.json() };
  };
  const ids = { orderId: "1042", fulfillmentOrderId: "2201" };
  const started = await post("start", { orderId: "1042", cartons: ["1", "2", "3", "4"] });
  assert.equal(started.status, 200);
  assert.equal(started.data.record.shopifySource.fulfillmentOrderId,
    "gid://shopify/FulfillmentOrder/2201");
  const items = S.fromResponse(original).items;
  for (const [carton, item, quantity] of [["1", 0, 12], ["2", 0, 12],
    ["2", 1, 6], ["3", 1, 6], ["4", 2, 8]])
    assert.equal((await post("assign", { ...ids, carton, lineId: items[item].id, quantity })).status, 200);
  current = changed;
  const premature = await post("seal", ids);
  assert.equal(premature.status, 400);
  assert.match(premature.data.error, /check every carton/i);
  const comparison = await post("reconcile", ids);
  assert.deepEqual(comparison.data.pendingRemoval.map((x) => [x.box, x.qty]), [["4", 2]]);
  assert.equal((await post("check", { ...ids, carton: "4" })).status, 400);
  assert.equal((await post("acknowledge", ids)).status, 200);
  for (const carton of ["1", "2", "3", "4"])
    assert.equal((await post("check", { ...ids, carton })).status, 200);
  assert.equal((await post("seal", ids)).status, 200);
  await new Promise((resolve) => server.close(resolve));
  server = createHostServer({ queryFn, store: fileStore(dir) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const found = await fetch(`${base}/api/lookup?orderName=%231042&carton=4`);
  const box = await found.json();
  assert.equal(found.status, 200);
  assert.equal(box.rows[0].sku, "BOTTLE");
  assert.equal(box.rows[0].quantity, 6);
  assert.equal(box.rows[0].fulfillmentOrderLineItemId, items[2].id);
});
