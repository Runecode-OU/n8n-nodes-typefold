import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { searchTemplates, typefoldRequest } from "./GenericFunctions";

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const IMAGE_FORMATS = ["png", "jpeg", "webp"];

interface TemplateLocator {
  mode: string;
  value: string;
  cachedResultName?: string;
}

interface Render {
  id: string;
  state: string;
  result?: { downloadUrl?: string; mediaType?: string };
}

export class Typefold implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Typefold",
    name: "typefold",
    icon: { light: "file:typefold.svg", dark: "file:typefold.dark.svg" },
    group: ["output"],
    version: [1],
    subtitle: '={{$parameter["operation"]}}',
    description: "Render reports and templates to PDF, XLSX or images with Typefold",
    defaults: {
      name: "Typefold",
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [
      {
        name: "typefoldApi",
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Get Render",
            value: "getRender",
            description: "Read a render and optionally download its file",
            action: "Get a render",
          },
          {
            name: "Render Report",
            value: "renderReport",
            description: "Render a published template and return the PDF, XLSX or image file",
            action: "Render a report",
          },
          {
            name: "Start Render",
            value: "startRender",
            description: "Start a render in the background and return its ID and state",
            action: "Start a render",
          },
        ],
        default: "renderReport",
      },

      // Render Report and Start Render
      {
        displayName: "Source",
        name: "source",
        type: "options",
        options: [
          { name: "Template", value: "template" },
          { name: "HTML", value: "html" },
        ],
        default: "template",
        description: "Whether to render a published template or your own HTML",
        displayOptions: { show: { operation: ["startRender"] } },
      },
      {
        displayName: "Template",
        name: "template",
        type: "resourceLocator",
        default: { mode: "list", value: "" },
        required: true,
        description: "The published template to render",
        modes: [
          {
            displayName: "From List",
            name: "list",
            type: "list",
            typeOptions: { searchListMethod: "searchTemplates", searchable: true },
          },
          {
            displayName: "By Name",
            name: "name",
            type: "string",
            placeholder: "e.g. Invoice",
          },
          {
            displayName: "By ID",
            name: "id",
            type: "string",
            placeholder: "e.g. 3f0c2a5e-8b1d-4c7a-9e2f-6a1b2c3d4e5f",
          },
        ],
        displayOptions: {
          show: { operation: ["renderReport", "startRender"] },
          hide: { source: ["html"] },
        },
      },
      {
        displayName: "Format",
        name: "format",
        type: "options",
        options: [
          { name: "JPEG Image", value: "jpeg" },
          { name: "PDF", value: "pdf" },
          { name: "PNG Image", value: "png" },
          { name: "WebP Image", value: "webp" },
          { name: "XLSX", value: "xlsx" },
        ],
        default: "pdf",
        description:
          "The file to render. An image shows one page of the PDF; XLSX needs a template with a spreadsheet.",
        displayOptions: { show: { operation: ["renderReport"] } },
      },
      {
        displayName: "Format",
        name: "format",
        type: "options",
        options: [
          { name: "JPEG Image", value: "jpeg" },
          { name: "PDF", value: "pdf" },
          { name: "PNG Image", value: "png" },
          { name: "WebP Image", value: "webp" },
        ],
        default: "pdf",
        description: "The file to render. An image shows one page of the PDF.",
        displayOptions: { show: { operation: ["startRender"] } },
      },
      {
        displayName: "Data",
        name: "data",
        type: "json",
        default: "{}",
        description: "The data the template renders, as JSON",
        displayOptions: {
          show: { operation: ["renderReport", "startRender"] },
          hide: { source: ["html"] },
        },
      },
      {
        displayName: "HTML",
        name: "html",
        type: "string",
        typeOptions: { rows: 6 },
        default: "",
        required: true,
        placeholder: "<h1>Hello</h1>",
        description: "The HTML document to render, with its CSS in a style element",
        displayOptions: { show: { operation: ["startRender"], source: ["html"] } },
      },

      // Get Render
      {
        displayName: "Render ID",
        name: "renderId",
        type: "string",
        default: "",
        required: true,
        description: "The ID Start Render or the Typefold Trigger returned",
        displayOptions: { show: { operation: ["getRender"] } },
      },
      {
        displayName: "Download File",
        name: "download",
        type: "boolean",
        default: true,
        description:
          "Whether to attach the PDF or image when the render succeeded. Other renders, and renders that kept no copy in Typefold, return only their state.",
        displayOptions: { show: { operation: ["getRender"] } },
      },

      {
        displayName: "Options",
        name: "options",
        type: "collection",
        placeholder: "Add Option",
        default: {},
        displayOptions: { show: { operation: ["renderReport", "startRender", "getRender"] } },
        options: [
          {
            displayName: "Content Set",
            name: "contentSet",
            type: "string",
            default: "",
            placeholder: "e.g. Acme",
            description:
              "The name of one of the template's content sets, such as a customer's, to fill its content fields with. Without it, the template's own content is used.",
            displayOptions: {
              show: { "/operation": ["renderReport", "startRender"] },
              hide: { "/source": ["html"] },
            },
          },
          {
            displayName: "Destination Name",
            name: "destinationName",
            type: "string",
            default: "",
            placeholder: "e.g. invoices",
            description:
              "The storage destination to upload the file to, as named under Manage → Storage destinations in Studio",
            displayOptions: { show: { "/operation": ["startRender"] } },
          },
          {
            displayName: "Destination Path",
            name: "destinationPath",
            type: "string",
            default: "",
            placeholder: "e.g. 2026/{renderId}.pdf",
            description:
              "The file's path in the destination; {renderId} is replaced with the render's ID. Defaults to the render's ID and the file's extension.",
            displayOptions: { show: { "/operation": ["startRender"] } },
          },
          {
            displayName: "File Name",
            name: "fileName",
            type: "string",
            default: "",
            description: "The output file's name. Defaults to the template's name.",
            displayOptions: { show: { "/operation": ["renderReport", "getRender"] } },
          },
          {
            displayName: "Image Page",
            name: "imagePage",
            type: "number",
            typeOptions: { minValue: 1 },
            default: 1,
            description: "The page an image shows, from 1. Images only.",
            displayOptions: { show: { "/operation": ["renderReport", "startRender"] } },
          },
          {
            displayName: "Image Width",
            name: "imageWidth",
            type: "number",
            typeOptions: { minValue: 16, maxValue: 4096 },
            default: 800,
            description:
              "The image's width in pixels, from 16 to 4096; the height follows the page's shape. Without it, the image is as wide as the page. Images only.",
            displayOptions: { show: { "/operation": ["renderReport", "startRender"] } },
          },
          {
            displayName: "JPEG Quality",
            name: "jpegQuality",
            type: "number",
            typeOptions: { minValue: 1, maxValue: 100 },
            default: 90,
            description: "The JPEG image's quality, from 1 to 100. JPEG only.",
            displayOptions: { show: { "/operation": ["renderReport", "startRender"] } },
          },
          {
            displayName: "Keep Copy in Typefold",
            name: "keepCopy",
            type: "boolean",
            default: true,
            description:
              "Whether Typefold also keeps the file for download when it uploads it to a destination",
            displayOptions: { show: { "/operation": ["startRender"] } },
          },
          {
            displayName: "Locale",
            name: "locale",
            type: "string",
            default: "en-US",
            description: "The language and region for numbers, dates and translations",
            displayOptions: { show: { "/operation": ["renderReport"] } },
          },
          {
            displayName: "Put Output File in Field",
            name: "binaryPropertyName",
            type: "string",
            default: "data",
            description: "The name of the output field that holds the file",
            displayOptions: { show: { "/operation": ["renderReport", "getRender"] } },
          },
          {
            displayName: "Test Render",
            name: "test",
            type: "boolean",
            default: false,
            description:
              'Whether to render a free test document with a "TEST" watermark on every page. Test renders do not count against your plan. PDF and images only.',
            displayOptions: { show: { "/operation": ["renderReport", "startRender"] } },
          },
          {
            displayName: "Wait (Seconds)",
            name: "waitSeconds",
            type: "number",
            typeOptions: { minValue: 0, maxValue: 10 },
            default: 0,
            description:
              "How long to wait for the render to finish before returning, up to 10 seconds",
            displayOptions: { show: { "/operation": ["startRender"] } },
          },
          {
            displayName: "Watermark Text",
            name: "watermarkText",
            type: "string",
            default: "",
            placeholder: "e.g. COPY",
            description:
              "One line of text drawn across every page, such as COPY or DRAFT. PDF and images only; Latin, Greek or Cyrillic letters.",
            displayOptions: { show: { "/operation": ["renderReport", "startRender"] } },
          },
        ],
      },
    ],
  };

  methods = {
    listSearch: { searchTemplates },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter("operation", i) as string;
        const options = this.getNodeParameter("options", i, {}) as IDataObject;

        if (operation === "renderReport") {
          returnData.push(await renderReport.call(this, i, options));
        } else if (operation === "startRender") {
          returnData.push(await startRender.call(this, i, options));
        } else {
          returnData.push(await getRender.call(this, i, options));
        }
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }

        // Both constructors hand back an error of their own class as it is, without the index.
        if (error instanceof NodeApiError || error instanceof NodeOperationError) {
          error.context.itemIndex = i;
        }

        if (error instanceof NodeOperationError) {
          throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
        }

        throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
      }
    }

    return [returnData];
  }
}

