const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { test } = require("node:test");
const { NodeApiError } = require("n8n-workflow");
const { verifySignature } = require("../dist/nodes/Typefold/GenericFunctions");
const { Typefold } = require("../dist/nodes/Typefold/Typefold.node");
const { TypefoldTrigger } = require("../dist/nodes/TypefoldTrigger/TypefoldTrigger.node");

const SECRET = `whsec_${Buffer.from("a-test-signing-key").toString("base64")}`;
const ROTATED = `whsec_${Buffer.from("rotated-key").toString("base64")}`;
const WEBHOOK_URL = "https://n8n.example.com/webhook/abc/webhook";

function sign(id, timestamp, body, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");

  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/** A context whose HTTP requests are answered by `respond(request)` as `{ statusCode, body }`. */
function context({ parameters = {}, staticData = {}, respond, items = [{ json: {} }] }) {
  const requests = [];
  const node = { name: "Typefold", type: "@typefold/n8n-nodes-typefold.typefold" };
  const request = async (options) => {
    requests.push(options);

    return respond(options);
  };

  return {
    requests,
    staticData,
    getNode: () => node,
    getInputData: () => items,
    getNodeParameter: (name, _index, fallback) =>
      name in parameters ? parameters[name] : fallback,
    getCredentials: async () => ({ apiKey: "key", baseUrl: "https://typefold.test/" }),
    getWorkflowStaticData: () => staticData,
    getNodeWebhookUrl: () => WEBHOOK_URL,
    getWorkflow: () => ({ id: "1", name: "Invoices" }),
    continueOnFail: () => false,
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, options) => await request(options),
      httpRequest: async (options) => (await request(options)).body,
      prepareBinaryData: async (data, fileName, mimeType) => ({ data, fileName, mimeType }),
      returnJsonArray: (value) => [{ json: value }],
    },
  };
}

