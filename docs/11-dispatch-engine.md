# Dispatch Engine

Dispatch must match capability, availability, capacity, priority, and policy configuration.

Implemented:

- dispatch request, candidate, assignment records
- manual candidate and assignment RPCs
- `dispatch_service_request` selects eligible available approved drivers with active approved
  driver-vehicle links
- dispatch policies can define separate `driver_required_capabilities` and
  `vehicle_required_capabilities`
- selected candidates produce `dispatch_candidates` and immutable dispatch request events
- module versions can bind `dispatch_policy` components
- hosted driver/vehicle onboarding gate proves unapproved drivers are excluded and approved
  driver/vehicle capability pairs become dispatch eligible

Remaining hardening:

- broader dispatch tests for distance, priority, capacity limits, zones, manual override, and
  provider-assisted suggestions
- dispatch assignment receipts across more module policies
