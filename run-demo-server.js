const fs = require("node:fs/promises");
const path = require("node:path");
const { fileStore } = require("./file-store.js");
const { createHostServer } = require("./host-server.js");

async function main() {
  const root = path.join(__dirname, "build", "packer-demo");
  await fs.mkdir(root, { recursive: true });
  const directory = process.argv[2] || await fs.mkdtemp(path.join(root, "run-"));
  let changed = false;
  const queryFn = async () => JSON.parse(await fs.readFile(path.join(__dirname, "fixtures",
    changed ? "shopify-order-changed.json" : "shopify-order.json"), "utf8"));
  const server = createHostServer({ queryFn, store: fileStore(path.join(directory, "records")),
    demoSource(value) { changed = value; return { changed }; } });
  server.listen(0, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`Packer demo: ${url}\nRecords: ${directory}`);
  });
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
