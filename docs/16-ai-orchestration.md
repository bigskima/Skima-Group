# AI Orchestration

AI assists but does not control platform state.

Skima is not building an LLM, training a foundation model, or creating a standalone AI reasoning
engine. AI providers supply reasoning, generation, classification, summarization, recommendations,
tool/function calling, and structured JSON generation through adapters.

Initial production target:

- Google Gemini through the official API and `provider.ai.google-gemini`

Future providers remain swappable through provider configuration and secrets.

Implemented:

- AI task definitions
- queued AI task runs
- status events
- sandbox AI worker execution through `runtime-worker`
- provider execution logs for AI adapter calls
- output marked assist-only
- provider catalog/configuration records for Gemini, OpenAI, Anthropic Claude, and sandbox AI

Required remediation:

- live Gemini adapter execution after `GEMINI_API_KEY` is configured as a Supabase secret
- configured prompt/input/output validation
- proof that AI output is advisory and state changes still require workflow or policy action

Business modules must call the AI orchestration layer, not Gemini or any provider directly.
