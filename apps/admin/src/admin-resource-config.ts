import type {
  AdminActionDefinition,
  AdminActionField,
  AdminResourceConsoleConfig,
  AdminResourceDefinition,
} from "./admin-resource-console";

const activeStatusOptions = [
  { label: "Active", value: "active" },
  { label: "Draft", value: "draft" },
  { label: "Paused", value: "paused" },
  { label: "Suspended", value: "suspended" },
  { label: "Inactive", value: "inactive" },
] as const;

const communicationChannelOptions = [
  { label: "In-App", value: "in_app" },
  { label: "Email", value: "email" },
  { label: "SMS", value: "sms" },
  { label: "WhatsApp", value: "whatsapp" },
] as const;

const providerOptions = [
  { label: "Sandbox", value: "provider.payment.sandbox" },
  { label: "Paystack", value: "provider.payment.paystack" },
] as const;

const transferStatusOptions = [
  { label: "Successful", value: "success" },
  { label: "Failed", value: "failed" },
  { label: "Reversed", value: "reversed" },
] as const;

const requiredText = (key: string, label: string, helperText?: string): AdminActionField => ({
  key,
  label,
  helperText,
  required: true,
});

const optionalText = (key: string, label: string, helperText?: string): AdminActionField => ({
  key,
  label,
  helperText,
});

const requiredNumber = (key: string, label: string, helperText?: string): AdminActionField => ({
  key,
  label,
  helperText,
  required: true,
  type: "number",
});

const optionalNumber = (key: string, label: string, helperText?: string): AdminActionField => ({
  key,
  label,
  helperText,
  type: "number",
});

const requiredJson = (
  key: string,
  label: string,
  defaultValue: unknown,
  helperText = "Use a valid JSON value.",
): AdminActionField => ({
  key,
  label,
  defaultValue,
  helperText,
  required: true,
  type: "json",
});

const optionalJson = (
  key = "metadata",
  label = "Metadata",
  defaultValue: unknown = {},
): AdminActionField => ({
  key,
  label,
  defaultValue,
  helperText: "Optional JSON object.",
  type: "json",
});

const optionalStringArray = (
  key: string,
  label: string,
  defaultValue: readonly string[] = [],
): AdminActionField => ({
  key,
  label,
  defaultValue,
  helperText: "Use comma-separated values or a JSON array.",
  type: "stringArray",
});

const requiredStringArray = (
  key: string,
  label: string,
  defaultValue: readonly string[] = [],
): AdminActionField => ({
  key,
  label,
  defaultValue,
  helperText: "Use comma-separated values or a JSON array.",
  required: true,
  type: "stringArray",
});

const statusSelect = (
  key = "status",
  label = "Status",
  options: AdminActionField["options"] = activeStatusOptions,
): AdminActionField => ({
  key,
  label,
  defaultValue: options[0]?.value ?? "",
  options,
  type: "select",
});

const optionalStatusSelect = (
  key = "status",
  label = "Status",
  options: AdminActionField["options"] = activeStatusOptions,
): AdminActionField => ({
  key,
  label,
  options,
  type: "select",
});

const financialPolicyFamilyOptions = [
  { label: "Pricing", value: "pricing" },
  { label: "Commission", value: "commission" },
  { label: "Driver payout", value: "payout" },
  { label: "Settlement", value: "settlement" },
  { label: "Withdrawal fee", value: "withdrawal_fee" },
  { label: "Payment fee", value: "payment_fee" },
  { label: "Refund", value: "refund" },
  { label: "Adjustment", value: "adjustment" },
  { label: "Cancellation", value: "cancellation" },
  { label: "Discount", value: "discount" },
  { label: "Referral", value: "referral" },
  { label: "Affiliate", value: "affiliate" },
  { label: "Marketplace fee", value: "marketplace_fee" },
  { label: "Service fee", value: "service_fee" },
  { label: "Pricing guardrail", value: "pricing_guardrail" },
  { label: "Promotion", value: "promotion" },
] as const;

const financialGeographyOptions = [
  { label: "Global", value: "global" },
  { label: "Country", value: "country" },
  { label: "Region / state", value: "region" },
  { label: "City", value: "city" },
  { label: "Service area", value: "service_area" },
  { label: "Organization", value: "organization" },
  { label: "Branch", value: "branch" },
] as const;

const action = (
  key: string,
  label: string,
  path: string,
  fields: readonly AdminActionField[],
  requiredPermission?: string,
  tone?: AdminActionDefinition["tone"],
): AdminActionDefinition => ({
  key,
  label,
  path,
  fields,
  requiredPermission,
  tone,
});

const resource = (
  key: string,
  title: string,
  path: string,
  preferredKeys: readonly string[],
  description?: string,
): AdminResourceDefinition => ({
  key,
  title,
  path,
  preferredKeys,
  description,
});

