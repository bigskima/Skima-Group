import type {
  AdminResourceConsoleConfig,
  AdminResourceGroup,
} from "../../admin-resource-console";
import { catalogConsoleConfig } from "../../admin-resource-config";

const catalogGroup = requireCatalogGroup();

export const serviceCatalogConfig: AdminResourceConsoleConfig = {
  eyebrow: "Services",
  title: "Service catalog",
  description:
    "Manage service categories, items, variants, prices and media without mixing availability controls into the same screen.",
  groups: [focusCatalogGroup(
    "catalog-records",
    "Service catalog",
    "Maintain the reusable records customers see and SKIMA uses when quoting or fulfilling a service.",
    ["units", "categories", "items", "variants", "prices", "media"],
    [
      "configure-unit",
      "configure-category",
      "configure-item",
      "configure-variant",
      "configure-price",
      "attach-media",
    ],
  )],
};

export const serviceAvailabilityConfig: AdminResourceConsoleConfig = {
  eyebrow: "Services",
  title: "Service availability",
  description:
    "Control whether catalog items can be ordered, where capacity exists and whether current quantity can be fulfilled.",
  groups: [focusCatalogGroup(
    "availability",
    "Availability & orderability",
    "Manage service availability, capacity and orderability separately from service definitions and prices.",
    ["availability", "orderability"],
    ["set-availability", "adjust-stock", "check-orderability"],
  )],
};

function requireCatalogGroup(): AdminResourceGroup {
  const group = catalogConsoleConfig.groups.find((candidate) => candidate.key === "catalog");

  if (!group) {
    throw new Error("Catalog workspace group is unavailable.");
  }

  return group;
}

function focusCatalogGroup(
  key: string,
  label: string,
  description: string,
  resourceKeys: readonly string[],
  actionKeys: readonly string[],
): AdminResourceGroup {
  const allowedResources = new Set(resourceKeys);
  const allowedActions = new Set(actionKeys);

  return {
    ...catalogGroup,
    key,
    label,
    description,
    resources: catalogGroup.resources.filter((resource) => allowedResources.has(resource.key)),
    actions: catalogGroup.actions.filter((action) => allowedActions.has(action.key)),
  };
}
