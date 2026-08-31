# Station Inventory Runtime and Provider Adapter Runbook

This runbook covers the station inventory runtime introduced by:

- `20260829082943_station_inventory_runtime_foundation.sql`
- `20260829143051_station_inventory_operations_runtime.sql`

The LPG module supplies the current station and tank vocabulary. The underlying design remains
source-neutral: manual reports, POS systems, tank telemetry, and future provider adapters all feed
the same observation, event, state, reservation, capacity, reconciliation, and alert model.

## Runtime invariants

- Installed tank capacity is a physical limit, not current stock.
- Operational processing capacity is a throughput limit, not current stock.
- Stock is changed only by an accepted observation or an auditable inventory event.
- Reservations reduce dispatchable stock without rewriting measured stock.
- Every write is branch-scoped, permission-checked, idempotent where retries are expected, and
  recorded with a source and audit metadata.
- Provider payloads are normalized to non-negative kilograms before they enter the runtime.
- Stale, unhealthy, conflicting, or unmapped data degrades confidence and can block dispatch; it
  must never be silently presented as reliable stock.
- Manual fallback is time-limited and auditable. It does not erase provider history.
- Provider credentials never belong in the database, adapter JSON, client bundle, logs, or Git.

## Data flow

```text
manual report / POS polling / signed webhook / tank telemetry
                              |
                              v
                 normalized inventory observation
                              |
                              v
                 append-only event and reconciliation
                              |
                              v
       station state + per-tank state + confidence/freshness
                              |
          reservations ------+------ operational capacity
                              |
                              v
                 dispatch availability/read models
                              |
                              v
           station app + Admin + alerts + audit history
```

The authoritative write and read surfaces are database functions. Clients use the API Gateway and
read models rather than writing runtime tables directly. Realtime invalidation refreshes station and
Admin screens; periodic query refresh remains the recovery path when a Realtime event is missed.

Important runtime records include:

- `station_inventory_configurations`: source selection, fallback, limits, and configuration version.
- `station_lpg_tanks`: installed tanks and usable capacity.
- `station_inventory_provider_connections`: provider identity, method, health, and secret reference.
- `station_inventory_telemetry_devices`: provider-device-to-tank mapping and normalization version.
- `station_inventory_observations`: normalized measurements and ingestion disposition.
- `station_inventory_events`: append-only adjustments, transfers, source changes, and controls.
- `station_lpg_inventory_state` and `station_lpg_tank_inventory_state`: current derived state.
- `station_inventory_reservations`: stock held for active work.
- `station_inventory_operational_capacity`: concurrent and rate-based processing limits.
- `station_inventory_reconciliation_cases`: discrepancies requiring review.
- `station_inventory_alert_states`: deduplicated operational alerts.
- `station_inventory_provider_webhook_receipts`: signed-webhook replay and outcome evidence.

## Provider-neutral adapter contract

An inventory adapter is an active `provider_adapters` record with `provider_kind = 'inventory'`.
Its configuration declares an `inventory_source_type` of `pos` or `telemetry`, a connection method,
capabilities, operator-facing requirements, and either a polling or webhook contract. Do not add
provider names or provider-specific branches to the worker, API Gateway, or database engine.

The provider connection lifecycle is:

1. Register the adapter catalog record and its non-secret mapping configuration.
2. Create a branch-scoped provider connection. It remains pending.
3. Put each credential in Supabase Edge Function secrets.
4. Bind only a reference such as `SUPABASE_SECRET:SKIMA_INVENTORY_PROVIDER_API_KEY` to the
   connection through the backend-only binding operation.
5. Map each telemetry device to one station tank when the provider has multiple devices.
6. Activate and verify the connection with a real normalized observation.

Although the database reserves other secret-reference namespaces, the current worker and inventory
webhook resolve only `SUPABASE_SECRET:<NAME>`. Use that namespace until another secret-store adapter
is implemented.

### Polling contract

The adapter's `polling` configuration supports:

```json
{
  "url": "https://provider.example/inventory",
  "method": "GET",
  "timeoutMs": 10000,
  "query": { "site": "configured-non-secret-reference" },
  "headers": [
    { "name": "X-Provider-Version", "value": "configured-version" },
    { "name": "X-Secondary-Key", "secretRef": "SUPABASE_SECRET:SKIMA_INVENTORY_PROVIDER_SECONDARY_KEY" }
  ],
  "authentication": {
    "type": "bearer",
    "prefix": "Bearer"
  },
  "requestBody": {},
  "responseMapping": {
    "stockKgPath": "data.stockKg",
    "observedAtPath": "data.observedAt",
    "eventReferencePath": "data.eventId",
    "providerSequencePath": "data.sequence",
    "providerDeviceReferencePath": "data.deviceId",
    "rawValuePath": "data.reading",
    "rawUnitPath": "data.unit"
  }
}
```