export const governanceConsoleConfig: AdminResourceConsoleConfig = {
  eyebrow: "Platform setup",
  title: "Configuration",
  description: "Configure service modules, reusable platform behavior, and governed webhooks.",
  groups: [
    {
      key: "access",
      label: "Admin Access",
      description: "Create, adjust, and revoke platform administrator authority.",
      resources: [
        resource("profiles", "User Profiles", "/admin/profiles", [
          "id",
          "display_name",
          "status",
          "created_at",
        ]),
        resource("admin-roles", "Admin Role Templates", "/admin/role-templates", [
          "key",
          "display_name",
          "status",
          "is_system",
        ]),
        resource("admin-users", "Admin Users", "/admin/users", [
          "user_id",
          "admin_kind",
          "title",
          "status",
          "created_at",
        ]),
      ],
      actions: [
        action(
          "set-profile-status",
          "Change Account Status",
          "/admin/profiles/status",
          [
            requiredText("userId", "User ID"),
            statusSelect("status", "New Status", [
              { label: "Active", value: "active" },
              { label: "Disabled", value: "disabled" },
              { label: "Pending", value: "pending" },
            ]),
            requiredText("reason", "Reason"),
            optionalJson(),
          ],
          "platform.users.manage",
          "danger",
        ),
        action(
          "configure-admin-role",
          "Configure Admin Role",
          "/admin/role-templates",
          [
            requiredText("roleKey", "Role Key"),
            requiredText("displayName", "Display Name"),
            optionalText("description", "Description"),
            requiredStringArray("permissionKeys", "Permission Keys"),
            statusSelect(),
            optionalJson(),
          ],
          "platform.configuration.manage",
        ),
        action(
          "configure-admin-user",
          "Add Admin User",
          "/admin/users",
          [
            requiredText("userId", "User ID"),
            requiredText("roleKey", "Role Key"),
            optionalText("title", "Title"),
            optionalJson(),
          ],
          "platform.configuration.manage",
        ),
        action(
          "revoke-admin-user",
          "Revoke Admin User",
          "/admin/users/revoke",
          [requiredText("userId", "User ID")],
          "platform.configuration.manage",
          "danger",
        ),
      ],
    },
    {
      key: "modules",
      label: "Business Lines",
      description: "Configure modules, versions, components, and activation.",
      resources: [
        resource("modules", "Business Lines", "/modules", [
          "key",
          "display_name",
          "status",
          "created_at",
        ]),
        resource("module-versions", "Versions", "/modules/versions", [
          "module_id",
          "version",
          "status",
          "activated_at",
        ]),
        resource("module-components", "Components", "/modules/components", [
          "component_type",
          "component_key",
          "reference_key",
          "status",
        ]),
        resource("module-events", "Events", "/modules/events", [
          "event_type",
          "module_id",
          "created_at",
        ]),
      ],
      actions: [
        action(
          "configure-module",
          "Configure Business Line",
          "/modules",
          [
            requiredText("moduleKey", "Business Line Key"),
            requiredText("displayName", "Display Name"),
            optionalText("description", "Description"),
            optionalStatusSelect(),
            optionalJson(),
          ],
          "platform.configuration.manage",
        ),
        action(
          "configure-module-version",
          "Create Version",
          "/modules/versions",
          [
            requiredText("moduleKey", "Business Line Key"),
            requiredNumber("version", "Version"),
            requiredJson("manifest", "Manifest", {}),
          ],
          "platform.configuration.manage",
        ),
        action(
          "activate-module-version",
          "Activate Version",
          "/modules/versions/activate",
          [requiredText("moduleKey", "Business Line Key"), requiredNumber("version", "Version")],
          "platform.configuration.manage",
        ),
        action(
          "configure-module-component",
          "Configure Component",
          "/modules/components",
          [
            requiredText("moduleVersionId", "Version ID"),
            requiredText("componentType", "Component Type"),
            requiredText("componentKey", "Component Key"),
            optionalText("referenceKey", "Reference Key"),
            {
              key: "isRequired",
              label: "Required",
              defaultValue: true,
              type: "boolean",
            },
            statusSelect(),
            optionalJson("config", "Configuration", {}),
          ],
          "platform.configuration.manage",
        ),
      ],
    },
    {
      key: "webhooks",
      label: "Webhooks",
      description: "Manage outbound webhook subscriptions and delivery processing.",
      resources: [
        resource("webhook-endpoints", "Webhook Endpoints", "/admin/webhook-endpoints", [
          "url",
          "status",
          "event_type_keys",
          "created_at",
        ]),
        resource("webhook-deliveries", "Webhook Deliveries", "/admin/webhook-deliveries", [
          "endpoint_id",
          "status",
          "attempt_count",
          "next_attempt_at",
        ]),
        resource("webhook-attempts", "Delivery Attempts", "/admin/webhook-attempts", [
          "delivery_id",
          "attempt_number",
          "status",
          "response_status",
        ]),
      ],
      actions: [
        action(
          "create-webhook-endpoint",
          "Create Webhook Endpoint",
          "/admin/webhook-endpoints",
          [
            requiredText("url", "HTTPS URL"),
            optionalText("organizationId", "Organization ID"),
            requiredStringArray("eventTypeKeys", "Event Types"),
            requiredText("signingSecretRef", "Signing Secret Reference"),
            statusSelect(),
            optionalJson("deliveryConfig", "Delivery Settings", {}),
          ],
          "platform.providers.manage",
        ),
        action(
          "queue-webhook-delivery",
          "Queue Webhook Delivery",
          "/admin/webhooks/queue",
          [requiredText("eventId", "Event ID")],
          "platform.providers.manage",
        ),
      ],
    },
  ],
};

