# @typefold/n8n-nodes-typefold

[n8n](https://n8n.io) nodes for [Typefold](https://typefold.dev): render your published templates
to PDF, XLSX or PNG, JPEG and WebP images inside a workflow, and start a workflow when a render finishes.

## Install

In n8n, open **Settings → Community nodes**, select **Install** and enter `@typefold/n8n-nodes-typefold`.
See n8n's [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Nodes

- **Typefold**
  - **Render Report** renders a published template with your data and returns the PDF, XLSX or image file.
  - **Start Render** starts a PDF or image render of a template or your own HTML, optionally uploaded to a storage destination, and returns its ID.
  - **Get Render** reads a render and attaches its file once it succeeded.
- **Typefold Trigger** starts a workflow when a render succeeds, fails or is cancelled. It registers
  its webhook with Typefold when the workflow is activated and checks every request's signature.

## Credentials

The nodes sign in with a Typefold API key, sent in the `x-api-key` header.

1. In Typefold Studio, open **Developers → API keys** and create a key with `template:read` and the
   permissions of the operations you use:

   | Operation        | Permissions                    |
   | ---------------- | ------------------------------ |
   | Render Report    | `render:create`, `render:read` |
   | Start Render     | `render:create`                |
   | Get Render       | `render:read`                  |
   | Typefold Trigger | `webhook:manage`               |

2. In n8n, create a **Typefold API** credential and paste the key into **API Key**.
3. Keep **Base URL** as `https://app.typefold.dev` for the hosted service, or enter the address of
   your own installation.
4. Select **Save**. n8n tests the key and shows whether it works.

## Usage

### Render an invoice and email it

1. Add a **Typefold** node with the **Render Report** operation.
2. Pick the **Template** from the list, or enter its name or ID.
3. Set **Format** to **PDF**, and **Data** to the template's data, such as `{{ $json }}` from an
   earlier node.
4. Add a **Send Email** or **Gmail** node and attach the `data` field.

Turn on the **Test Render** option while you build the workflow: test renders carry a "TEST"
watermark and do not count against your plan.

### Render in the background

1. In one workflow, add a **Typefold** node with **Start Render**. It returns the render's `id`.
2. In a second workflow, start with a **Typefold Trigger** set to **Render Succeeded**.
3. After it, add a **Typefold** node with **Get Render** and set **Render ID** to
   `{{ $json.data.renderId }}`. The file is in the item's `data` field.

Typefold must be able to reach your n8n from the internet for the trigger to work.

### Example workflow

[render-invoice.json](https://github.com/Runecode-OU/n8n-nodes-typefold/blob/main/examples/render-invoice.json) renders an invoice from sample data.
In n8n, open a new workflow, select **⋯ → Import from File**, pick the file, choose your Typefold
credential on the **Typefold** node and change the template name to one of yours.

The [n8n guide](https://docs.typefold.dev/integrations/n8n/) covers every option.

## License

[MIT](LICENSE.md)

## Releasing

Set `version` in `package.json`, merge to `main`, then push a tag with the same version, such as
`0.1.1`. The Publish workflow lints, builds and publishes to npm with provenance.
