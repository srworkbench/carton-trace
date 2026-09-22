#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  C = require("./core"),
  R = require("./report");
try {
  const [cmd, input, out, box = "2"] = process.argv.slice(2);
  if (cmd === "demo") {
    let s = C.create(
      "CT-104",
      [
        { sku: "MUG", name: "Stoneware mug", qty: 24 },
        { sku: "TEA", name: "Tea tin", qty: 12 },
        { sku: "BOT", name: "Bottle", qty: 8 },
      ],
      ["1", "2", "3", "4"],
    );
    for (const [b, k, n] of [
      ["1", "MUG", 12],
      ["2", "MUG", 12],
      ["2", "TEA", 6],
      ["3", "TEA", 6],
      ["4", "BOT", 8],
    ])
      s = C.assign(s, b, k, n);
    const d = C.seal(s, "2026-01-01T12:00:00Z");
    s = C.move(s, "2", "3", "MUG", 5);
    const b = C.bundle(s, d);
    const dir = input || "build/demo";
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of [
      ["record.json", JSON.stringify(b, null, 2)],
      ["packing-slips.html", R.slips(d)],
      ["missing-carton.svg", R.visual(d, "2")],
    ])
      fs.writeFileSync(path.join(dir, name), content);
    console.log(
      JSON.stringify(
        {
          saved: dir,
          dispatchBox2: C.contents(d.state, "2"),
          draftBox2: C.contents(s, "2"),
        },
        null,
        2,
      ),
    );
  } else if (cmd === "inspect" || cmd === "slips" || cmd === "visual") {
    if (!input) throw Error("Choose a record file.");
    const stat = fs.statSync(input);
    if (stat.size > 2000000) throw Error("Record exceeds 2 MB.");
    const b = C.restore(fs.readFileSync(input, "utf8"));
    if (!b.dispatch) throw Error("Record has no sealed dispatch.");
    if (cmd === "inspect")
      console.log(
        JSON.stringify(C.contents(b.dispatch.state, out || "2"), null, 2),
      );
    else {
      if (!out) throw Error("Choose an output file.");
      fs.writeFileSync(
        out,
        cmd === "slips" ? R.slips(b.dispatch) : R.visual(b.dispatch, box),
      );
      console.log(out);
    }
  } else {
    throw Error(
      "Usage: node cli.js demo [directory] | inspect record.json [box] | slips record.json output.html | visual record.json output.svg [box]",
    );
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