async function renderReport(
  this: IExecuteFunctions,
  i: number,
  options: IDataObject,
): Promise<INodeExecutionData> {
  const template = this.getNodeParameter("template", i, undefined, {
    extractValue: false,
  }) as TemplateLocator;
  const format = this.getNodeParameter("format", i) as string;
  const body: IDataObject = {
    format,
    template: template.mode === "name" ? { name: template.value } : { id: template.value },
    data: parseData.call(this, i),
  };

  if (options.locale) {
    body.locale = options.locale;
  }

  addContentSet(body, options);

  if (options.test && format !== "xlsx") {
    body.test = true;
  }

  if (options.watermarkText && format !== "xlsx") {
    body.pdf = { watermark: { text: options.watermarkText } };
  }

  addImageOptions(body, format, options);

  const file = (await typefoldRequest.call(this, "POST", "/v1/reports/render", {
    body,
    encoding: "arraybuffer",
    json: false,
    headers: { "content-type": "application/json" },
  })) as ArrayBuffer;
  const fileName = `${(options.fileName as string) || templateName(template)}.${format}`;
  const binaryPropertyName = (options.binaryPropertyName as string) || "data";

  return {
    json: { template: template.value, format, test: body.test === true },
    binary: {
      [binaryPropertyName]: await this.helpers.prepareBinaryData(
        Buffer.from(file),
        fileName,
        MIME_TYPES[format],
      ),
    },
    pairedItem: { item: i },
  };
}

