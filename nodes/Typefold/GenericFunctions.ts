import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  IDataObject,
  IExecuteFunctions,
  IHookFunctions,
  IHttpRequestMethods,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  INodeListSearchResult,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError } from "n8n-workflow";

type TypefoldContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

/** Report PDFs can take up to 95 seconds, so requests wait a little longer than that. */
const REQUEST_TIMEOUT_MS = 120_000;

/** How far a delivery's timestamp may be from this clock before it is rejected as a replay. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export async function typefoldBaseUrl(this: TypefoldContext): Promise<string> {
  const credentials = await this.getCredentials<{ baseUrl: string }>("typefoldApi");

  return credentials.baseUrl.replace(/\/+$/, "");
}

/**
 * Sends an authenticated request to the Typefold API and returns the response body. An error
 * response throws with the API's own message and code, also when the body was read as a file;
 * with `allowNotFound`, a 404 returns `undefined` instead.
 */
export async function typefoldRequest(
  this: TypefoldContext,
  method: IHttpRequestMethods,
  path: string,
  options: Partial<IHttpRequestOptions> = {},
  { allowNotFound = false } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = (await this.helpers.httpRequestWithAuthentication.call(this, "typefoldApi", {
    method,
    url: `${await typefoldBaseUrl.call(this)}${path}`,
    json: true,
    timeout: REQUEST_TIMEOUT_MS,
    ...options,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  })) as { statusCode: number; body: unknown };

  if (response.statusCode < 400) {
    return response.body;
  }

  if (allowNotFound && response.statusCode === 404) {
    return undefined;
  }

  const error = apiError(response.body);

  throw new NodeApiError(this.getNode(), (error ?? {}) as JsonObject, {
    httpCode: String(response.statusCode),
    message: error?.message ?? `Typefold answered HTTP ${response.statusCode}.`,
    description: error?.code,
  });
}

/** The `error` object of an API error body, read as JSON, text or bytes. */
function apiError(body: unknown): { code: string; message: string } | undefined {
  let parsed = body;

  if (body instanceof ArrayBuffer || Buffer.isBuffer(body)) {
    parsed = Buffer.from(body as ArrayBuffer).toString("utf8");
  }

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }

  return (parsed as { error?: { code: string; message: string } } | null)?.error;
}

/** Lists the workspace's templates for a template picker, filtered by name. */
export async function searchTemplates(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const { items } = (await typefoldRequest.call(this, "GET", "/v1/reports")) as {
    items: Array<{ id: string; name: string; published: boolean; folderPath?: string }>;
  };
  const search = filter?.toLowerCase();

  return {
    results: items
      .filter((item) => item.published)
      .filter((item) => !search || item.name.toLowerCase().includes(search))
      .map((item) => ({
        name: item.folderPath ? `${item.folderPath}/${item.name}` : item.name,
        value: item.id,
      })),
  };
}

/**
 * True when `body` was signed with `secret` (a `whsec_…` value) within the last five minutes,
 * following the Standard Webhooks scheme Typefold signs deliveries with.
 */
export function verifySignature(
  secret: string,
  headers: IDataObject,
  body: Buffer,
  now = Date.now(),
): boolean {
  const id = headers["webhook-id"];
  const timestamp = Number(headers["webhook-timestamp"]);
  const signatures = headers["webhook-signature"];

  if (typeof id !== "string" || !Number.isInteger(timestamp) || typeof signatures !== "string") {
    return false;
  }

  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]);
  const expected = Buffer.from(`v1,${createHmac("sha256", key).update(signed).digest("base64")}`);

  return signatures.split(" ").some((signature) => {
    const actual = Buffer.from(signature);

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
