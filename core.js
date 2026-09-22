/* Carton Trace — deterministic packing ledger. No dependencies. */
(function (root) {
  "use strict";
  const copy = (x) => JSON.parse(JSON.stringify(x));
  function text(v, name) {
    if (typeof v !== "string" || !v.trim() || v.length > 120)
      throw Error(name + " must contain 1–120 characters.");
    return v.trim();
  }
  function qty(v) {
    if (!Number.isSafeInteger(v) || v < 1 || v > 1000000)
      throw Error("Quantity must be a whole number from 1 to 1000000.");
    return v;
  }
  function create(order, lines, boxes) {
    order = text(order, "Order");
    if (!Array.isArray(lines) || !lines.length || lines.length > 100)
      throw Error("Enter 1–100 product lines.");
    if (!Array.isArray(boxes) || !boxes.length || boxes.length > 50)
      throw Error("Enter 1–50 cartons.");
    const grouped = new Map();
    for (const l of lines) {
      const sku = text(l.sku, "SKU"),
        name = text(l.name, "Product"),
        n = qty(l.qty);
      const prev = grouped.get(sku);
      if (prev) {
        if (prev.name !== name)
          throw Error("Conflicting product names for SKU " + sku);
        prev.qty = qty(prev.qty + n);
      } else grouped.set(sku, { sku, name, qty: n });
    }
    lines = [...grouped.values()];
    boxes = boxes.map((b) => text(b, "Carton"));
    if (new Set(boxes).size !== boxes.length)
      throw Error("Carton names must be unique.");
    return { version: 1, order, lines, boxes, allocations: [] };
  }
  function remaining(s, sku) {
    const line = s.lines.find((l) => l.sku === sku);
    if (!line) throw Error("Unknown SKU.");
    return (
      line.qty -
      s.allocations.filter((a) => a.sku === sku).reduce((n, a) => n + a.qty, 0)
    );
  }
  function assign(s, box, sku, n) {
    n = qty(n);
    if (!s.boxes.includes(box)) throw Error("Unknown carton.");
    if (remaining(s, sku) < n) throw Error("Not enough unpacked units.");
    const t = copy(s),
      a = t.allocations.find((a) => a.box === box && a.sku === sku);
    if (a) a.qty += n;
    else t.allocations.push({ box, sku, qty: n });
    return t;
  }
  function contents(s, box) {
    if (!s.boxes.includes(box)) throw Error("Unknown carton.");
    return s.allocations
      .filter((a) => a.box === box)
      .map((a) => ({ ...a, name: s.lines.find((l) => l.sku === a.sku).name }));
  }
  function complete(s) {
    return (
      s.lines.every((l) => remaining(s, l.sku) === 0) &&
      s.boxes.every((b) => contents(s, b).length > 0)
    );
  }
  function unpack(s, box, sku, n) {
    n = qty(n);
    const a = s.allocations.find((a) => a.box === box && a.sku === sku);
    if (!a || a.qty < n)
      throw Error("That carton does not contain enough units.");
    const t = copy(s),
      row = t.allocations.find((a) => a.box === box && a.sku === sku);
    row.qty -= n;
    t.allocations = t.allocations.filter((a) => a.qty > 0);
    return t;
  }
  function move(s, from, to, sku, n) {
    if (from === to) throw Error("Choose a different destination carton.");
    if (!s.boxes.includes(to)) throw Error("Unknown destination carton.");
    return assign(unpack(s, from, sku, n), to, sku, n);
  }
  function addBox(s, name) {
    name = text(name, "Carton");
    if (s.boxes.includes(name)) throw Error("Carton names must be unique.");
    if (s.boxes.length >= 50) throw Error("At most 50 cartons are supported.");
    const t = copy(s);
    t.boxes.push(name);
    return t;
  }
  function removeBox(s, name) {
    if (!s.boxes.includes(name)) throw Error("Unknown carton.");
    if (contents(s, name).length)
      throw Error("Move or unpack all contents before removing this carton.");
    if (s.boxes.length === 1) throw Error("Keep at least one carton.");
    const t = copy(s);
    t.boxes = t.boxes.filter((b) => b !== name);
    return t;
  }
  function validate(raw) {
    if (!raw || raw.version !== 1)
      throw Error("Unsupported packing record version.");
    let s = create(raw.order, raw.lines, raw.boxes);
    if (!Array.isArray(raw.allocations) || raw.allocations.length > 5000)
      throw Error("Invalid packing allocations.");
    for (const a of raw.allocations) {
      if (!a || typeof a !== "object") throw Error("Invalid allocation.");
      s = assign(s, a.box, a.sku, a.qty);
    }
    return s;
  }
  function seal(s, at) {
    s = validate(s);
    if (!complete(s))
      throw Error(
        "Pack every ordered unit and remove empty cartons before sealing.",
      );
    if (
      typeof at !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(at) ||
      !Number.isFinite(Date.parse(at)) ||
      new Date(at).toISOString() !==
        (/\.\d{3}Z$/.test(at) ? at : at.replace("Z", ".000Z"))
    )
      throw Error("Invalid dispatch date.");
    return { at, state: copy(s) };
  }
  function bundle(draft, dispatch) {
    const d = validate(draft);
    let frozen = null;
    if (dispatch) frozen = seal(dispatch.state, dispatch.at);
    return { type: "carton-trace", version: 1, draft: d, dispatch: frozen };
  }
  function restore(raw) {
    if (typeof raw !== "string" || raw.length > 2000000)
      throw Error("Record must be a JSON file under 2 MB.");
    const b = JSON.parse(raw);
    if (!b || b.type !== "carton-trace" || b.version !== 1)
      throw Error("This is not a Carton Trace record.");
    const v = bundle(b.draft, b.dispatch);
    if (v.dispatch && v.dispatch.state.order !== v.draft.order)
      throw Error("Draft and dispatch order references differ.");
    return v;
  }
  const api = {
    create,
    remaining,
    assign,
    contents,
    complete,
    copy,
    unpack,
    move,
    addBox,
    removeBox,
    validate,
    seal,
    bundle,
    restore,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.Carton = api;
})(typeof globalThis === "undefined" ? this : globalThis);