Only `stockKgPath` is mandatory. The remaining response paths are optional. Paths are dot-separated;
an array element uses its numeric index. The runtime accepts only JSON responses of at most 1 MB.

Polling restrictions are deliberate:

- URL must be public HTTPS on the default HTTPS port; embedded credentials, redirects, localhost,
  link-local, and private network ranges are rejected.
- Method must be `GET` or `POST`; timeout is constrained to 1-30 seconds.
- Query values must be scalar. A POST body must be configured, never assembled from executable code.
- Authentication is `bearer` or a configured header. Secret-looking headers must use a secret
  reference instead of a literal value.
- A provider device reference must resolve to a mapped device. With no reference, automatic mapping
  is allowed only when the connection has exactly one device.
- Provider event references and idempotency keys prevent duplicate ingestion. Sequence and timestamp
  checks prevent stale or reordered readings from silently replacing newer state.

### Webhook contract

The adapter's `webhook` configuration supports:

```json
{
  "signatureHeader": "X-Provider-Signature",
  "timestampHeader": "X-Provider-Timestamp",
  "signaturePayload": "timestamp.raw",
  "signaturePrefix": "sha256=",
  "maximumSkewSeconds": 300,
  "eventIdHeader": "X-Provider-Event-Id",
  "signingSecretRef": "SUPABASE_SECRET:SKIMA_INVENTORY_PROVIDER_WEBHOOK_SECRET",
  "responseMapping": {
    "stockKgPath": "data.stockKg",
    "observedAtPath": "data.observedAt",
    "eventReferencePath": "data.eventId",
    "providerSequencePath": "data.sequence",
    "providerDeviceReferencePath": "data.deviceId",
    "rawValuePath": "data.reading",
    "rawUnitPath": "data.unit"
  }
}
```

The provider sends `POST` JSON to:

```text
https://<project-ref>.supabase.co/functions/v1/inventory-provider-webhook/<CONNECTION_PUBLIC_REFERENCE>
```

It may send the connection reference in `X-Skima-Inventory-Connection` instead of the final path
segment. The signature is lowercase hexadecimal HMAC-SHA256 over either the raw body or
`<timestamp>.<raw-body>`, as selected by `signaturePayload`. The timestamp window is constrained to
30-900 seconds, the body limit is 1 MB, and signatures are compared in constant time.

The webhook stores hashes and sanitized outcome metadata, not raw credentials. Rate limiting,
timestamp validation, event references, payload digests, and durable receipts provide replay and
duplicate protection. A rejected or failed webhook updates provider health but cannot prevent the
station application from opening.

## Secret setup

Use a different high-entropy value per environment. Required or conditional custom secrets are:

- `SKIMA_WORKER_SECRET`: required by the API Gateway and runtime worker.
- One provider API credential for each polling connection, for example
  `SKIMA_INVENTORY_PROVIDER_API_KEY`.
- One webhook signing secret for each webhook connection, for example
  `SKIMA_INVENTORY_PROVIDER_WEBHOOK_SECRET`.
- Any additional secret-backed provider headers declared by an adapter.

The example provider names above are naming patterns, not fixed platform keys. The name after
`SUPABASE_SECRET:` in the database must exactly match the Edge Function secret name.

Prefer loading values from a password manager or CI secret store into the process environment. The
following PowerShell commands do not place literal secret values in shell history:

```powershell
$env:SUPABASE_PROJECT_REF = "<project-ref>"

# Load these variables from the operator's password manager or CI secret store first.
supabase secrets set `
  "SKIMA_WORKER_SECRET=$env:SKIMA_WORKER_SECRET" `
  "SKIMA_INVENTORY_PROVIDER_API_KEY=$env:SKIMA_INVENTORY_PROVIDER_API_KEY" `
  "SKIMA_INVENTORY_PROVIDER_WEBHOOK_SECRET=$env:SKIMA_INVENTORY_PROVIDER_WEBHOOK_SECRET" `
  --project-ref $env:SUPABASE_PROJECT_REF

supabase secrets list --project-ref $env:SUPABASE_PROJECT_REF
```

When environment injection is unavailable, create a temporary `.env.supabase.inventory` file with
an approved secret editor. `.env.*` is ignored by this repository. Do not commit or paste its
contents into logs, tickets, chat, screenshots, or command history.

```dotenv
SKIMA_WORKER_SECRET=<generated-high-entropy-secret>
SKIMA_INVENTORY_PROVIDER_API_KEY=<provider-issued-secret>
SKIMA_INVENTORY_PROVIDER_WEBHOOK_SECRET=<provider-issued-signing-secret>
```

```powershell
supabase secrets set --env-file .env.supabase.inventory --project-ref "<project-ref>"
supabase secrets list --project-ref "<project-ref>"
```

