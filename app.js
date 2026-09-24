"use strict";
const $ = (id) => document.getElementById(id),
  C = Carton,
  S = CartonShopify;
let state = null,
  selected = null,
  dispatch = null,
  viewDispatch = false,
  source = null,
  sourceChecked = false,
  checkedBoxes = new Set();
const storageKey = "carton-trace-v1";
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let pendingAction = null;
function confirmAction(message, fn) {
  $("notice").textContent = message;
  pendingAction = fn;
  $("confirmAction").hidden = false;
  $("cancelAction").hidden = false;
}
function clearConfirmation() {
  pendingAction = null;
  $("confirmAction").hidden = true;
  $("cancelAction").hidden = true;
}
$("confirmAction").onclick = () => {
  const fn = pendingAction;
  clearConfirmation();
  act(fn);
};
$("cancelAction").onclick = () => {
  clearConfirmation();
  $("notice").textContent = "Canceled. Record unchanged.";
};
function act(fn) {
  clearConfirmation();
  try {
    $("notice").textContent = "";
    fn();
  } catch (e) {
    $("notice").textContent = e.message;
  }
}
function start() {
  const lines = $("lines")
    .value.split("\n")
    .filter((x) => x.trim())
    .map((row) => {
      const fields = row.split("|").map((s) => s.trim());
      if (fields.length !== 3)
        throw Error("Each line needs SKU | product name | quantity.");
      return { sku: fields[0], name: fields[1], qty: Number(fields[2]) };
    });
  const next = C.create($("order").value, lines, $("boxes").value.split(","));
  source = null;
  sourceChecked = false;
  checkedBoxes.clear();
  dispatch = null;
  viewDispatch = false;
  state = next;
  selected = state.boxes[0];
  render();
}
function table(rows) {
  return (
    "<table><thead><tr><th>Product</th><th>SKU</th><th>Units</th></tr></thead><tbody>" +
    rows
      .map(
        (r) =>
          "<tr><td>" +
          escape(r.name) +
          "</td><td>" +
          escape(r.sku) +
          "</td><td>" +
          r.qty +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table>"
  );
}
function displayRow(row) {
  if (!source) return row;
  const item = source.items.find((x) => x.id === row.sku);
  return { ...row, sku: item ? item.sku : row.sku };
}
function render() {
  clearConfirmation();
  if (!state) return;
  const packSku = $("sku").value;
  const draft = state;
  state = viewDispatch && dispatch ? dispatch.state : draft;
  $("setup").hidden = true;
  $("workspace").hidden = false;
  $("title").textContent = "Order " + state.order;
  $("balance").innerHTML =
    "<h2>" +
    (C.complete(state) ? "All units accounted for" : "Packing in progress") +
    "</h2>" +
    table(
      state.lines.map((l) => displayRow({
        ...l,
        qty: C.remaining(state, l.sku) + " remaining / " + l.qty,
      })),
    );
  $("box").innerHTML = state.boxes
    .map((b) => "<option>" + escape(b) + "</option>")
    .join("");
  $("box").value = selected;
  $("sku").innerHTML = state.lines
    .map(
      (l) =>
        '<option value="' +
        escape(l.sku) +
        '">' +
        escape(l.name + (source ? " · " + displayRow(l).sku : "")) +
        " · " +
        C.remaining(state, l.sku) +
        " left</option>",
    )
    .join("");
  if (state.lines.some((l) => l.sku === packSku)) $("sku").value = packSku;
  for (const id of ["from", "to", "removeBoxName"])
    $(id).innerHTML = state.boxes
      .map((b) => "<option>" + escape(b) + "</option>")
      .join("");
  $("moveSku").innerHTML = state.lines
    .map((l) => '<option value="' + escape(l.sku) + '">' +
      escape(l.name + " · " + displayRow(l).sku) + "</option>")
    .join("");
  $("cards").innerHTML = state.boxes
    .map(
      (b) =>
        '<button data-box="' +
        escape(b) +
        '" aria-pressed="' +
        (b === selected) +
        '">Box ' +
        escape(b) +
        "<small>" +
        C.contents(state, b).reduce((n, a) => n + a.qty, 0) +
        " units</small></button>",
    )
    .join("");
  $("detail").innerHTML =
    "<h2>Box " +
    escape(selected) +
    "</h2><p>Carton " +
    (state.boxes.indexOf(selected) + 1) +
    " of " +
    state.boxes.length +
    "</p>" +
    table(C.contents(state, selected).map(displayRow));
  $("slips").innerHTML = state.boxes
    .map(
      (b, i) =>
        "<section><p>PACKING LIST · " +
        escape(state.order) +
        "</p><h1>Box " +
        escape(b) +
        "</h1><p>Carton " +
        (i + 1) +
        " of " +
        state.boxes.length +
        "</p>" +
        table(C.contents(state, b).map(displayRow)) +
        "</section>",
    )
    .join("");
  $("print").hidden = !viewDispatch;
  $("save").disabled = false;
  $("pack").hidden = viewDispatch;
  $("repack").hidden = viewDispatch;
  $("cartonManagement").hidden = viewDispatch;
  $("seal").hidden = !!dispatch;
  $("seal").disabled = !C.complete(draft) ||
    (!!source && (!sourceChecked || checkedBoxes.size !== draft.boxes.length));
  $("viewDraft").hidden = !viewDispatch;
  $("viewDispatch").hidden = !dispatch || viewDispatch;
  $("exportSlips").hidden = !viewDispatch;
  $("exportManifest").hidden = !viewDispatch || !source;
  $("dispatchTitle").textContent = viewDispatch
    ? "Sealed dispatch record"
    : "Packing draft";
  $("sourceInfo").textContent = source
    ? "Shopify order " + source.orderName + " · fulfillment order " + source.fulfillmentOrderId +
      " · " + source.items.length + " shippable lines imported. " +
      (sourceChecked ? "Source response compared for this session." : "Import a fresh response to compare before sealing.")
    : "Manual order entry.";
  $("sourceRefresh").hidden = !source || !!dispatch || viewDispatch;
  $("cartonCheck").hidden = !source || viewDispatch;
  $("checkStatus").textContent = source
    ? checkedBoxes.size + " of " + draft.boxes.length + " cartons checked. " +
      (checkedBoxes.has(selected) ? "Box " + selected + " checked." : "Check the physical contents of box " + selected + ".")
    : "";
  $("checkCarton").disabled = !source || viewDispatch || !draft.boxes.includes(selected) ||
    !C.contents(draft, selected).length || checkedBoxes.has(selected);
  $("dispatchInfo").textContent = dispatch
    ? "Dispatch sealed " +
      dispatch.at +
      ". Later draft edits do not change this record."
    : "Reconcile all quantities and fill every carton, then seal the record after checking the actual contents.";
  state = draft;
  persist();
}
$("start").onclick = () => act(start);
$("assign").onclick = () =>
  act(() => {
    selected = $("box").value;
    state = C.assign(
      state,
      selected,
      $("sku").value,
      Number($("quantity").value),
    );
    checkedBoxes.clear();
    render();
  });
$("cards").onclick = (e) => {
  const b = e.target.closest("button[data-box]");
  if (b) {
    selected = b.dataset.box;
    render();
  }
};
$("new").onclick = () =>
  confirmAction(
    "Replace this record with a new order? Download it first to keep it.",
    () => {
      state = null;
      dispatch = null;
      viewDispatch = false;
      source = null;
      sourceChecked = false;
      checkedBoxes.clear();
      $("save").disabled = true;
      try {
        localStorage.removeItem(storageKey);
      } catch (e) {}
      $("workspace").hidden = true;
      $("setup").hidden = false;
      $("storageStatus").textContent = "";
    },
  );
$("print").onclick = () => window.print();
$("example").onclick = () =>
  act(() => {
    $("order").value = "CT-104";
    $("lines").value =
      "MUG | Stoneware mug | 24\nTEA | Tea tin | 12\nBOT | Bottle | 8";
    $("boxes").value = "1, 2, 3, 4";
    start();
    for (const [b, k, n] of [
      ["1", "MUG", 12],
      ["2", "MUG", 12],
      ["2", "TEA", 6],
      ["3", "TEA", 6],
      ["4", "BOT", 8],
    ])
      state = C.assign(state, b, k, n);
    selected = "2";
    render();
  });

$("move").onclick = () =>
  act(() => {
    const to = $("to").value;
    state = C.move(
      state,
      $("from").value,
      to,
      $("moveSku").value,
      Number($("moveQty").value),
    );
    checkedBoxes.clear();
    selected = to;
    render();
    $("notice").textContent = "Units moved. Order totals preserved.";
  });
$("unpack").onclick = () =>
  act(() => {
    state = C.unpack(
      state,
      $("from").value,
      $("moveSku").value,
      Number($("moveQty").value),
    );
    checkedBoxes.clear();
    render();
    $("notice").textContent =
      "Units returned to unpacked. Reconcile before dispatch.";
  });

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(S.bundle(state, dispatch, source)));
    $("storageStatus").textContent = "Draft saved in this browser.";
  } catch (e) {
    $("storageStatus").textContent =
      "Browser saving unavailable. Download the record to keep it.";
  }
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () =>
  act(() => {
    download(
      "carton-trace-record.json",
      JSON.stringify(S.bundle(state, dispatch, source), null, 2),
      "application/json",
    );
    $("notice").textContent =
      "Record file prepared for download. Keep it with this order.";
  });
