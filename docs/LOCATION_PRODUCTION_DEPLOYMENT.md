# Universal Location Production Deployment and Rollback

This runbook is mandatory for releases containing geography, canonical location, service coverage,
operational coverage, live tracking, or dispatch-location changes. Never run destructive database
rollback scripts against production. Schema changes are rolled forward; traffic and authority are
rolled back through the controls described below.

## Required access and evidence

- A named release owner and database operator.
- A verified, restorable production database backup.
- The exact Git commit, migration list, API function bundle, Admin bundle, and web/Android/iOS app
  versions recorded in the release ticket.
- Staging on the same PostgreSQL/PostGIS major versions as production.
- Service-role access held only by the deployment system; never place it in a client build.

## Pre-deployment gate

1. Run repository type checks, unit tests, builds, migration-history validation, and SQL integration
   tests.
2. Apply all pending migrations to a restored production-like staging database in timestamp order.
3. Exercise country, parent/child, exclusion, re-enable, radius, custom-zone, boundary-edge, and
   arbitrary-geography scenarios.
4. Verify RLS with customer, driver, station, coverage-reader, coverage-manager, tracking-admin, and
   service-role identities.
5. Invoke `read_location_platform_production_readiness()`.
6. Stop the release if `ready` is false. Attach the returned metrics and alerts to the release ticket.
7. Review warnings explicitly. A warning may be accepted only with an owner, reason, and follow-up.

## Deployment order

1. Announce the change window and pause geography/policy editing.
2. Take and verify the production backup and record its recovery point.
3. Apply database migrations transactionally in timestamp order.
4. Invoke `read_location_platform_production_readiness()` again. Do not continue on a blocker.
5. Deploy the runtime worker and verify the location-retention queue remains queued or running.
6. Deploy the API gateway and run authenticated canonical-location, serviceability, and dispatch
   smoke checks.
7. Deploy the Admin application and verify geography, preview, map, diagnostic, audit, draft recovery,
   and readiness views.
8. Deploy the web client, then submit Android and iOS builds using the same API contract version.
9. Re-enable Admin writes and monitor health, policy conflicts, stale drivers, unmapped coordinates,
   dispatch snapshots, retention failures, and API errors for the full observation window.

## Smoke checks

- A coordinate inside an ALLOW policy resolves available.
- A child DENY overrides its parent and a more-specific ALLOW re-enables its configured boundary.
- An exact boundary point uses the documented inclusive `ST_Covers` strategy.
- Requested coverage does not grant eligibility; approved administrative, radius, and custom coverage
  do grant eligibility at matching points.
- A neighboring-town driver can rank above a same-town driver when both are covered and the former is
  operationally closer.
- Final order creation revalidates serviceability and creates immutable pickup/delivery snapshots.
- Dispatch creates immutable policy, coverage, point, distance, and candidate snapshots.
- Customers cannot list live drivers; drivers cannot edit approved coverage; unauthorized Admin roles
  cannot activate policies.

## Rollback and containment

### Client or Admin defect

1. Stop the affected rollout or restore the previously approved web/Admin artifact.
2. Keep database migrations applied unless the database operator approves a tested forward repair.
3. Disable the affected navigation/action through existing permission or configuration controls.

### API or worker defect

1. Restore the previous API or worker function artifact.
2. Pause the `platform.location_retention` queue if cleanup behavior is in doubt.
3. Preserve failed jobs and dead letters; do not delete operational evidence.
4. Apply a new forward migration/function fix before resuming processing.

### Coverage or geography configuration defect

1. Pause or retire the affected policy/assignment using the governed Admin RPC and a reason.
2. Do not delete geography, policy, assignment, draft, audit, order, or dispatch evidence.
3. Re-run point diagnostics and production readiness before reactivation.

### Database migration failure

1. If the current migration transaction failed, confirm PostgreSQL rolled it back and stop.
2. If committed migrations succeeded but application rollout failed, retain the schema and restore the
   previous compatible application artifacts.
3. Restore the database backup only for confirmed unrecoverable corruption, under incident command,
   after recording the recovery-point and data-loss window.
4. Prefer a reviewed forward migration for every ordinary schema or data correction.

## Completion evidence

The release is complete only when production readiness is true, smoke checks pass, retention health is
healthy, no unexplained policy conflict exists, and the release ticket contains artifacts, commands,
results, approvals, observation notes, and any accepted warnings.
