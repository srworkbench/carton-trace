(function (root) {
  "use strict";
  const C = typeof module !== "undefined" ? require("./core") : root.Carton;
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function slips(dispatch, source = null) {
    const d = C.seal(dispatch.state, dispatch.at),
      s = d.state;
    const pages = s.boxes
      .map(
        (b, i) =>
          '<section id="box-' +
          i +
          '"><p>PACKING LIST · ' +
          esc(s.order) +
          "</p><h1>Box " +
          esc(b) +
          "</h1><p>Carton " +
          (i + 1) +
          " of " +
          s.boxes.length +
          " · Sealed " +
          esc(d.at) +
          "</p><table><thead><tr><th>Product</th><th>SKU</th><th>Units</th></tr></thead><tbody>" +
          C.contents(s, b)
            .map(
              (r) =>
                "<tr><td>" +
                esc(r.name) +
                "</td><td>" +
                esc(source?.items.find((x) => x.id === r.sku)?.sku ?? r.sku) +
                "</td><td>" +
                r.qty +
                "</td></tr>",
            )
            .join("") +
          "</tbody></table></section>",
      )
      .join("");
    return (
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Packing slips · ' +
      esc(s.order) +
      "</title><style>body{font-family:system-ui;margin:32px;color:#193b36}section{max-width:850px;margin:30px auto;padding:24px;border:1px solid #aaa;break-after:page}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}h1{font-size:40px;overflow-wrap:anywhere}nav{position:sticky;top:0;background:white;padding:16px}a{display:inline-block;margin:4px 10px}@media print{nav{display:none}section{border:0;margin:0}section:last-child{break-after:auto}tr{break-inside:avoid}}</style><nav>Find a carton: " +
      s.boxes
        .map((b, i) => '<a href="#box-' + i + '">Box ' + esc(b) + "</a>")
        .join("") +
      "</nav>" +
      pages +
      "</html>"
    );
  }
  function visual(dispatch, box) {
    const d = C.seal(dispatch.state, dispatch.at),
      s = d.state,
      rows = C.contents(s, box),
      height = 570 + rows.length * 80;
    const total = rows.reduce((n, x) => n + x.qty, 0);
    let svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="' +
      height +
      '" viewBox="0 0 1080 ' +
      height +
      '"><rect width="1080" height="' +
      height +
      '" fill="#f4f3ed"/>';
    const txt = (x, y, value, size = 30, color = "#193b36", weight = 400) =>
      '<text x="' +
      x +
      '" y="' +
      y +
      '" font-family="Arial,sans-serif" font-size="' +
      size +
      '" font-weight="' +
      weight +
      '" fill="' +
      color +
      '">' +
      esc(value) +
      "</text>";
    svg +=
      txt(60, 65, "CARTON TRACE / " + s.order, 22, "#52665c", 700) +
      txt(60, 145, "Box " + box + " is missing.", 62, "#193b36", 700) +
      txt(60, 207, "Here is what was inside.", 44);
    svg +=
      '<rect x="60" y="250" width="960" height="126" rx="14" fill="#193b36"/>' +
      txt(88, 299, s.boxes.length + " CARTONS", 26, "#f4f3ed", 700) +
      txt(
        88,
        344,
        s.lines.reduce((n, l) => n + l.qty, 0) + " units in the dispatch",
        30,
        "#f4f3ed",
      ) +
      txt(615, 299, "BOX " + box, 26, "#f4d481", 700) +
      txt(615, 344, total + " units to locate", 30, "#f4f3ed");
    rows.forEach((r, i) => {
      const y = 410 + i * 80;
      svg +=
        '<rect x="60" y="' +
        y +
        '" width="960" height="66" rx="9" fill="white"/>' +
        txt(82, y + 43, r.name.slice(0, 40), 30) +
        txt(765, y + 43, r.qty + " units", 30, "#193b36", 700);
    });
    svg +=
      txt(60, height - 65, "Read from the sealed dispatch record.", 26) +
      txt(
        60,
        height - 27,
        "Later packing edits keep this record unchanged.",
        23,
        "#52665c",
      );
    return svg + "</svg>";
  }
  function changeVisual(before, after, rebase) {
    const beforeUnits = before.items.reduce((n, x) => n + x.qty, 0);
    const afterUnits = after.items.reduce((n, x) => n + x.qty, 0);
    const removed = rebase.removed.reduce((n, x) => n + x.qty, 0);
    const changed = rebase.changed.find((x) => x.before && x.after && x.before.qty !== x.after.qty);
    if (!changed) throw Error("A changed line is required for this visual.");
    const name = changed.after.name;
    const one = changed.before.qty, two = changed.after.qty;
    const text = (x, y, value, size, color = "#193b36", weight = 400) =>
      `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(value)}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
      <rect width="1080" height="1080" fill="#f4f3ed"/>
      <rect width="1080" height="196" fill="#193b36"/>
      ${text(60, 64, "CARTON TRACE / SHOPIFY ORDER " + before.orderName, 24, "#dbe9de", 700)}
      ${text(60, 143, "The order changed mid-pack.", 62, "#fff", 700)}
      ${text(60, 254, "A second fulfillment response changes what can ship.", 32)}
      <rect x="60" y="305" width="455" height="275" rx="18" fill="#fff" stroke="#bdcec4" stroke-width="2"/>
      <rect x="565" y="305" width="455" height="275" rx="18" fill="#fff" stroke="#bdcec4" stroke-width="2"/>
      ${text(90, 354, "AT PACKING START", 23, "#52665c", 700)}
      ${text(595, 354, "BEFORE DISPATCH", 23, "#52665c", 700)}
      ${text(90, 455, beforeUnits + " units", 66, "#193b36", 700)}
      ${text(595, 455, afterUnits + " units", 66, "#193b36", 700)}
      ${text(90, 527, name + ": " + one, 29)}
      ${text(595, 527, name + ": " + two, 29)}
      <rect x="60" y="620" width="960" height="128" rx="15" fill="#f7ddce"/>
      ${text(87, 674, removed + " units removed from the carton draft", 35, "#7b2e20", 700)}
      ${text(87, 718, "The old packing list cannot be sealed as-is.", 27, "#7b2e20")}
      ${text(60, 821, "Before dispatch:", 36, "#193b36", 700)}
      <rect x="60" y="849" width="460" height="79" rx="12" fill="#e2eee7"/>
      <rect x="540" y="849" width="480" height="79" rx="12" fill="#e2eee7"/>
      ${text(85, 901, "1  Compare the source again", 26, "#193b36", 700)}
      ${text(565, 901, "2  Recheck every carton", 26, "#193b36", 700)}
      ${text(60, 1001, "Then print per-carton slips + export the Shopify line-ID handoff.", 25, "#52665c")}
    </svg>`;
  }
  function shopifyLookupVisual(dispatch, source, carton, removedCount) {
    const d = C.seal(dispatch.state, dispatch.at), s = d.state;
    if (s.boxes.length !== 4) throw Error("This sample visual expects four cartons.");
    const rows = C.contents(s, carton);
    if (rows.length !== 1) throw Error("This sample visual expects one product in the looked-up carton.");
    const row = rows[0];
    const item = source.items.find((x) => x.id === row.sku);
    if (!item) throw Error("The selected carton is absent from the Shopify source.");
    const text = (x, y, value, size, color = "#193b36", weight = 400) =>
      `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(value)}</text>`;
    const summaries = s.boxes.map((box, index) => {
      const contents = C.contents(s, box);
      const label = (line) => {
        const sku = source.items.find((item) => item.id === line.sku)?.sku;
        if (!sku) throw Error("A carton line is absent from the Shopify source.");
        return `${sku} × ${line.qty}`.slice(0, 21);
      };
      const x = 60 + index * 245;
      const active = box === carton;
      return `<rect x="${x}" y="350" width="225" height="164" rx="16" fill="${active ? "#dcebdc" : "#fff"}" stroke="${active ? "#397e57" : "#cbd8cf"}" stroke-width="${active ? 3 : 2}"/>
        ${text(x + 18, 391, `CARTON ${box}`, 23, active ? "#245b39" : "#52665c", 700)}
        ${text(x + 18, 445, `${contents.reduce((n, line) => n + line.qty, 0)} units`, 37, "#193b36", 700)}
        ${text(x + 18, 477, label(contents[0]), 20, "#52665c")}
        ${contents[1] ? text(x + 18, 503, `+ ${label(contents[1])}`, 20, "#52665c") : ""}`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
      <rect width="1080" height="1080" fill="#f4f3ed"/>
      <rect width="1080" height="258" fill="#193b36"/>
      ${text(60, 68, "CARTON TRACE / SHOPIFY WORKFLOW DEMO", 23, "#dbe9de", 700)}
      ${text(60, 139, "One fulfillment.", 65, "#fff", 700)}
      ${text(60, 212, "Four physical cartons.", 65, "#fff", 700)}
      ${text(60, 318, `SEALED CARTON MAP  /  ${source.orderName}`, 28, "#52665c", 700)}
      ${summaries}
      ${text(60, 592, `LOOK UP LATER: ${source.orderName} / FO ${source.fulfillmentOrderId.split("/").pop()} / CARTON ${carton}`, 31, "#193b36", 700)}
      <rect x="60" y="626" width="960" height="226" rx="18" fill="#fff" stroke="#397e57" stroke-width="3"/>
      ${text(88, 679, "PRODUCT", 23, "#52665c", 700)}
      ${text(715, 679, "QUANTITY", 23, "#52665c", 700)}
      ${text(88, 744, row.name, 46, "#193b36", 700)}
      ${text(715, 744, `${row.qty} units`, 46, "#193b36", 700)}
      ${text(88, 808, `SKU ${item.sku}  /  fulfillment line ${item.id.split("/").pop()}`, 27, "#52665c")}
      <rect x="60" y="893" width="960" height="126" rx="15" fill="#e2eee7"/>
      ${text(88, 943, `Before sealing: ${removedCount} units removed after a source change.`, 30, "#193b36", 700)}
      ${text(88, 988, "Fresh source check + all four cartons rechecked.", 27, "#52665c")}
    </svg>`;
  }
  const api = { slips, visual, changeVisual, shopifyLookupVisual };
  if (typeof module !== "undefined") module.exports = api;
  else root.CartonReport = api;
})(typeof globalThis === "undefined" ? this : globalThis);
