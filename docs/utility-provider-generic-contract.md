# SKIMA utility provider generic contract

SKIMA utility billing is provider-neutral. Customer apps use SKIMA's canonical utility API; provider selection and provider-specific HTTP details stay on the server.

## Adding a new provider without an app deployment

1. Add the provider API key to Supabase Edge Function secrets.
2. In Admin → Utility billing → Providers, create a provider and enter only the secret **name**, never the secret value.
3. Enter the provider HTTPS API base URL.
4. Use the simple endpoint fields when the provider accepts SKIMA's canonical field names, or use **Advanced API contract** to map the provider's own field names.
5. Test the API connection.
6. Sync a provider catalogue when the provider has a compatible catalogue endpoint, or curate products manually.
7. Configure route economics and protected profit.
8. Run a small real-money vend.
9. Activate the provider and the product routes.

Changing or adding a provider does not require a mobile-app release. Flutterwave remains an optional built-in compatibility adapter; new ordinary REST providers use `generic-http-v1`.

## Canonical runtime fields

The generic runtime exposes these values to request templates:

- `{{billerCode}}`
- `{{itemCode}}`
- `{{customerIdentifier}}`
- `{{amount}}`
- `{{reference}}`
- `{{callbackUrl}}`
- provider defaults configured in the contract
- `{{credential:primary}}` and additional named credentials

Credential values are resolved from `SUPABASE_SECRET:NAME` references inside Edge Functions. They are not stored in the database or sent to the client.

## Example contract

```json
{
  "version": "1",
  "auth": {
    "bindings": [
      {
        "target": "header",
        "name": "api-key",
        "value": "{{credential:primary}}"
      }
    ]
  },
  "operations": {
    "test": {
      "method": "GET",
      "path": "balance"
    },
    "catalog": {
      "method": "GET",
      "path": "services",
      "response": {
        "arrayPath": "data",
        "mapping": {
          "categoryName": "category",
          "billerName": "network",
          "productCode": "variation_code",
          "productName": "name",
          "amount": "amount"
        }
      }
    },
    "validate": {
      "method": "POST",
      "path": "validate",
      "body": {
        "serviceID": "{{billerCode}}",
        "variation_code": "{{itemCode}}",
        "billersCode": "{{customerIdentifier}}"
      }
    },
    "purchase": {
      "method": "POST",
      "path": "pay",
      "body": {
        "request_id": "{{reference}}",
        "serviceID": "{{billerCode}}",
        "variation_code": "{{itemCode}}",
        "billersCode": "{{customerIdentifier}}",
        "amount": "{{amount}}"
      },
      "response": {
        "statusPath": "content.transactions.status",
        "providerReferencePath": "requestId"
      }
    },
    "status": {
      "method": "POST",
      "path": "requery",
      "body": {
        "request_id": "{{reference}}"
      },
      "response": {
        "statusPath": "content.transactions.status"
      }
    }
  }
}
```

## Authentication

The generic runtime supports:

- Bearer token
- API-key header
- API-key query parameter
- Basic authentication
- Multiple custom header/query credential bindings

Extra credentials can be referenced with a contract `credentialRefs` object whose values use `SUPABASE_SECRET:NAME`.

## Webhooks

A provider webhook is optional. When configured, SKIMA supports provider-specific reference paths and these verification schemes:

- `flutterwave-hmac-or-verif-hash` for the existing Flutterwave compatibility adapter
- `header-secret`
- `bearer`
- `hmac-sha256-base64`
- `hmac-sha256-hex`

Provider callback data never settles a utility payment by itself. A valid webhook only wakes reconciliation; SKIMA then queries the provider's configured status endpoint and uses that result as authoritative.

## Safety constraints

- Provider API base URLs must use public HTTPS hosts.
- Redirects are rejected.
- Request timeouts are bounded.
- Response size is bounded.
- Unsafe HTTP header names are rejected.
- Financial routes remain inactive until credentials, provider connectivity, economics and a successful live vend are verified.
