# Admin App

The admin app will be created after the backend platform foundation is production-ready.

Milestone 1 only defines the reusable backend foundation and production gate.

When admin authentication starts, use `packages/auth` with only `SUPABASE_URL` and
`SUPABASE_ANON_KEY`. Platform-admin privileges are assigned to real Supabase Auth users through the
server-side bootstrap command.