$("load").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2000000) throw Error("Choose a record under 2 MB.");
    const restored = S.restore(await file.text());
    const apply = () => {
      state = restored.draft;
      dispatch = restored.dispatch;
      source = restored.shopifySource;
      sourceChecked = false;
      checkedBoxes.clear();
      viewDispatch = !!dispatch;
      selected = (dispatch ? dispatch.state : state).boxes[0];
      render();
      $("notice").textContent =
        "Record reopened. Select a carton to see its contents.";
    };
    if (state)
      confirmAction(
        "Replace this record with the opened file? Save the current record first if needed.",
        apply,
      );
    else apply();
  } catch (err) {
    $("notice").textContent = "Record not opened: " + err.message;
  } finally {
    e.target.value = "";
  }
};
$("seal").onclick = () =>
  confirmAction(
    "Confirm the recorded quantities match the packed cartons. This saves a fixed dispatch record.",
    () => {
      dispatch = C.seal(state, new Date().toISOString());
      viewDispatch = true;
      render();
      $("notice").textContent =
        "Dispatch sealed. Download the record and packing slips.";
    },
  );
$("viewDraft").onclick = () => {
  viewDispatch = false;
  selected = state.boxes[0];
  render();
};
$("viewDispatch").onclick = () => {
  viewDispatch = true;
  selected = dispatch.state.boxes[0];
  render();
};
$("exportSlips").onclick = () =>
  act(() => {
    if (!dispatch) throw Error("Seal a dispatch first.");
    download(
      "carton-trace-packing-slips.html",
      CartonReport.slips(dispatch, source),
      "text/html",
    );
  });
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    const r = S.restore(saved);
    state = r.draft;
    dispatch = r.dispatch;
    source = r.shopifySource;
    sourceChecked = false;
    checkedBoxes.clear();
    viewDispatch = !!dispatch;
    selected = (dispatch ? dispatch.state : state).boxes[0];
    render();
  }
} catch (e) {
  $("notice").textContent =
    "Saved browser draft could not be restored. Reopen a downloaded record or start a new one.";
}

