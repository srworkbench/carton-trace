/* Local packer interface. Embed behind your Shopify app's authentication in production. */
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createWorkflow } = require("./workflow.js");

function createHostServer({ queryFn, store, demoSource }) {
  const workflow = createWorkflow({ queryFn, store });
  const orderId = (value) => /^\d+$/.test(String(value || ""))
    ? `gid://shopify/Order/${value}` : value;
  const fulfillmentOrderId = (value) => !value ? undefined : /^\d+$/.test(String(value))
    ? `gid://shopify/FulfillmentOrder/${value}` : value;
  async function body(req) {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 20000) throw Error("Request is too large.");
    }
    return JSON.parse(raw || "{}");
  }
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        const html = await fs.readFile(path.join(__dirname, "host-ui.html"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
        return;
      }
      let result;
      if (req.method === "GET" && url.pathname === "/api/lookup") {
        result = await workflow.findBoxByOrderName(url.searchParams.get("orderName"),
          url.searchParams.get("carton"));
      } else if (req.method === "GET" && url.pathname === "/api/record") {
        result = await workflow.get(orderId(url.searchParams.get("orderId")),
          fulfillmentOrderId(url.searchParams.get("fulfillmentOrderId")));
      } else if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        const data = await body(req);
        const o = orderId(data.orderId), f = fulfillmentOrderId(data.fulfillmentOrderId);
        switch (url.pathname) {
          case "/api/start": result = await workflow.start(o, f, data.cartons); break;
          case "/api/assign": result = await workflow.assign(o, f, data.carton, data.lineId, data.quantity); break;
          case "/api/unassign": result = await workflow.unassign(o, f, data.carton, data.lineId, data.quantity); break;
          case "/api/reconcile": result = await workflow.reconcile(o, f); break;
          case "/api/acknowledge": result = await workflow.acknowledgeRemoval(o, f); break;
          case "/api/check": result = await workflow.checkCarton(o, f, data.carton); break;
          case "/api/seal": result = await workflow.seal(o, f); break;
          case "/api/demo-source":
            if (!demoSource) throw Error("Demo source control is unavailable.");
            result = demoSource(Boolean(data.changed));
            break;
          default: throw Error("Unknown route.");
        }
      } else throw Error("Unknown route.");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

module.exports = { createHostServer };
