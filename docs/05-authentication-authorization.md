# Authentication And Authorization

Supabase Auth is the only identity provider.

Client-safe env:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Privileged values must stay in deployment shell, CI secrets, or Supabase secrets.

Admin model:

- one active platform super admin/general manager
- multiple role-based platform admins
- configurable role templates and permissions

Every production gate must include a real super admin session. Service-role-only checks are not
enough for milestone completion.