async function startRender(
  this: IExecuteFunctions,
  i: number,
  options: IDataObject,
): Promise<INodeExecutionData> {
  const source = this.getNodeParameter("source", i) as string;
  const body: IDataObject =
    source === "html"
      ? {
          document: { kind: "html", html: this.getNodeParameter("html", i) as string },
          settings: {
            pageSize: { widthMm: 210, heightMm: 297 },
            margins: { topMm: 10, rightMm: 10, bottomMm: 10, leftMm: 10 },
          },
        }
      : {
          templateVersionId: await publishedVersionId.call(this, i),
          data: parseData.call(this, i),
        };

  if (source !== "html") {
    addContentSet(body, options);
  }

  if (options.test) {
    body.test = true;
  }

  if (options.watermarkText) {
    body.watermark = { text: options.watermarkText };
  }

  if (options.destinationName) {
    body.destination = {
      name: options.destinationName,
      ...(options.destinationPath ? { path: options.destinationPath } : {}),
      ...(options.keepCopy === false ? { keepCopy: false } : {}),
    };
  }

  const format = this.getNodeParameter("format", i, "pdf") as string;

  if (format !== "pdf") {
    body.format = format;
  }

  addImageOptions(body, format, options);

  if (options.waitSeconds) {
    body.waitMs = Math.round((options.waitSeconds as number) * 1000);
  }

  const render = (await typefoldRequest.call(this, "POST", "/v1/renders", { body })) as IDataObject;

  return { json: render, pairedItem: { item: i } };
}