export const organizationConsoleConfig: AdminResourceConsoleConfig = {
  eyebrow: "Organizations",
  title: "Organizations",
  description:
    "Manage approved businesses, branches, staff, invitations, roles, and access status.",
  groups: [
    {
      key: "branches",
      label: "Branches",
      description: "Create and maintain organization branch records.",
      resources: [
        resource("branches", "Branches", "/runtime/organization-branches", [
          "organization_id",
          "key",
          "display_name",
          "status",
        ]),
      ],
      actions: [
        action(
          "create-branch",
          "Create Branch",
          "/runtime/organization-branches",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("branchKey", "Branch Key"),
            requiredText("displayName", "Display Name"),
            requiredJson("address", "Address", {}),
            optionalJson("geoLocation", "Location", {}),
            statusSelect(),
            optionalJson(),
          ],
          "platform.organizations.manage",
        ),
      ],
    },
    {
      key: "staff",
      label: "Staff",
      description:
        "Invite staff, configure organization roles, suspend access, and transfer ownership.",
      resources: [
        resource("organization-roles", "Organization Roles", "/runtime/organization-roles", [
          "organization_id",
          "key",
          "display_name",
          "status",
        ]),
        resource("memberships", "Memberships", "/runtime/organization-memberships", [
          "organization_id",
          "user_id",
          "membership_type",
          "status",
        ]),
        resource("user-roles", "Assigned Roles", "/runtime/organization-user-roles", [
          "organization_id",
          "user_id",
          "role_id",
          "status",
        ]),
        resource("invitations", "Invitations", "/runtime/organization-invitations", [
          "organization_id",
          "invited_email",
          "membership_type",
          "status",
        ]),
        resource("staff-events", "Staff Events", "/runtime/organization-staff/events", [
          "event_type_key",
          "subject_user_id",
          "from_status",
          "to_status",
        ]),
      ],
      actions: [
        action(
          "configure-organization-role",
          "Configure Staff Role",
          "/runtime/organization-roles",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("roleKey", "Role Key"),
            requiredText("displayName", "Display Name"),
            optionalText("branchId", "Branch ID"),
            optionalText("description", "Description"),
            requiredStringArray("permissionKeys", "Permission Keys"),
            optionalJson(),
          ],
          "platform.organizations.manage",
        ),
        action(
          "invite-staff",
          "Invite Staff",
          "/runtime/organization-invitations",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("invitedEmail", "Email"),
            requiredText("roleKey", "Role Key"),
            optionalText("branchKey", "Branch Key"),
            optionalText("membershipType", "Membership Type"),
            requiredText("expiresAt", "Expires At", "Use an ISO timestamp."),
            optionalJson(),
          ],
          "platform.organizations.manage",
        ),
        action(
          "set-staff-status",
          "Change Staff Status",
          "/runtime/organization-staff/status",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("userId", "User ID"),
            statusSelect("status", "New Status", [
              { label: "Active", value: "active" },
              { label: "Suspended", value: "suspended" },
              { label: "Revoked", value: "revoked" },
            ]),
            requiredText("reason", "Reason"),
            optionalJson(),
          ],
          "platform.organizations.manage",
          "danger",
        ),
        action(
          "transfer-ownership",
          "Transfer Ownership",
          "/runtime/organization-staff/ownership-transfer",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("fromUserId", "Current Owner User ID"),
            requiredText("toUserId", "New Owner User ID"),
            optionalJson(),
          ],
          "platform.organizations.manage",
          "danger",
        ),
      ],
    },
  ],
};

