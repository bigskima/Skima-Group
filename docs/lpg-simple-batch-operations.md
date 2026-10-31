# LPG simple batch operations

## Purpose

Reduce driver and station taps while preserving the existing LPG order lifecycle, cylinder identity, custody events, safety inspection, refill pricing, payment reservation, settlement and audit trail.

This is an operational presentation and scan-resolution layer. It does not create a second order ledger or bypass the existing order-level RPCs.

## Driver workflow

1. Driver accepts each assigned job using the existing assignment workflow.
2. Open the Scan tab once and keep the camera active.
3. Scan the five-character Cylinder ID, existing QR/barcode payload, or active physical tag. The backend matches only exact registered credentials against the signed-in driver's active assigned orders.
4. For ordinary marketplace orders, a successful customer pickup scan starts the existing pickup and station-transit actions. The driver does not scan again at station arrival: the station scans the incoming cylinder when it physically receives it.
5. For SKIMA Internal orders, the supplier-arrival scan remains available because the internal supplier refill flow has its own receipt, safety, purchase and settlement requirements.
6. At return, the existing customer delivery challenge must still be verified before the final cylinder scan can complete delivery.

The scan resolver rejects ambiguous IDs and does not allow a driver to scan an order outside their assignment. A retry with the same idempotency key returns the original scan rather than applying it to the next lifecycle stage.

Station Managed drivers receive the same Scan tab, backed by their existing `read_lpg_station_managed_driver_jobs` assignment RPC.

## Station workflow

1. Incoming orders stay in the station's existing assigned queue.
2. Use Receive cylinders to open the continuous scanner. Scan each arriving cylinder once. The station operator's branch permission and exact order/cylinder match are checked by the existing `record_lpg_cylinder_scan` function.
3. Record one safety outcome per cylinder. Unsafe/rejected/manual-review results remain visible and are not included in the refill worklist.
4. Enter actual kilograms for the safe cylinders and confirm the entered refill batch. The UI calls the existing refill-start and refill-confirmation RPCs one order at a time. Each order independently enforces pump permission, latest safe inspection, requested quantity/overfill tolerance, server-managed price, station capacity and settlement rules.
5. Use Release cylinders to scan each filled cylinder before handover to its assigned driver.

A failure on one order is reported for that order and does not stop the other entered orders. The station batch button never invents quantities, marks a cylinder safe on behalf of another cylinder, or marks an entire batch successful when an individual refill fails.

## Compatibility and safety

- Existing per-order job detail screens and APIs remain available.
- Existing `lpg_cylinder_scans`, `lpg_cylinder_inspections`, `lpg_refill_records`, `lpg_order_events`, cylinder history, payment reservations, wallet ledger and settlement records remain authoritative.
- Legacy cylinder identifiers, five-character IDs, QR/barcode payloads and active physical-tag credentials are matched through exact values or the existing tag-credential hash.
- Customer delivery challenge, physical custody scans and station release verification are retained.
- SKIMA Internal supplier receipt remains distinct from marketplace station receipt.
- The new station queue read model adds latest inspection result for operational queue display; inspection notes are exposed only to station and admin queue responses, not customers or drivers.
- No offline scan is represented as verified until the backend confirms it.

## Rollout

The migration and UI are delivered in a feature branch and PR. Apply the database migration only after the SQL dry run and CI pass. Deploy the API gateway Edge Function and the mobile web build together; the new Scan tab calls the new gateway route.
