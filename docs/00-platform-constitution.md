# Platform Constitution

The governing constitution remains `SKIMA_PLATFORM_CONSTITUTION.md` at the repository root.

This document records the backend-first interpretation used by implementation agents:

- Build backend milestones sequentially toward production.
- Do not start frontend work until backend milestones 1-3 are approved.
- Do not mark a milestone `Complete` because tables, config records, or routes exist.
- Business logic belongs in module configuration, workflow records, policy records, and reusable
  engine execution paths.
- LPG is the first configured module, not a platform-core assumption.

Status values are restricted to:

- Not Started
- In Progress
- Blocked
- Implemented but Untested
- Tested with Failures
- Complete
- Approved
