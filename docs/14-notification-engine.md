# Notification Engine

Notification messages are queued records with provider adapter references.

Implemented:

- notification templates
- queued messages
- status events
- sandbox notification adapter execution through `runtime-worker`
- provider execution logs for delivery attempts
- authenticated queue API route

Required remediation:

- retry and dead-letter handling
- tests for queued, sent, delivered, failed, retry, and dead-letter states
