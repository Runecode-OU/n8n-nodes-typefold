# @typefold/n8n-nodes-typefold

[n8n](https://n8n.io) nodes for [Typefold](https://typefold.dev): render your published templates
to PDF, XLSX or PNG, JPEG and WebP images inside a workflow, and start a workflow when a render finishes.

## Install

In n8n, open **Settings → Community nodes**, select **Install** and enter `@typefold/n8n-nodes-typefold`.
See n8n's [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Nodes

- **Typefold**
  - **Render Report** renders a published template with your data and returns the PDF, XLSX or image file.
  - **Start Render** starts a PDF or image render of a template or your own HTML and returns its ID.
  - **Get Render** reads a render and attaches its file once it succeeded.
- **Typefold Trigger** starts a workflow when a render succeeds, fails or is cancelled. It registers
  its webhook with Typefold when the workflow is activated and checks every request's signature.

## Credentials

Create an API key in Studio under **Manage → API keys**, then add a **Typefold API** credential in
n8n with the key. Keep the base URL `https://app.typefold.dev` for the hosted service, or enter the
address of your own installation.

The [n8n guide](https://typefold.dev/integrations/n8n/) lists the permissions each operation needs.

## License

[MIT](LICENSE.md)

## Releasing

Set `version` in `package.json`, merge to `main`, then push a tag with the same version, such as
`0.1.1`. The Publish workflow lints, builds and publishes to npm with provenance.
