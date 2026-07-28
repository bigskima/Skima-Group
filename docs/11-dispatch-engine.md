# Dispatch Engine

Dispatch must match capability, availability, capacity, priority, and policy configuration.

Implemented:

- dispatch request, candidate, assignment records
- manual candidate and assignment RPCs
- `dispatch_service_request` selects eligible available approved drivers using configured dispatch
  policy capability requirements
- selected candidates produce `dispatch_candidates` and immutable dispatch request events
- module versions can bind `dispatch_policy` components

Required remediation:

- tests for no eligible drivers, selected candidate, idempotency, and assignment receipts
- remote E2E proof through the full service request lifecycle
