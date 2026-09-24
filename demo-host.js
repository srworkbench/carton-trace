/* Simulates the Shopify app boundary with two fixture responses. */
const path = require("node:path");
const fs = require("node:fs/promises");
const { fileStore } = require("./file-store.js");
const { createWorkflow } = require("./workflow.js");
const S = require("./shopify.js");

async function main() {
  const root = process.argv[2] || path.join(__dirname, "build", "host-demo");
  await fs.mkdir(root, { recursive: true });
  const out = await fs.mkdtemp(path.join(root, "run-"));
  const responses = ["shopify-order.json", "shopify-order-changed.json"];
  let response = 0;
  const queryFn = async () => JSON.parse(await fs.readFile(
    path.join(__dirname, "fixtures", responses[response]), "utf8"));
  const store = fileStore(path.join(out, "private-records"));
  const host = createWorkflow({ queryFn, store });
  const orderId = "gid://shopify/Order/1042";
  const fulfillmentOrderId = "gid://shopify/FulfillmentOrder/2201";
  const source = S.fromResponse(await queryFn());
  await host.start(orderId, fulfillmentOrderId, ["1", "2", "3", "4"]);
  for (const [box, index, quantity] of [["1", 0, 12], ["2", 0, 12],
    ["2", 1, 6], ["3", 1, 6], ["4", 2, 8]])
    await host.assign(orderId, fulfillmentOrderId, box, source.items[index].id, quantity);
  response = 1;
  const comparison = await host.reconcile(orderId, fulfillmentOrderId);
  // A real host records this acknowledgment only after a person removes the units.
  await host.acknowledgeRemoval(orderId, fulfillmentOrderId);
  for (const box of ["1", "2", "3", "4"])
    await host.checkCarton(orderId, fulfillmentOrderId, box);
  const { handoff } = await host.seal(orderId, fulfillmentOrderId);
  // A fresh host instance retrieves the sealed carton from disk by Shopify IDs.
  const laterHost = createWorkflow({ queryFn, store: fileStore(path.join(out, "private-records")) });
  const lookup = await laterHost.findBox(orderId, fulfillmentOrderId, "4");
  await fs.writeFile(path.join(out, "box-4-lookup.json"), JSON.stringify(lookup, null, 2));
  await fs.writeFile(path.join(out, "shopify-handoff.json"), JSON.stringify(handoff, null, 2));
  console.log(JSON.stringify({
    sourceChangeCount: comparison.changed.length,
    physicalRemoval: comparison.pendingRemoval,
    box4: lookup,
    output: out,
  }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
