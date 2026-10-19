import type {
  IAuthenticateGeneric,
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class TypefoldApi implements ICredentialType {
  name = "typefoldApi";

  displayName = "Typefold API";

  icon: Icon = { light: "file:typefold.svg", dark: "file:typefold.dark.svg" };

  documentationUrl = "https://typefold.dev/integrations/n8n/#connect-n8n";

  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      required: true,
      default: "",
      description: "A workspace API key, created in Studio under Manage → API keys",
    },
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      required: true,
      default: "https://app.typefold.dev",
      description:
        "Where Typefold answers. Keep the default for the hosted service; for your own installation, enter the address you open Studio at.",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        "x-api-key": "={{$credentials.apiKey}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
      url: "/v1/reports",
    },
  };
}