test("verifySignature accepts a delivery signed with the secret", () => {
  const body = '{"id":"e1"}';
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = {
    "webhook-id": "msg_1",
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,bm9wZQ== ${sign("msg_1", timestamp, body)}`,
  };

  assert.equal(verifySignature(SECRET, headers, Buffer.from(body)), true);
  assert.equal(verifySignature(SECRET, headers, Buffer.from('{"id":"e2"}')), false);
  assert.equal(
    verifySignature(`whsec_${Buffer.from("other").toString("base64")}`, headers, Buffer.from(body)),
    false,
  );
});

test("verifySignature rejects old timestamps and missing headers", () => {
  const body = "{}";
  const timestamp = Math.floor(Date.now() / 1000) - 301;
  const headers = {
    "webhook-id": "msg_1",
    "webhook-timestamp": String(timestamp),
    "webhook-signature": sign("msg_1", timestamp, body),
  };

  assert.equal(verifySignature(SECRET, headers, Buffer.from(body)), false);
  assert.equal(verifySignature(SECRET, {}, Buffer.from(body)), false);
});

test("Render Report sends the template by name and returns the file", async () => {
  const ctx = context({
    parameters: {
      operation: "renderReport",
      template: { mode: "name", value: "Invoices/Invoice" },
      format: "pdf",
      data: '{"total": 5}',
      options: { test: true, watermarkText: "COPY" },
    },
    respond: () => ({ statusCode: 200, body: new TextEncoder().encode("%PDF").buffer }),
  });

  const [[item]] = await new Typefold().execute.call(ctx);

  assert.equal(ctx.requests[0].url, "https://typefold.test/v1/reports/render");
  assert.deepEqual(ctx.requests[0].body, {
    format: "pdf",
    template: { name: "Invoices/Invoice" },
    data: { total: 5 },
    test: true,
    pdf: { watermark: { text: "COPY" } },
  });
  assert.equal(item.binary.data.fileName, "Invoice.pdf");
  assert.equal(item.binary.data.mimeType, "application/pdf");
  assert.equal(item.binary.data.data.toString(), "%PDF");
});

test("API errors carry the API message, also for file responses", async () => {
  const body = Buffer.from(
    JSON.stringify({ error: { code: "NOT_FOUND", message: "No such report.", retryable: false } }),
  );
  const ctx = context({
    parameters: {
      operation: "renderReport",
      template: { mode: "id", value: "x" },
      format: "pdf",
      data: "{}",
    },
    respond: () => ({ statusCode: 404, body }),
  });

  await assert.rejects(new Typefold().execute.call(ctx), (error) => {
    assert.ok(error instanceof NodeApiError);
    assert.equal(error.message, "No such report.");
    assert.equal(error.httpCode, "404");

    return true;
  });
});

test("Start Render renders the published version of a template found by name", async () => {
  const ctx = context({
    parameters: {
      operation: "startRender",
      source: "template",
      template: { mode: "name", value: "invoice" },
      data: { total: 5 },
      options: { waitSeconds: 2 },
    },
    respond: ({ url, method }) => {
      if (url.endsWith("/v1/reports")) {
        return { statusCode: 200, body: { items: [{ id: "t1", name: "Invoice" }] } };
      }

      if (url.endsWith("/v1/templates/t1")) {
        return { statusCode: 200, body: { name: "Invoice", publishedVersionId: "v1" } };
      }

      assert.equal(method, "POST");

      return { statusCode: 202, body: { id: "r1", state: "queued" } };
    },
  });

  const [[item]] = await new Typefold().execute.call(ctx);

  assert.deepEqual(ctx.requests[2].body, {
    templateVersionId: "v1",
    data: { total: 5 },
    waitMs: 2000,
  });
  assert.deepEqual(item.json, { id: "r1", state: "queued" });
});

test("Get Render downloads a succeeded render without the API key", async () => {
  const ctx = context({
    parameters: { operation: "getRender", renderId: "r1", download: true, options: {} },
    respond: ({ url }) =>
      url === "https://storage.test/r1.pdf"
        ? { statusCode: 200, body: new TextEncoder().encode("%PDF").buffer }
        : {
            statusCode: 200,
            body: {
              id: "r1",
              state: "succeeded",
              result: { downloadUrl: "https://storage.test/r1.pdf" },
            },
          },
  });

  const [[item]] = await new Typefold().execute.call(ctx);

  assert.equal(item.binary.data.fileName, "r1.pdf");
  assert.equal(ctx.requests[1].url, "https://storage.test/r1.pdf");
});

test("the trigger registers, replaces and deletes its endpoint", async () => {
  const endpoints = new Map();
  const respond = ({ method, url, body }) => {
    const [id, action] = url.split("/v1/webhook-endpoints/")[1]?.split("/") ?? [];

    if (method === "POST" && !id) {
      const endpoint = { id: `e${endpoints.size + 1}`, ...body, enabled: true };

      endpoints.set(endpoint.id, endpoint);

      return { statusCode: 201, body: { ...endpoint, secret: SECRET } };
    }

    if (!endpoints.has(id)) {
      return { statusCode: 404, body: { error: { code: "NOT_FOUND", message: "Not found." } } };
    }

    if (action === "rotate-secret") {
      return { statusCode: 200, body: { ...endpoints.get(id), secret: ROTATED } };
    }

    if (method === "DELETE") {
      endpoints.delete(id);

      return { statusCode: 200, body: { id, deleted: true } };
    }

    return { statusCode: 200, body: endpoints.get(id) };
  };
  const parameters = { events: ["render.succeeded"] };
  const ctx = context({ parameters, respond });
  const hooks = new TypefoldTrigger().webhookMethods.default;

  assert.equal(await hooks.checkExists.call(ctx), false);
  assert.equal(await hooks.create.call(ctx), true);
  assert.deepEqual(ctx.staticData, { endpointId: "e1", secret: SECRET });
  assert.deepEqual(endpoints.get("e1").eventTypes, ["render.succeeded"]);
  assert.equal(endpoints.get("e1").url, WEBHOOK_URL);
  // An unchanged endpoint gets a fresh secret, in case it was rotated in Studio.
  assert.equal(await hooks.checkExists.call(ctx), true);
  assert.equal(ctx.staticData.secret, ROTATED);

  // Changed events replace the endpoint.
  parameters.events = ["render.failed", "render.succeeded"];
  assert.equal(await hooks.checkExists.call(ctx), false);
  assert.equal(endpoints.size, 0);

  await hooks.create.call(ctx);
  assert.equal(await hooks.delete.call(ctx), true);
  assert.equal(endpoints.size, 0);
  assert.deepEqual(ctx.staticData, {});

  // An endpoint deleted elsewhere is recreated rather than failing.
  ctx.staticData.endpointId = "gone";
  assert.equal(await hooks.checkExists.call(ctx), false);
  assert.equal(await hooks.delete.call(ctx), true);
});

test("the trigger runs only for signed deliveries", async () => {
  const body = JSON.stringify({ id: "ev1", type: "render.succeeded", data: { renderId: "r1" } });
  const timestamp = Math.floor(Date.now() / 1000);
  let status;
  const webhookContext = (signature) => ({
    ...context({ staticData: { endpointId: "e1", secret: SECRET }, respond: () => undefined }),
    getRequestObject: () => ({ rawBody: Buffer.from(body) }),
    getHeaderData: () => ({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signature,
    }),
    getBodyData: () => JSON.parse(body),
    getResponseObject: () => ({
      status(code) {
        status = code;

        return this;
      },
      send() {
        return this;
      },
      end() {},
    }),
  });
  const trigger = new TypefoldTrigger();

  const accepted = await trigger.webhook.call(webhookContext(sign("msg_1", timestamp, body)));
  assert.equal(accepted.workflowData[0][0].json.data.renderId, "r1");

  const rejected = await trigger.webhook.call(webhookContext("v1,Zm9yZ2Vk"));
  assert.deepEqual(rejected, { noWebhookResponse: true });
  assert.equal(status, 401);
});
