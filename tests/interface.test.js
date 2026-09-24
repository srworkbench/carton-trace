const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, "..");
function app(saved) {
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    { url: "http://localhost", runScripts: "outside-only" },
  );
  if (saved) dom.window.localStorage.setItem("carton-trace-v1", saved);
  for (const file of ["core.js", "report.js", "shopify.js", "app.js"])
    dom.window.eval(fs.readFileSync(path.join(root, file), "utf8"));
  const d = dom.window.document;
  return {
    dom,
    $: (id) => d.getElementById(id),
    click: (id) => d.getElementById(id).click(),
    saved: () => dom.window.localStorage.getItem("carton-trace-v1"),
  };
}
test("UI model: seal, repack draft, reload preserves dispatch contents", () => {
  const a = app();
  a.click("example");
  assert.match(a.$("detail").textContent, /MUG12/);
  a.click("seal");
  assert.equal(a.$("confirmAction").hidden, false);
  a.click("confirmAction");
  assert.equal(a.$("dispatchTitle").textContent, "Sealed dispatch record");
  a.click("viewDraft");
  a.$("from").value = "2";
  a.$("to").value = "3";
  a.$("moveSku").value = "MUG";
  a.$("moveQty").value = "5";
  a.click("move");
  const saved = JSON.parse(a.saved());
  assert.equal(
    saved.draft.allocations.find((x) => x.box === "2" && x.sku === "MUG").qty,
    7,
  );
  const b = app(a.saved());
  b.$("cards").querySelector('[data-box="2"]').click();
  assert.match(b.$("detail").textContent, /MUG12/);
  assert.match(b.$("detail").textContent, /TEA6/);
  a.dom.window.close();
  b.dom.window.close();
});
test("UI model: cancel and failed repack retain record; no stale confirmation survives edits", () => {
  const a = app();
  a.click("example");
  const before = a.saved();
  a.click("new");
  a.click("cancelAction");
  assert.equal(a.saved(), before);
  a.click("seal");
  a.$("from").value = "2";
  a.$("to").value = "3";
  a.$("moveQty").value = "999";
  a.click("move");
  assert.equal(a.$("confirmAction").hidden, true);
  assert.equal(a.saved(), before);
  assert.match(a.$("notice").textContent, /enough|exceeds|available|quantity/i);
  a.dom.window.close();
});
test("UI model: valid portable import replaces only after confirmation; malformed import preserves state", async () => {
  const a = app();
  a.click("example");
  const before = a.saved();
  a.click("seal");
  a.click("confirmAction");
  const sealed = a.saved();
  const open = async (raw) => {
    const target = {
      files: [{ size: raw.length, text: async () => raw }],
      value: "file",
    };
    await a.$("load").onchange({ target });
    assert.equal(target.value, "");
  };
  await open("{bad");
  assert.equal(a.saved(), sealed);
  assert.match(a.$("notice").textContent, /not opened/);
  await open(before);
  assert.equal(a.saved(), sealed);
  a.click("cancelAction");
  assert.equal(a.saved(), sealed);
  await open(before);
  a.click("confirmAction");
  assert.equal(JSON.parse(a.saved()).dispatch, null);
  a.dom.window.close();
});

test("UI model: consolidate, remove empty carton, seal updated packing list", () => {
  const a = app();
  a.click("example");
  a.$("from").value = "3";
  a.$("to").value = "2";
  a.$("moveSku").value = "TEA";
  a.$("moveQty").value = "6";
  a.click("move");
  assert.equal(a.$("seal").disabled, true);
  a.$("removeBoxName").value = "3";
  a.click("removeBox");
  assert.equal(a.$("seal").disabled, false);
  a.click("seal");
  a.click("confirmAction");
  assert.equal(JSON.parse(a.saved()).dispatch.state.boxes.length, 3);
  a.dom.window.close();
});

test("UI model: Shopify response import and changed-order rebase need explicit confirmation", async () => {
  const a = app();
  const read = (name) => fs.readFileSync(path.join(root, "fixtures", name), "utf8");
  const open = async (raw) => {
    const target = { files: [{ size: raw.length, text: async () => raw }], value: "file" };
    await a.$("shopifyImport").onchange({ target });
    assert.equal(target.value, "");
  };
  await open(read("shopify-order.json"));
  assert.match(a.$("sourceInfo").textContent, /Shopify order #1042/);
  assert.match(a.$("balance").textContent, /8 remaining/);
  const before = a.saved();
  await open(read("shopify-order-changed.json"));
  assert.equal(a.$("confirmAction").hidden, false);
  assert.equal(a.saved(), before);
  a.click("confirmAction");
  assert.match(a.$("balance").textContent, /6 remaining/);
  assert.equal(JSON.parse(a.saved()).shopifySource.items[2].qty, 6);
  a.dom.window.close();
});

test("UI model: imported dispatch requires a second source comparison", async () => {
  const a = app();
  a.$("boxes").value = "1";
  const raw = fs.readFileSync(path.join(root, "fixtures/shopify-order.json"), "utf8");
  const open = async () => a.$("shopifyImport").onchange({ target: {
    files: [{ size: raw.length, text: async () => raw }], value: "file" } });
  await open();
  const ids = JSON.parse(a.saved()).shopifySource.items;
  for (const item of ids) {
    a.$("sku").value = item.id;
    a.$("quantity").value = String(item.qty);
    a.click("assign");
  }
  assert.equal(a.$("seal").disabled, true);
  await open();
  assert.equal(a.$("seal").disabled, true);
  a.click("checkCarton");
  assert.equal(a.$("seal").disabled, false);
  assert.match(a.$("sourceInfo").textContent, /compared/);
  a.$("from").value = "1";
  a.$("moveSku").value = ids[0].id;
  a.$("moveQty").value = "1";
  a.click("unpack");
  a.$("sku").value = ids[0].id;
  a.$("quantity").value = "1";
  a.click("assign");
  assert.equal(a.$("seal").disabled, true);
  assert.match(a.$("checkStatus").textContent, /0 of 1/);
  a.dom.window.close();
});

test("UI model: Shopify comparison stays available and carton choice survives packing", async () => {
  const a = app();
  const raw = fs.readFileSync(path.join(root, "fixtures/shopify-order.json"), "utf8");
  const upload = async (control) => {
    const target = { files: [{ size: raw.length, text: async () => raw }], value: "file" };
    await a.$(control).onchange({ target });
  };
  await upload("shopifyImport");
  assert.equal(a.$("sourceRefresh").hidden, false);
  a.$("box").value = "2";
  a.$("sku").selectedIndex = 1;
  a.$("quantity").value = "3";
  a.click("assign");
  assert.equal(a.$("box").value, "2");
  assert.equal(a.$("sku").selectedIndex, 1);
  assert.match(a.$("detail").textContent, /Tea tin.*3/);
  await upload("shopifyRefresh");
  assert.match(a.$("sourceInfo").textContent, /compared/);
  a.dom.window.close();
});
