# Workflow Engine

Workflow definitions, versions, states, and transitions are database records.

Implemented:

- `start_workflow_instance`
- `advance_workflow_instance`
- `start_service_request_workflow`
- `process_service_request_event`
- immutable `workflow_instance_events`
- authenticated runtime routes for starting and advancing service request workflows

Required remediation:

- end-to-end workflow advancement through module-backed service requests
- tests proving invalid transitions are rejected and valid transitions advance configured state
