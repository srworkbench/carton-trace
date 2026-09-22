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
  function slips(dispatch) {
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
                esc(r.sku) +
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
  const api = { slips, visual };
  if (typeof module !== "undefined") module.exports = api;
  else root.CartonReport = api;
})(typeof globalThis === "undefined" ? this : globalThis);