export const catalogConsoleConfig: AdminResourceConsoleConfig = {
  eyebrow: "Offerings",
  title: "Catalog",
  description:
    "Configure reusable product, service, price, media, availability, and stock records.",
  groups: [
    {
      key: "catalog",
      label: "Catalog Records",
      description: "Maintain units, categories, items, variants, prices, media, and availability.",
      resources: [
        resource("units", "Units", "/runtime/catalog/units", [
          "key",
          "display_name",
          "unit_kind",
          "status",
        ]),
        resource("categories", "Categories", "/runtime/catalog/categories", [
          "key",
          "display_name",
          "category_type",
          "status",
        ]),
        resource("items", "Items", "/runtime/catalog/items", [
          "key",
          "display_name",
          "item_type",
          "status",
        ]),
        resource("variants", "Variants", "/runtime/catalog/variants", [
          "item_id",
          "key",
          "display_name",
          "status",
        ]),
        resource("prices", "Prices", "/runtime/catalog/prices", [
          "item_id",
          "currency_code",
          "amount",
          "status",
        ]),
        resource("media", "Media", "/runtime/catalog/media", [
          "item_id",
          "media_asset_id",
          "display_order",
          "status",
        ]),
        resource("availability", "Availability", "/runtime/catalog/availability", [
          "item_id",
          "availability_status",
          "stock_quantity",
          "status",
        ]),
        resource("orderability", "Orderability Checks", "/runtime/catalog/orderability", [
          "item_id",
          "quantity",
          "status",
          "calculated_amount",
        ]),
      ],
      actions: [
        action(
          "configure-unit",
          "Configure Unit",
          "/runtime/catalog/units",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("unitKey", "Unit Key"),
            requiredText("displayName", "Display Name"),
            optionalText("unitKind", "Unit Kind"),
            optionalText("symbol", "Symbol"),
            optionalNumber("decimalPrecision", "Decimal Precision"),
            statusSelect(),
            optionalJson(),
          ],
          "platform.configuration.manage",
        ),
        action(
          "configure-category",
          "Configure Category",
          "/runtime/catalog/categories",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("categoryKey", "Category Key"),
            requiredText("displayName", "Display Name"),
            optionalText("moduleKey", "Business Line Key"),
            optionalText("parentKey", "Parent Key"),
            optionalText("categoryType", "Category Type"),
            optionalText("description", "Description"),
            statusSelect(),
            optionalJson(),
          ],
          "platform.configuration.manage",
        ),
        action(
          "configure-item",
          "Configure Item",
          "/runtime/catalog/items",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("itemKey", "Item Key"),
            requiredText("displayName", "Display Name"),
            requiredText("itemType", "Item Type"),
            optionalText("moduleKey", "Business Line Key"),
            optionalText("branchId", "Branch ID"),
            optionalText("categoryKey", "Category Key"),
            optionalStringArray("fulfillmentMethods", "Fulfillment Methods"),
            optionalNumber("preparationTimeMinutes", "Preparation Time Minutes"),
            optionalNumber("minQuantity", "Minimum Quantity"),
            optionalNumber("maxQuantity", "Maximum Quantity"),
            optionalText("description", "Description"),
            statusSelect("status", "Status", [
              { label: "Draft", value: "draft" },
              { label: "Active", value: "active" },
              { label: "Paused", value: "paused" },
              { label: "Archived", value: "archived" },
            ]),
            optionalJson(),
          ],
          "business.catalog.manage",
        ),
        action(
          "configure-variant",
          "Configure Variant",
          "/runtime/catalog/variants",
          [
            requiredText("itemId", "Item ID"),
            requiredText("variantKey", "Variant Key"),
            requiredText("displayName", "Display Name"),
            optionalText("unitKey", "Unit Key"),
            optionalText("sku", "SKU"),
            optionalNumber("quantityValue", "Quantity Value"),
            statusSelect(),
            optionalJson(),
          ],
          "business.catalog.manage",
        ),
        action(
          "configure-price",
          "Configure Price",
          "/runtime/catalog/prices",
          [
            requiredText("itemId", "Item ID"),
            optionalText("variantId", "Variant ID"),
            requiredNumber("amount", "Amount"),
            optionalNumber("compareAtAmount", "Compare At Amount"),
            optionalText("currencyCode", "Currency Code"),
            optionalText("pricingPolicyKey", "Pricing Policy Key"),
            optionalText("taxBehavior", "Tax Behavior"),
            optionalText("effectiveFrom", "Effective From"),
            optionalText("effectiveUntil", "Effective Until"),
            statusSelect(),
            optionalJson(),
          ],
          "business.catalog.manage",
        ),
        action(
          "attach-media",
          "Attach Media",
          "/runtime/catalog/media",
          [
            requiredText("itemId", "Item ID"),
            requiredText("mediaAssetId", "Media Asset ID"),
            optionalText("variantId", "Variant ID"),
            optionalNumber("displayOrder", "Display Order"),
            statusSelect(),
            optionalJson(),
          ],
          "business.catalog.manage",
        ),
        action(
          "set-availability",
          "Set Availability",
          "/runtime/catalog/availability",
          [
            requiredText("itemId", "Item ID"),
            optionalText("variantId", "Variant ID"),
            optionalText("branchId", "Branch ID"),
            optionalText("availabilityStatus", "Availability Status"),
            optionalNumber("stockQuantity", "Stock Quantity"),
            optionalNumber("reservedQuantity", "Reserved Quantity"),
            optionalNumber("capacityLimit", "Capacity Limit"),
            optionalNumber("capacityUsed", "Capacity Used"),
            optionalText("effectiveFrom", "Effective From"),
            optionalText("effectiveUntil", "Effective Until"),
            optionalJson("schedule", "Schedule", {}),
            statusSelect(),
            optionalJson(),
          ],
          "business.catalog.manage",
        ),
        action(
          "adjust-stock",
          "Adjust Stock",
          "/runtime/catalog/stock-adjustments",
          [
            requiredText("availabilityRuleId", "Availability Rule ID"),
            requiredNumber("deltaQuantity", "Quantity Change"),
            requiredText("reason", "Reason"),
            optionalJson(),
          ],
          "business.catalog.manage",
        ),
        action(
          "check-orderability",
          "Check Orderability",
          "/runtime/catalog/orderability",
          [
            requiredText("itemId", "Item ID"),
            optionalText("variantId", "Variant ID"),
            optionalText("branchId", "Branch ID"),
            requiredNumber("quantity", "Quantity"),
            optionalText("currencyCode", "Currency Code"),
            optionalJson(),
          ],
          "business.catalog.manage",
        ),
      ],
    },
  ],
};

