# AI Orchestration

AI assists but does not control platform state.

Implemented:

- AI task definitions
- queued AI task runs
- status events
- sandbox AI worker execution through `runtime-worker`
- provider execution logs for AI adapter calls
- output marked assist-only

Required remediation:

- configured prompt/input/output validation
- proof that AI output is advisory and state changes still require workflow or policy action
