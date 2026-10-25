import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";
import { typefoldRequest, verifySignature } from "../Typefold/GenericFunctions";

interface EndpointData {
  endpointId?: string;
  secret?: string;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
}

export class TypefoldTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Typefold Trigger",
    name: "typefoldTrigger",
    icon: { light: "file:typefold.svg", dark: "file:typefold.dark.svg" },
    group: ["trigger"],
    version: [1],
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: "Starts the workflow when a Typefold render finishes",
    defaults: {
      name: "Typefold Trigger",
    },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "typefoldApi",
        required: true,
      },
    ],
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "webhook",
      },
    ],
    properties: [
      {
        displayName: "Events",
        name: "events",
        type: "multiOptions",
        required: true,
        options: [
          {
            name: "Render Cancelled",
            value: "render.cancelled",
            description: "A render was cancelled before it finished",
          },
          {
            name: "Render Failed",
            value: "render.failed",
            description: "A render failed for good, after its retries",
          },
          {
            name: "Render Succeeded",
            value: "render.succeeded",
            description: "A render finished and its file is ready to download",
          },
        ],
        default: ["render.succeeded"],
        description: "The render outcomes that start the workflow",
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData("node") as EndpointData;

        if (!staticData.endpointId) {
          return false;
        }

        const endpoint = (await typefoldRequest.call(
          this,
          "GET",
          `/v1/webhook-endpoints/${staticData.endpointId}`,
          {},
          { allowNotFound: true },
        )) as WebhookEndpoint | undefined;

        if (!endpoint) {
          // Deleted in Studio or through the API: register a new one.
          delete staticData.endpointId;
          delete staticData.secret;

          return false;
        }

        const events = (this.getNodeParameter("events") as string[]).slice().sort();
        const current =
          endpoint.enabled &&
          new URL(endpoint.url).href === new URL(this.getNodeWebhookUrl("default")!).href &&
          endpoint.eventTypes.slice().sort().join() === events.join();

        if (!current) {
          // The workflow's URL or events changed: replace the endpoint.
          await deleteEndpoint.call(this, staticData);

          return false;
        }

        // The secret may have been rotated in Studio since; the old one stays valid for 24 hours.
        const rotated = (await typefoldRequest.call(
          this,
          "POST",
          `/v1/webhook-endpoints/${endpoint.id}/rotate-secret`,
        )) as { secret: string };

        staticData.secret = rotated.secret;

        return true;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData("node") as EndpointData;
        const endpoint = (await typefoldRequest.call(this, "POST", "/v1/webhook-endpoints", {
          body: {
            url: this.getNodeWebhookUrl("default"),
            description: `n8n: ${this.getWorkflow().name ?? this.getWorkflow().id}`.slice(0, 256),
            eventTypes: this.getNodeParameter("events") as string[],
          },
        })) as WebhookEndpoint & { secret: string };

        staticData.endpointId = endpoint.id;
        staticData.secret = endpoint.secret;

        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        await deleteEndpoint.call(this, this.getWorkflowStaticData("node") as EndpointData);

        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const { secret } = this.getWorkflowStaticData("node") as EndpointData;
    const request = this.getRequestObject();

    if (!request.rawBody) {
      await request.readRawBody();
    }

    if (!secret || !verifySignature(secret, this.getHeaderData() as IDataObject, request.rawBody)) {
      this.getResponseObject().status(401).send("Invalid signature").end();

      return { noWebhookResponse: true };
    }

    return { workflowData: [this.helpers.returnJsonArray(this.getBodyData())] };
  }
}

/** Deletes the workflow's endpoint; one already deleted elsewhere counts as deleted. */
async function deleteEndpoint(this: IHookFunctions, staticData: EndpointData): Promise<void> {
  if (staticData.endpointId) {
    await typefoldRequest.call(
      this,
      "DELETE",
      `/v1/webhook-endpoints/${staticData.endpointId}`,
      {},
      { allowNotFound: true },
    );
  }

  delete staticData.endpointId;
  delete staticData.secret;
}