$("addBox").onclick = () =>
  act(() => {
    state = C.addBox(state, $("newBox").value);
    checkedBoxes.clear();
    selected = state.boxes[state.boxes.length - 1];
    $("newBox").value = "";
    render();
  });
$("removeBox").onclick = () =>
  act(() => {
    state = C.removeBox(state, $("removeBoxName").value);
    checkedBoxes.clear();
    if (!state.boxes.includes(selected)) selected = state.boxes[0];
    render();
    $("notice").textContent =
      "Empty carton removed. Remaining carton numbers updated.";
  });

async function importShopify(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2000000) throw Error("Choose a response under 2 MB.");
    const fresh = S.fromResponse(await file.text(), $("fulfillmentOrderId").value || source?.fulfillmentOrderId);
    if (source && state && !dispatch && source.orderId === fresh.orderId &&
        source.fulfillmentOrderId === fresh.fulfillmentOrderId) {
      const diff = S.changes(source, fresh);
      if (!diff.length) {
        source = fresh;
        sourceChecked = true;
        render();
        $("notice").textContent = "Shopify source rechecked: no line or quantity changes.";
      } else {
        const result = S.rebase(state, source, fresh);
        confirmAction("Shopify data changed in " + diff.length + " line(s). Apply the new quantities? " +
          result.removed.reduce((n, x) => n + x.qty, 0) +
          " previously packed units will be returned from cartons. Recheck every carton before sealing.", () => {
            state = result.state;
            source = fresh;
            sourceChecked = false;
            checkedBoxes.clear();
            selected = state.boxes[0];
            render();
            $("notice").textContent = "Updated source applied. Reconcile unpacked units and recheck physical cartons.";
          });
      }
    } else {
      const apply = () => {
        state = S.toDraft(fresh, $("boxes").value.split(","));
        source = fresh;
        sourceChecked = false;
        checkedBoxes.clear();
        dispatch = null;
        viewDispatch = false;
        selected = state.boxes[0];
        render();
        $("notice").textContent = "Shopify fulfillment lines imported. Record carton contents.";
      };
      if (state) confirmAction("Replace this packing record with the imported Shopify order? Download the current record first if needed.", apply);
      else apply();
    }
  } catch (err) {
    $("notice").textContent = "Shopify data not imported: " + err.message;
  } finally {
    e.target.value = "";
  }
}
$("shopifyImport").onchange = importShopify;
$("shopifyRefresh").onchange = importShopify;
$("exportManifest").onclick = () => act(() => {
  if (!dispatch || !source) throw Error("Seal a Shopify sourced record first.");
  download("carton-trace-shopify-handoff.json",
    JSON.stringify(S.manifest(dispatch.state, source), null, 2), "application/json");
  $("notice").textContent = "Shopify handoff downloaded. A store integration must recheck current quantities before any fulfillment write.";
});
$("checkCarton").onclick = () => act(() => {
  if (!source || !state || !C.contents(state, selected).length)
    throw Error("Select a packed carton to check.");
  checkedBoxes.add(selected);
  render();
  $("notice").textContent = "Box " + selected + " marked checked. Any packing change clears these checks.";
});