Delete the temporary file after upload or keep it only in an approved encrypted operator store.
Secret changes become available to hosted Edge Functions without redeploying them. Rotate a provider
secret by setting its existing name again, exercising a signed or polling observation, and recording
the rotation in the release evidence before retiring the old provider credential.

Do not manually set or copy these Supabase-managed function variables:

- `SUPABASE_URL`
- `SUPABASE_DB_URL`
- `SUPABASE_PUBLISHABLE_KEYS`
- `SUPABASE_SECRET_KEYS`
- `SUPABASE_JWKS`
- legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`

Hosted Supabase injects and maintains them. `SUPABASE_SERVICE_ROLE_KEY` is privileged and must never
appear in a browser/mobile environment or provider configuration. `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD` are operator/CI deployment credentials, not Edge Function secrets.

## Deployment

Before production, verify the target project and review the migration plan. Never reset a linked
production database.

```powershell
supabase --version
supabase login
$env:SUPABASE_PROJECT_REF = "<project-ref>"
npm run supabase:link
supabase db push --linked --dry-run
npm run migration-history:verify
npm run supabase:db:push
```

Deploy exactly these Edge Functions for the inventory runtime:

```powershell
supabase functions deploy api-gateway --project-ref $env:SUPABASE_PROJECT_REF --use-api
supabase functions deploy runtime-worker --project-ref $env:SUPABASE_PROJECT_REF --use-api --no-verify-jwt
supabase functions deploy inventory-provider-webhook --project-ref $env:SUPABASE_PROJECT_REF --use-api --no-verify-jwt
```

`api-gateway` requires JWT verification. `runtime-worker` uses `SKIMA_WORKER_SECRET`, and the public
provider ingress validates its own configured HMAC signature, so those two functions are deployed
without the platform JWT gate. Do not remove their application-level authentication checks.

The repository helper, `npm run supabase:functions:deploy`, includes all three inventory runtime
functions. The explicit commands above remain useful when intentionally deploying only this runtime.

## Release verification

Run repository checks before applying remote changes:

```powershell
npm run frontend:check
npm run frontend:test
npm run frontend:build
npm run lpg-mobile:check
npm run lpg-mobile:test
npm run lpg-mobile:build
npm run migration-history:verify
npx -y deno check supabase/functions/api-gateway/index.ts supabase/functions/runtime-worker/index.ts supabase/functions/inventory-provider-webhook/index.ts
git diff --check
```

After deployment:

1. Confirm both inventory migrations appear in the linked migration history.
2. Run `npm run supabase:remote:status` and `npm run supabase:remote:gate`.
3. Invoke the runtime worker once with the worker secret and confirm the maintenance job completes and
   schedules its successor without duplicate active leases.
4. Create one test station configuration and at least two tanks; confirm capacity and stock remain
   separate in both station and Admin read models.
5. Report, confirm, adjust, and transfer manual stock; retry each idempotency key and confirm no
   duplicate stock change.
6. Reserve and release stock; confirm measured stock remains unchanged while dispatchable stock and
   reservations change.
7. Exercise one polling adapter and one signed webhook. Confirm duplicate events are accepted as
   duplicates, not applied twice.
8. Exercise stale, future, reordered, unmapped-device, invalid-signature, oversized-body, and rate
   limit failures. Confirm they fail safely and leave audit/health evidence.
9. Force a source disagreement and unexpected stockout. Confirm dispatch blocks and a reconciliation
   case/alert appears without inventing a new stock value.
10. Confirm station staff see only their branch, unrelated station users are denied, permitted Admin
    users can review, and every override requires a reason and is audited.
11. Confirm Realtime refreshes station and Admin views and that ordinary polling/cache fallback still
    works when Realtime or the network is unavailable.

Record the Git SHA, migration versions, function deployment IDs/times, sanitized command results,
adapter and secret-reference names, and smoke-test evidence. Never record secret values or raw signed
payloads.

## Failure containment

- Provider outage: allow health/backoff policy to act; use a bounded manual fallback only when an
  authorized operator records the reason. Do not mark an unhealthy provider healthy manually.
- Bad observation: preserve it and open/resolve reconciliation. Apply a reasoned adjustment or Admin
  override; never delete the ledger evidence.
- Worker failure: preserve queued, leased, failed, and dead-letter jobs. Repair forward, then retry;
  do not bulk-mark unknown work completed.
- Webhook attack or signing failure: disconnect the provider connection, rotate its secret, retain
  receipt hashes, and verify the new signature before reactivation.
- Client defect: roll back the client artifact while leaving successful database migrations in
  place. Database schema is repaired forward except under an approved disaster-recovery procedure.

The release is complete only when database migrations, all three functions, authenticated branch and
Admin flows, provider ingestion, worker maintenance, RLS isolation, and production smoke checks pass.
