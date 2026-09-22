const test = require("node:test"),
  assert = require("node:assert/strict"),
  C = require("../core.js");
function base() {
  return C.create(
    "CT-104",
    [
      { sku: "MUG", name: "Stoneware mug", qty: 24 },
      { sku: "TEA", name: "Tea tin", qty: 12 },
      { sku: "BOT", name: "Bottle", qty: 8 },
    ],
    ["1", "2", "3", "4"],
  );
}
function packed() {
  let s = base();
  for (const [b, k, n] of [
    ["1", "MUG", 12],
    ["2", "MUG", 12],
    ["2", "TEA", 6],
    ["3", "TEA", 6],
    ["4", "BOT", 8],
  ])
    s = C.assign(s, b, k, n);
  return s;
}
test("complete wholesale order and missing carton lookup", () => {
  const s = packed();
  assert.equal(C.complete(s), true);
  assert.deepEqual(
    C.contents(s, "2").map((x) => [x.sku, x.qty]),
    [
      ["MUG", 12],
      ["TEA", 6],
    ],
  );
  assert.equal(
    C.contents(s, "2").reduce((n, a) => n + a.qty, 0),
    18,
  );
});
test("reject overpack without changing order", () => {
  const s = base(),
    old = JSON.stringify(s);
  assert.throws(() => C.assign(s, "1", "MUG", 25), /unpacked/);
  assert.equal(JSON.stringify(s), old);
});
test("incomplete and empty cartons do not pass", () => {
  assert.equal(C.complete(base()), false);
  let s = C.create("X", [{ sku: "A", name: "A", qty: 1 }], ["1", "2"]);
  s = C.assign(s, "1", "A", 1);
  assert.equal(C.complete(s), false);
});
test("unsafe quantities and ambiguous identity rejected", () => {
  for (const n of [0, -1, 1.1, NaN, Infinity, "2", 1000001])
    assert.throws(() => C.assign(base(), "1", "MUG", n));
  assert.throws(
    () =>
      C.create(
        "X",
        [
          { sku: "A", name: "a", qty: 1 },
          { sku: "A", name: "b", qty: 2 },
        ],
        ["1"],
      ),
    /Conflicting/,
  );
});
module.exports = { base, packed };

test("same SKU merges only when product names agree", () => {
  const s = C.create(
    "W",
    [
      { sku: "A", name: "Cup", qty: 3 },
      { sku: "A", name: "Cup", qty: 4 },
    ],
    ["1"],
  );
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0].qty, 7);
});
test("repacking moves partial quantities atomically and conserves totals", () => {
  const s = packed(),
    t = C.move(s, "2", "3", "MUG", 5);
  assert.equal(C.contents(t, "2").find((x) => x.sku === "MUG").qty, 7);
  assert.equal(C.contents(t, "3").find((x) => x.sku === "MUG").qty, 5);
  assert.equal(C.complete(t), true);
  assert.equal(C.contents(s, "2")[0].qty, 12);
});
test("failed moves preserve source and destination", () => {
  const s = packed(),
    before = JSON.stringify(s);
  for (const args of [
    ["2", "missing", "MUG", 1],
    ["2", "3", "MUG", 99],
    ["2", "2", "MUG", 1],
  ])
    assert.throws(() => C.move(s, ...args));
  assert.equal(JSON.stringify(s), before);
});
test("unpack makes dispatch incomplete until correct replacement", () => {
  const s = C.unpack(packed(), "2", "TEA", 6);
  assert.equal(C.complete(s), false);
  assert.equal(C.remaining(s, "TEA"), 6);
  assert.equal(C.complete(C.assign(s, "3", "TEA", 6)), true);
});

test("sealed dispatch survives later repacking and portable round trip", () => {
  const s = packed(),
    d = C.seal(s, "2026-01-01T12:00:00Z");
  const changed = C.move(s, "2", "3", "MUG", 5);
  const file = JSON.stringify(C.bundle(changed, d));
  const restored = C.restore(file);
  assert.equal(C.contents(restored.dispatch.state, "2")[0].qty, 12);
  assert.equal(C.contents(restored.draft, "2")[0].qty, 7);
  assert.equal(C.complete(restored.dispatch.state), true);
});
test("corrupt imported allocation cannot become a valid dispatch", () => {
  const b = C.bundle(packed(), null);
  b.draft.allocations[0].qty = 999;
  assert.throws(() => C.restore(JSON.stringify(b)), /unpacked/);
});
test("incomplete dispatch, unknown versions and foreign orders rejected", () => {
  assert.throws(() => C.seal(base(), "2026-01-01T12:00:00Z"), /every/);
  assert.throws(() => C.restore("{}"), /not a Carton/);
  const b = C.bundle(packed(), C.seal(packed(), "2026-01-01T12:00:00Z"));
  b.draft.order = "OTHER";
  assert.throws(() => C.restore(JSON.stringify(b)), /differ/);
});
test("deep isolation from caller mutations", () => {
  const s = packed(),
    d = C.seal(s, "2026-01-01T12:00:00Z");
  s.allocations[0].qty = 1;
  assert.equal(d.state.allocations[0].qty, 12);
});
test("repeated allocations cannot bypass total check on import", () => {
  const b = C.bundle(packed(), null);
  b.draft.allocations.push({ ...b.draft.allocations[0] });
  assert.throws(() => C.restore(JSON.stringify(b)), /unpacked/);
});
const R = require("../report");
test("portable packing slips preserve every carton and escape untrusted labels", () => {
  const s = C.create(
    "<order>",
    [{ sku: "<SKU>", name: "<script>alert(1)</script>", qty: 2 }],
    ["<box>"],
  );
  const d = C.seal(C.assign(s, "<box>", "<SKU>", 2), "2026-01-01T12:00:00Z");
  const html = R.slips(d);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('href="#box-0"'));
  assert.ok(html.includes("<td>2</td>"));
});
test("generated diagram uses dispatch contents and counts", () => {
  const svg = R.visual(C.seal(packed(), "2026-01-01T12:00:00Z"), "2");
  assert.ok(svg.includes("18 units to locate"));
  assert.ok(svg.includes("44 units in the dispatch"));
  assert.ok(svg.includes("12 units"));
  assert.ok(svg.includes("6 units"));
  assert.throws(() =>
    R.visual(C.seal(packed(), "2026-01-01T12:00:00Z"), "missing"),
  );
});

test("carton consolidation removes empty carton and restores dispatch readiness", () => {
  let s = C.create("O", [{ sku: "A", name: "Item", qty: 4 }], ["1", "2"]);
  s = C.assign(C.assign(s, "1", "A", 2), "2", "A", 2);
  s = C.move(s, "2", "1", "A", 2);
  assert.equal(C.complete(s), false);
  assert.throws(() => C.removeBox(s, "1"), /contents/);
  s = C.removeBox(s, "2");
  assert.equal(C.complete(s), true);
  assert.equal(C.seal(s, "2026-01-01T00:00:00Z").state.boxes.length, 1);
  assert.throws(() => C.addBox(s, "1"), /unique/);
  s = C.addBox(s, "2");
  assert.equal(C.complete(s), false);
});

test("impossible and ambiguous dispatch dates are rejected", () => {
  assert.throws(() => C.seal(packed(), "2026-02-30T12:00:00Z"), /date/);
  assert.throws(() => C.seal(packed(), "2026-01-01T12:00:00"), /date/);
  assert.equal(
    C.seal(packed(), "2026-01-01T12:00:00.123Z").at,
    "2026-01-01T12:00:00.123Z",
  );
});