export const operationsConsoleConfig: AdminResourceConsoleConfig = {
  eyebrow: "Live Work",
  title: "Operations",
  description:
    "Run order, workflow, dispatch, tracking, verification, notification, and AI actions.",
  groups: [
    {
      key: "orders",
      label: "Orders",
      description: "Create orders, assign participants, and process configured order actions.",
      resources: [
        resource("orders", "Orders", "/runtime/orders", [
          "status",
          "organization_id",
          "total_amount",
          "created_at",
        ]),
        resource("line-items", "Line Items", "/runtime/orders/line-items", [
          "order_id",
          "quantity",
          "line_amount",
          "fulfillment_status",
        ]),
        resource("assignments", "Assignments", "/runtime/orders/assignments", [
          "order_id",
          "participant_role",
          "entity_type",
          "status",
        ]),
        resource("order-events", "Order Events", "/runtime/orders/events", [
          "event_type_key",
          "from_status",
          "to_status",
          "created_at",
        ]),
        resource("order-actions", "Action Policies", "/runtime/order-actions", [
          "key",
          "display_name",
          "actor_scope",
          "status",
        ]),
        resource(
          "acceptance-policies",
          "Acceptance Policies",
          "/runtime/order-acceptance-policies",
          [
            "key",
            "display_name",
            "acceptance_mode",
            "status",
          ],
        ),
      ],
      actions: [
        action(
          "create-order",
          "Create Order",
          "/runtime/orders",
          [
            requiredText("organizationId", "Organization ID"),
            requiredText("moduleKey", "Business Line Key"),
            requiredJson("lineItems", "Line Items", []),
            optionalText("branchId", "Branch ID"),
            optionalText("acceptancePolicyKey", "Acceptance Policy Key"),
            optionalText("fulfillmentMethod", "Fulfillment Method"),
            optionalText("currencyCode", "Currency Code"),
            optionalJson("orderPayload", "Order Details", {}),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
        action(
          "process-order-action",
          "Process Order Action",
          "/runtime/orders/actions",
          [
            requiredText("orderId", "Order ID"),
            requiredText("actionKey", "Action Key"),
            optionalText("reason", "Reason"),
            optionalJson("payload", "Action Details", {}),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
        action(
          "assign-order-participant",
          "Assign Order Participant",
          "/runtime/orders/assignments",
          [
            requiredText("orderId", "Order ID"),
            requiredText("participantRole", "Participant Role"),
            requiredText("entityType", "Entity Type"),
            requiredText("entityId", "Entity ID"),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
      ],
    },
    {
      key: "requests",
      label: "Requests",
      description:
        "Create service requests, calculate quotes, start workflows, and process events.",
      resources: [
        resource("service-requests", "Service Requests", "/runtime/service-requests", [
          "status",
          "organization_id",
          "workflow_instance_id",
          "created_at",
        ]),
        resource("price-quotes", "Price Quotes", "/runtime/pricing/quotes", [
          "service_request_id",
          "status",
          "total_amount",
          "expires_at",
        ]),
      ],
      actions: [
        action(
          "create-service-request",
          "Create Service Request",
          "/runtime/service-requests",
          [
            requiredText("moduleKey", "Business Line Key"),
            optionalText("organizationId", "Organization ID"),
            requiredJson("requestPayload", "Request Details", {}),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
        action(
          "calculate-price",
          "Calculate Price",
          "/runtime/pricing/quotes",
          [
            requiredText("serviceRequestId", "Service Request ID"),
            requiredText("moduleKey", "Business Line Key"),
            optionalText("pricingPolicyKey", "Pricing Policy Key"),
            optionalText("currencyCode", "Currency Code"),
            optionalJson("pricingContext", "Pricing Context", {}),
          ],
          "platform.financial.manage",
        ),
        action(
          "accept-quote",
          "Accept Quote",
          "/runtime/pricing/quotes/accept",
          [requiredText("priceQuoteId", "Price Quote ID"), optionalJson()],
          "platform.financial.manage",
        ),
        action(
          "start-workflow",
          "Start Workflow",
          "/runtime/workflows/start",
          [
            requiredText("serviceRequestId", "Service Request ID"),
            optionalJson("context", "Context", {}),
          ],
          "platform.events.manage",
        ),
        action(
          "process-event",
          "Process Event",
          "/runtime/events/process",
          [
            requiredText("serviceRequestId", "Service Request ID"),
            requiredText("eventTypeKey", "Event Type"),
            optionalJson("payload", "Event Details", {}),
          ],
          "platform.events.manage",
        ),
        action(
          "assign-participant",
          "Assign Participant",
          "/runtime/participants/assign",
          [
            requiredText("serviceRequestId", "Service Request ID"),
            requiredText("participantRole", "Participant Role"),
            requiredText("entityId", "Entity ID"),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
        action(
          "select-dispatch",
          "Select Dispatch",
          "/runtime/dispatch/select",
          [
            requiredText("serviceRequestId", "Service Request ID"),
            optionalText("dispatchPolicyKey", "Dispatch Policy Key"),
            optionalNumber("candidateLimit", "Candidate Limit"),
          ],
          "platform.events.manage",
        ),
      ],
    },
    {
      key: "field-work",
      label: "Tracking And Verification",
      description: "Record tracking sessions, location points, and verification events.",
      resources: [
        resource("drivers", "Drivers", "/runtime/drivers", [
          "user_id",
          "status",
          "approval_status",
          "created_at",
        ]),
        resource("vehicles", "Vehicles", "/runtime/vehicles", [
          "vehicle_type_key",
          "status",
          "approval_status",
          "created_at",
        ]),
        resource("driver-links", "Driver Vehicle Links", "/runtime/driver-vehicle-links", [
          "driver_id",
          "vehicle_id",
          "status",
          "approval_status",
        ]),
      ],
      actions: [
        action(
          "start-tracking",
          "Start Tracking Session",
          "/runtime/tracking/sessions",
          [
            requiredText("subjectType", "Subject Type"),
            requiredText("subjectId", "Subject ID"),
            optionalText("providerAdapterId", "Provider Adapter ID"),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
        action(
          "record-location",
          "Record Location",
          "/runtime/tracking/points",
          [
            requiredText("trackingSessionId", "Tracking Session ID"),
            requiredNumber("latitude", "Latitude"),
            requiredNumber("longitude", "Longitude"),
            optionalNumber("accuracyMeters", "Accuracy Meters"),
            optionalNumber("speedMetersPerSecond", "Speed"),
            optionalNumber("headingDegrees", "Heading"),
            optionalText("recordedAt", "Recorded At"),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
        action(
          "record-verification",
          "Record Verification",
          "/runtime/verifications",
          [
            requiredText("definitionKey", "Definition Key"),
            requiredText("purpose", "Purpose"),
            requiredText("scannedEntityType", "Scanned Entity Type"),
            optionalText("scannedEntityId", "Scanned Entity ID"),
            optionalText("result", "Result"),
            optionalText("serviceRequestId", "Service Request ID"),
            optionalText("workflowEventTypeKey", "Workflow Event Type"),
            optionalJson("location", "Location", {}),
            optionalJson("payload", "Verification Details", {}),
          ],
          "platform.events.manage",
        ),
        action(
          "queue-notification",
          "Queue Notification",
          "/runtime/notifications/queue",
          [
            requiredText("recipientEntityType", "Recipient Type"),
            optionalText("recipientEntityId", "Recipient ID"),
            optionalText("recipientAddress", "Recipient Address"),
            {
              key: "channel",
              label: "Channel",
              type: "select",
              options: communicationChannelOptions,
              required: true,
            },
            optionalText("templateKey", "Template Key"),
            optionalText("providerAdapterId", "Provider Adapter ID"),
            optionalJson("payload", "Message Details", {}),
          ],
          "platform.events.manage",
        ),
        action(
          "queue-ai-task",
          "Queue AI Task",
          "/runtime/ai/queue",
          [
            requiredText("taskKey", "Task Key"),
            requiredText("subjectType", "Subject Type"),
            optionalText("subjectId", "Subject ID"),
            optionalJson("input", "Input", {}),
          ],
          "platform.events.manage",
        ),
      ],
    },
  ],
};

export const financeConsoleConfig: AdminResourceConsoleConfig = {
  eyebrow: "Money",
  title: "Finance",
  description:
    "Govern company financial policy, then monitor ledger-backed wallets, withdrawals, commissions, and settlement.",
  groups: [
    {
      key: "policy-governance",
      label: "Financial Policy",
      description:
        "Create immutable policy versions, enforce maker-checker approval, schedule effective dates, and roll back safely without changing accepted obligations.",
      resources: [
        resource("financial-policies", "Policy Versions", "/admin/financial-policies", [
          "financial_policy_definitions",
          "version",
          "lifecycle_status",
          "currency_code",
          "effective_from",
          "geography_type",
        ]),
      ],
      actions: [
        action(
          "submit-financial-policy",
          "Submit For Approval",
          "/admin/financial-policies/submit",
          [requiredText("policyVersionId", "Policy Version ID"), requiredText("reason", "Submission Note")],
          "platform.financial_policy.draft",
        ),
        action(
          "review-financial-policy",
          "Approve Or Reject",
          "/admin/financial-policies/review",
          [
            requiredText("policyVersionId", "Policy Version ID"),
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Approve", value: "approved" },
                { label: "Reject", value: "rejected" },
              ],
              defaultValue: "approved",
            },
            requiredText("reason", "Review Reason"),
          ],
          "platform.financial_policy.approve",
        ),
        action(
          "activate-financial-policy",
          "Activate Approved Version",
          "/admin/financial-policies/activate",
          [requiredText("policyVersionId", "Policy Version ID"), requiredText("reason", "Activation Reason")],
          "platform.financial_policy.activate",
        ),
        action(
          "deactivate-financial-policy",
          "Deactivate Version",
          "/admin/financial-policies/deactivate",
          [requiredText("policyVersionId", "Policy Version ID"), requiredText("reason", "Deactivation Reason")],
          "platform.financial_policy.activate",
          "danger",
        ),
        action(
          "rollback-financial-policy",
          "Create Rollback Version",
          "/admin/financial-policies/rollback",
          [
            requiredText("activeVersionId", "Version Being Replaced"),
            requiredText("restoreVersionId", "Version To Restore"),
            { key: "effectiveFrom", label: "Effective From", type: "datetime", required: true },
            requiredText("reason", "Rollback Reason"),
          ],
          "platform.financial_policy.rollback",
          "danger",
        ),
        action(
          "preview-financial-policy",
          "Resolve Policy Preview",
          "/admin/financial-policies/resolve",
          [
            requiredText("policyKey", "Policy Key"),
            requiredText("currencyCode", "Currency"),
            optionalText("moduleKey", "Business Line"),
            optionalText("serviceKey", "Service Scope"),
            optionalText("organizationId", "Organization ID"),
            {
              key: "geographyType",
              label: "Geography Scope",
              type: "select",
              options: financialGeographyOptions,
              defaultValue: "global",
            },
            optionalText("geographyKey", "Geography Key"),
            { key: "at", label: "Resolve At", type: "datetime" },
          ],
          "platform.financial_policy.read",
        ),
      ],
    },
    {
      key: "wallets",
      label: "Wallets And Deposits",
      description: "Monitor wallets and governed deposit funding.",
      resources: [
        resource("wallets", "Wallets", "/runtime/wallets", [
          "wallet_type",
          "owner_entity_type",
          "currency_code",
          "status",
        ]),
        resource("balances", "Balances", "/runtime/wallet-balances", [
          "wallet_id",
          "currency_code",
          "available_balance_minor",
          "reserved_balance_minor",
        ]),
        resource("deposits", "Deposits", "/runtime/payments/deposits", [
          "wallet_id",
          "amount",
          "status",
          "provider_reference",
        ]),
        resource("payment-events", "Payment Events", "/runtime/payment-webhook-events", [
          "event_type",
          "provider_reference",
          "signature_verified",
          "status",
        ]),
      ],
      actions: [
        action(
          "initialize-deposit",
          "Initialize Deposit",
          "/runtime/payments/deposits",
          [
            requiredNumber("amount", "Amount"),
            optionalText("walletId", "Wallet ID"),
            optionalText("currencyCode", "Currency Code"),
            {
              key: "providerAdapterKey",
              label: "Payment Provider",
              type: "select",
              options: providerOptions,
              defaultValue: "provider.payment.sandbox",
            },
            optionalJson(),
          ],
          "platform.financial.manage",
        ),
        action(
          "verify-deposit",
          "Verify Deposit",
          "/runtime/payments/deposits/verify",
          [requiredText("depositRequestId", "Deposit Request ID"), optionalJson()],
          "platform.financial.manage",
        ),
        action(
          "configure-bank-transfer",
          "Configure Direct Bank Account",
          "/admin/payments/bank-transfer-config",
          [
            requiredText("bankName", "Bank Name", "e.g. Guaranty Trust Bank"),
            requiredText("accountNumber", "Account Number", "e.g. 0123456789"),
            requiredText("accountName", "Account Name", "e.g. Your Registered Starter Business Name"),
          ],
          "platform.financial.manage",
        ),
      ],
    },
    {
      key: "withdrawals",
      label: "Withdrawals",
      description: "Configure beneficiaries, approve withdrawals, and record transfer outcomes.",
      resources: [
        resource("beneficiaries", "Beneficiaries", "/runtime/withdrawal-beneficiaries", [
          "wallet_id",
          "beneficiary_type",
          "account_name",
          "status",
        ]),
        resource("withdrawals", "Withdrawals", "/runtime/withdrawals", [
          "wallet_id",
          "amount",
          "fee_amount",
          "status",
        ]),
        resource("transfers", "Transfers", "/runtime/withdrawals/transfers", [
          "withdrawal_request_id",
          "status",
          "provider_reference",
          "created_at",
        ]),
      ],
      actions: [
        action(
          "configure-beneficiary",
          "Configure Beneficiary",
          "/runtime/withdrawal-beneficiaries",
          [
            requiredText("walletId", "Wallet ID"),
            requiredText("accountName", "Account Name"),
            requiredText("accountNumber", "Account Number"),
            optionalText("bankCode", "Bank Code"),
            optionalText("beneficiaryType", "Beneficiary Type"),
            {
              key: "providerAdapterKey",
              label: "Payment Provider",
              type: "select",
              options: providerOptions,
              defaultValue: "provider.payment.sandbox",
            },
            optionalJson(),
          ],
          "platform.financial.manage",
        ),
        action(
          "request-withdrawal",
          "Request Withdrawal",
          "/runtime/withdrawals",
          [
            requiredText("walletId", "Wallet ID"),
            requiredText("beneficiaryId", "Beneficiary ID"),
            requiredNumber("amount", "Amount"),
            optionalJson(),
          ],
          "platform.financial.manage",
        ),
        action(
          "approve-withdrawal",
          "Approve Withdrawal",
          "/runtime/withdrawals/approve",
          [requiredText("withdrawalRequestId", "Withdrawal Request ID"), optionalJson()],
          "platform.financial.manage",
        ),
        action(
          "process-transfer",
          "Record Transfer Result",
          "/runtime/withdrawals/transfers",
          [
            requiredText("withdrawalRequestId", "Withdrawal Request ID"),
            {
              key: "providerStatus",
              label: "Provider Status",
              type: "select",
              options: transferStatusOptions,
              required: true,
            },
            optionalText("providerReference", "Provider Reference"),
            optionalJson("responsePayload", "Provider Response", {}),
            optionalJson(),
          ],
          "platform.financial.manage",
          "danger",
        ),
      ],
    },
    {
      key: "settlements",
      label: "Escrow And Settlement",
      description:
        "Fund orders, release escrow, refund, settle businesses, execute commissions, and reconcile.",
      resources: [
        resource("commissions", "Commissions", "/runtime/commission-executions", [
          "order_id",
          "driver_wallet_id",
          "amount",
          "status",
        ]),
        resource("settlements", "Settlement Statements", "/runtime/settlement-statements", [
          "organization_id",
          "gross_amount",
          "net_amount",
          "status",
        ]),
      ],
      actions: [
        action(
          "reserve-payment",
          "Reserve Payment",
          "/runtime/payments/reserve",
          [
            requiredText("serviceRequestId", "Service Request ID"),
            requiredText("customerWalletId", "Customer Wallet ID"),
            requiredText("escrowWalletId", "Escrow Wallet ID"),
            optionalJson(),
          ],
          "platform.financial.manage",
        ),
        action(
          "fund-order",
          "Fund Order",
          "/runtime/order-funding",
          [
            requiredText("orderId", "Order ID"),
            requiredText("customerWalletId", "Customer Wallet ID"),
            optionalText("escrowWalletId", "Escrow Wallet ID"),
            optionalJson(),
          ],
          "platform.financial.manage",
        ),
        action(
          "execute-commission",
          "Execute Driver Commission",
          "/runtime/commissions/execute",
          [
            requiredText("orderId", "Order ID"),
            requiredText("escrowHoldId", "Escrow Hold ID"),
            requiredText("driverWalletId", "Driver Wallet ID"),
            optionalJson(),
          ],
          "platform.financial.manage",
        ),
        action(
          "execute-order-settlement",
          "Settle Business Order",
          "/runtime/order-settlements/execute",
          [
            requiredText("orderId", "Order ID"),
            requiredText("escrowHoldId", "Escrow Hold ID"),
            requiredText("businessWalletId", "Business Wallet ID"),
            optionalText("platformFeeWalletId", "Platform Fee Wallet ID"),
            optionalJson(),
          ],
          "platform.financial.manage",
        ),
        action(
          "release-escrow",
          "Release Escrow",
          "/runtime/escrow/release",
          [
            requiredText("serviceRequestId", "Service Request ID"),
            optionalJson(),
          ],
          "platform.financial.manage",
        ),
        action(
          "update-escrow-status",
          "Change Escrow Status",
          "/runtime/escrow/status",
          [
            requiredText("escrowHoldId", "Escrow Hold ID"),
            requiredText("status", "Status"),
            optionalJson(),
          ],
          "platform.financial.manage",
          "danger",
        ),
        action(
          "refund-escrow",
          "Refund Escrow",
          "/runtime/escrow/refund",
          [
            requiredText("escrowHoldId", "Escrow Hold ID"),
            requiredText("refundWalletId", "Refund Wallet ID"),
            optionalJson(),
          ],
          "platform.financial.manage",
          "danger",
        ),
        action(
          "reconcile-service-request",
          "Reconcile Service Request",
          "/runtime/reconciliation/service-request",
          [requiredText("serviceRequestId", "Service Request ID")],
          "platform.financial.manage",
        ),
      ],
    },
  ],
};

export const integrationConsoleConfig: AdminResourceConsoleConfig = {
  eyebrow: "Connections",
  title: "Integrations",
  description:
    "Review provider adapters, outbound deliveries, payment events, communications, and OTP operations.",
  groups: [
    {
      key: "maps-location",
      label: "Maps & Location",
      description:
        "Monitor address search, routing, cache health and the active provider. Provider changes are explicit, audited and never trigger a paid fallback.",
      resources: [
        resource(
          "maps-location-status",
          "Location service status",
          "/admin/maps/location/status",
          [
            "active_geocoder",
            "active_router",
            "provider_configuration",
            "provider_health",
            "geocode_cache",
            "requests_last_24_hours",
          ],
          "See the active geocoder and router, recent reliability, cache use and cost-protection state without exposing provider secrets.",
        ),
        resource(
          "maps-location-providers",
          "Available location providers",
          "/admin/maps/location/providers",
          ["provider", "role", "configuration", "status", "capabilities", "last_updated"],
          "LocationIQ is active. Google Maps and Mapbox remain preserved and inactive until a Super Admin makes an explicit change.",
        ),
        resource(
          "maps-location-audit",
          "Location configuration history",
          "/admin/maps/location/audit",
          ["change", "changed_by", "reason", "changed_at"],
          "Review who changed the active location provider, when it changed and why.",
        ),
      ],
      actions: [
        action(
          "activate-maps-provider",
          "Change active location provider",
          "/admin/maps/location/provider",
          [
            statusSelect("providerKey", "Location provider", [
              { label: "LocationIQ", value: "provider.maps.locationiq" },
              { label: "Google Maps Platform (rollback only)", value: "provider.maps.google-maps" },
            ]),
            requiredText(
              "reason",
              "Reason for change",
              "Explain the operational reason. The change is immediate and recorded in the audit history.",
            ),
          ],
          "platform.providers.manage",
        ),
      ],
    },
    {
      key: "providers",
      label: "Provider Connections",
      description: "Inspect swappable payment, map, notification, AI, queue, and cache adapters.",
      resources: [
        resource("providers", "Connections", "/engines/provider-adapters", [
          "provider_kind",
          "key",
          "display_name",
          "status",
        ]),
        resource("currencies", "Currencies", "/engines/currencies", [
          "code",
          "display_name",
          "status",
        ]),
        resource("pricing-policies", "Pricing Policies", "/engines/pricing-policies", [
          "key",
          "pricing_mode",
          "currency_code",
          "status",
        ]),
        resource("settlement-policies", "Settlement Policies", "/engines/settlement-policies", [
          "key",
          "scope_type",
          "status",
        ]),
        resource("dispatch-policies", "Dispatch Policies", "/engines/dispatch-policies", [
          "key",
          "matching_strategy",
          "status",
        ]),
        resource(
          "verification-definitions",
          "Verification Definitions",
          "/engines/verification-definitions",
          [
            "key",
            "verification_mode",
            "event_type_key",
            "status",
          ],
        ),
        resource(
          "notification-templates",
          "Notification Templates",
          "/engines/notification-templates",
          [
            "key",
            "channel",
            "locale",
            "status",
          ],
        ),
        resource("ai-tasks", "AI Tasks", "/engines/ai-task-definitions", [
          "key",
          "task_type",
          "status",
        ]),
      ],
      actions: [],
    },
    {
      key: "communication",
      label: "Communication",
      description:
        "Queue messages, sync delivery statuses, request OTP, and verify OTP challenges.",
      resources: [
        resource("messages", "Messages", "/runtime/communications/messages", [
          "channel",
          "purpose",
          "recipient_entity_type",
          "status",
        ]),
        resource("otp", "OTP Challenges", "/runtime/otp/challenges", [
          "purpose",
          "channel",
          "recipient_address",
          "status",
        ]),
      ],
      actions: [
        action(
          "queue-message",
          "Queue Message",
          "/runtime/communications/messages",
          [
            {
              key: "channel",
              label: "Channel",
              type: "select",
              options: communicationChannelOptions,
              required: true,
            },
            requiredText("purpose", "Purpose"),
            requiredText("recipientEntityType", "Recipient Type"),
            optionalText("recipientEntityId", "Recipient ID"),
            optionalText("recipientAddress", "Recipient Address"),
            optionalText("providerAdapterKey", "Provider Adapter Key"),
            optionalJson("payload", "Message Details", {}),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
        action(
          "sync-messages",
          "Sync Message Status",
          "/runtime/communications/sync",
          [optionalNumber("limit", "Limit")],
          "platform.events.manage",
        ),
        action(
          "request-otp",
          "Request OTP",
          "/runtime/otp/challenges",
          [
            {
              key: "channel",
              label: "Channel",
              type: "select",
              options: communicationChannelOptions,
              required: true,
            },
            requiredText("purpose", "Purpose"),
            requiredText("recipientAddress", "Recipient Address"),
            optionalNumber("ttlSeconds", "Expiry Seconds"),
            optionalNumber("maxAttempts", "Maximum Attempts"),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
        action(
          "fetch-otp",
          "Fetch In-App OTP",
          "/runtime/otp/delivery",
          [requiredText("challengeId", "Challenge ID"), optionalJson()],
          "platform.events.manage",
        ),
        action(
          "verify-otp",
          "Verify OTP",
          "/runtime/otp/verify",
          [
            requiredText("challengeId", "Challenge ID"),
            requiredText("code", "Code"),
            optionalJson(),
          ],
          "platform.events.manage",
        ),
      ],
    },
  ],
};
