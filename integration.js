/* Inject your Shopify app's authenticated GraphQL query function here. */
const Shopify = require("./shopify.js");

async function fetchSource(queryFn, orderId, fulfillmentOrderId) {
  if (typeof queryFn !== "function") throw Error("Provide an authenticated GraphQL query function.");
  if (typeof orderId !== "string" || !/^gid:\/\/shopify\/Order\/\d+$/.test(orderId))
    throw Error("Provide a Shopify Order GID.");
  const response = await queryFn(Shopify.orderQuery, { id: orderId });
  const source = Shopify.fromResponse(response, fulfillmentOrderId);
  if (source.orderId !== orderId) throw Error("GraphQL response returned a different order.");
  return source;
}

async function checkedHandoff(queryFn, draft, source) {
  const current = await fetchSource(queryFn, source.orderId, source.fulfillmentOrderId);
  if (Shopify.changes(source, current).length)
    throw Error("Shopify fulfillment lines changed. Reconcile cartons before dispatch.");
  return Shopify.manifest(draft, current);
}

module.exports = { fetchSource, checkedHandoff };
