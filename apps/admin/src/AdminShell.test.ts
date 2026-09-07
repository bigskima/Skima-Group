import { describe, expect, it } from "vitest";

import type { NavItem } from "@skima/ui";
import { dedupeNavigationItems } from "./AdminShell";

describe("Admin sidebar navigation", () => {
  it("renders a canonical route only once even when it arrives under multiple keys", () => {
    const items: NavItem[] = [
      { key: "revenue", label: "Money & Revenue", href: "/revenue" },
      { key: "delivery-pricing", label: "Delivery Pricing", href: "/delivery-pricing" },
      { key: "legacy-delivery-pricing", label: "Delivery Pricing", href: "/delivery-pricing/" },
      { key: "driver-pricing", label: "Driver Pricing", href: "/driver-pricing" },
    ];

    const result = dedupeNavigationItems(items);

    expect(result.map((item) => item.key)).toEqual([
      "revenue",
      "delivery-pricing",
      "driver-pricing",
    ]);
    expect(result.filter((item) => item.href.replace(/\/+$/, "") === "/delivery-pricing")).toHaveLength(1);
  });

  it("also rejects duplicate keys so a grouped item cannot be rendered twice", () => {
    const items: NavItem[] = [
      { key: "delivery-pricing", label: "Delivery Pricing", href: "/delivery-pricing" },
      { key: "delivery-pricing", label: "Old duplicate", href: "/old-delivery-pricing" },
    ];

    expect(dedupeNavigationItems(items)).toHaveLength(1);
  });
});