async function getRender(
  this: IExecuteFunctions,
  i: number,
  options: IDataObject,
): Promise<INodeExecutionData> {
  const id = (this.getNodeParameter("renderId", i) as string).trim();
  const render = (await typefoldRequest.call(
    this,
    "GET",
    `/v1/renders/${encodeURIComponent(id)}`,
  )) as Render;

  if (!this.getNodeParameter("download", i) || render.state !== "succeeded" || !render.result?.downloadUrl) {
    return { json: render as unknown as IDataObject, pairedItem: { item: i } };
  }

  // The signed URL may point at object storage, so the API key is not sent.
  const file = (await this.helpers.httpRequest({
    url: render.result.downloadUrl,
    encoding: "arraybuffer",
  })) as ArrayBuffer;
  const binaryPropertyName = (options.binaryPropertyName as string) || "data";
  const mimeType = render.result.mediaType ?? MIME_TYPES.pdf;
  const extension =
    Object.keys(MIME_TYPES).find((format) => MIME_TYPES[format] === mimeType) ?? "pdf";

  return {
    json: render as unknown as IDataObject,
    binary: {
      [binaryPropertyName]: await this.helpers.prepareBinaryData(
        Buffer.from(file),
        `${(options.fileName as string) || render.id}.${extension}`,
        mimeType,
      ),
    },
    pairedItem: { item: i },
  };
}

/** The template's current published version, which `POST /v1/renders` renders. */
async function publishedVersionId(this: IExecuteFunctions, i: number): Promise<string> {
  const template = this.getNodeParameter("template", i, undefined, {
    extractValue: false,
  }) as TemplateLocator;
  let id = template.value;

  if (template.mode === "name") {
    const { items } = (await typefoldRequest.call(this, "GET", "/v1/reports")) as {
      items: Array<{ id: string; name: string }>;
    };
    const match = items.find((item) => item.name.toLowerCase() === id.toLowerCase());

    if (!match) {
      throw new NodeOperationError(this.getNode(), `No template is named "${id}".`, {
        itemIndex: i,
      });
    }

    id = match.id;
  }

  const found = (await typefoldRequest.call(
    this,
    "GET",
    `/v1/templates/${encodeURIComponent(id)}`,
  )) as { name: string; publishedVersionId?: string };

  if (!found.publishedVersionId) {
    throw new NodeOperationError(
      this.getNode(),
      `The template "${found.name}" has not been published.`,
      { itemIndex: i, description: "Publish it in Studio, then run the node again." },
    );
  }

  return found.publishedVersionId;
}

/** Picks one of the template's content sets by name, when the option is filled in. */
function addContentSet(body: IDataObject, options: IDataObject): void {
  const name = typeof options.contentSet === "string" ? options.contentSet.trim() : "";

  if (name) {
    body.contentSet = name;
  }
}

/** Adds the page, width and quality an image format uses; other formats take none. */
function addImageOptions(body: IDataObject, format: string, options: IDataObject): void {
  if (!IMAGE_FORMATS.includes(format)) {
    return;
  }

  const image: IDataObject = {};

  if (options.imagePage) {
    image.page = options.imagePage;
  }

  if (options.imageWidth) {
    image.width = options.imageWidth;
  }

  if (options.jpegQuality && format === "jpeg") {
    image.quality = options.jpegQuality;
  }

  if (Object.keys(image).length > 0) {
    body.image = image;
  }
}

function parseData(this: IExecuteFunctions, i: number): IDataObject {
  const data = this.getNodeParameter("data", i, "{}");

  if (typeof data !== "string") {
    return data as IDataObject;
  }

  try {
    return JSON.parse(data || "{}") as IDataObject;
  } catch {
    throw new NodeOperationError(this.getNode(), "Data is not valid JSON.", { itemIndex: i });
  }
}

/** A file name for the template's output, without characters file systems refuse. */
function templateName(template: TemplateLocator): string {
  const name =
    template.mode === "id" ? template.value : template.cachedResultName || template.value;

  return (
    name
      .split("/")
      .pop()!
      .replace(/[\\:*?"<>|]/g, "_") || "report"
  );
}
