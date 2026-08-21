# Production UX Language Audit

Scope: remove developer-facing wording from all Skima LPG customer, driver, station, and admin surfaces.

Rules:
- Keep technical identifiers internally only.
- Never expose database terms, RPC names, API/provider terminology, permission names, JSON configuration names, or engineering concepts to users.
- Convert all messages into business language.

Examples:

Internal: payout provider
User: bank account

Internal: wallet debit
User: amount deducted

Internal: provider transfer amount
User: amount sent to your bank

Internal: configuration key
User: setting

Internal: RPC/API error
User: service temporarily unavailable

This audit applies to apps/lpg-mobile, apps/admin, and shared UI components.
