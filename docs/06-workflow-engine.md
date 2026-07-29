# Workflow Engine

Workflow definitions, versions, states, and transitions are database records.

Implemented:

- `start_workflow_instance`
- `advance_workflow_instance`
- `start_service_request_workflow`
- `process_service_request_event`
- `workflow.application.review.default` for reusable application review states and transitions
- `advance_application_record_state` for applicant, reviewer, admin, and system-scoped application
  transitions
- `workflow.order.processing.default` for reusable order receiving, acceptance, preparation,
  fulfilment, completion, cancellation, failure, dispute, timeout, and reassignment states
- `process_order_action` for workflow-checked order transitions through configured order action
  definitions
- immutable `workflow_instance_events`
- authenticated runtime routes for starting and advancing service request workflows
- authenticated application routes for submit, reviewer assignment, correction request, review
  decision, and withdrawal
- order funding, commission release, and business settlement are executed by finance RPCs after
  workflow/order state has been established by configured actions and events

Remaining hardening:

- broader tests proving invalid order cancellation, rejection, dispute, timeout, and reassignment
  transitions are rejected or accepted only when configured
