const fs = require("node:fs");
const path = require("node:path");
const C = require("./core.js");
const S = require("./shopify.js");
const R = require("./report.js");

const out = process.argv[2] || path.join(__dirname, "build", "shopify");
fs.mkdirSync(out, { recursive: true });
const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const before = S.fromResponse(fixture("shopify-order.json"));
const after = S.fromResponse(fixture("shopify-order-changed.json"));
let draft = S.toDraft(before, ["1", "2", "3", "4"]);
for (const [box, index, qty] of [["1", 0, 12], ["2", 0, 12], ["2", 1, 6],
  ["3", 1, 6], ["4", 2, 8]])
  draft = C.assign(draft, box, before.items[index].id, qty);
const result = S.rebase(draft, before, after);
if (!C.complete(result.state)) throw Error("Rebased packing draft is incomplete.");
const rechecked = S.fromResponse(fixture("shopify-order-changed.json"));
if (S.changes(after, rechecked).length) throw Error("Source changed again before dispatch.");
// Constructed demonstration: a human would inspect these physical cartons.
const operatorCheckedCartons = new Set(result.state.boxes);
if (operatorCheckedCartons.size !== result.state.boxes.length) throw Error("Unchecked cartons.");
const dispatch = C.seal(result.state, "2026-09-23T12:00:00Z");
fs.writeFileSync(path.join(out, "source-change.svg"), R.changeVisual(before, after, result));
fs.writeFileSync(path.join(out, "carton-lookup.svg"), R.shopifyLookupVisual(dispatch, after, "4",
  result.removed.reduce((n, x) => n + x.qty, 0)));
fs.writeFileSync(path.join(out, "packing-slips.html"), R.slips(dispatch, after));
fs.writeFileSync(path.join(out, "shopify-handoff.json"), JSON.stringify(S.manifest(dispatch.state, after), null, 2));
fs.writeFileSync(path.join(out, "record.json"), JSON.stringify(S.bundle(result.state, dispatch, after), null, 2));
console.log(JSON.stringify({ beforeUnits: 44, afterUnits: 42,
  removedUnits: result.removed.reduce((n, x) => n + x.qty, 0),
  cartons: result.state.boxes.length, operatorChecks: "constructed demonstration",
  files: fs.readdirSync(out) }, null, 2));
