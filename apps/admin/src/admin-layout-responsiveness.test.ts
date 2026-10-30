import { describe, expect, it } from "vitest";

import adminTheme from "./admin-v2-theme.css?raw";
import workspaceLayout from "./layouts/admin-workspace-layout.css?raw";
import workspaceLanding from "./shared/patterns/workspace-landing.css?raw";

describe("admin responsive layout contract", () => {
  it("keeps the primary shell and route content inside the available main column", () => {
    expect(adminTheme).toContain("width: calc(100% - var(--admin-sidebar-width))");
    expect(adminTheme).toContain("container: admin-main / inline-size");
    expect(adminTheme).toContain("container: admin-screen / inline-size");
    expect(adminTheme).toContain(".admin-shell__content");
    expect(adminTheme).toContain("max-width: 100%");
  });

  it("switches the secondary workspace rail based on the width left by the primary sidebar", () => {
    expect(adminTheme).toContain("@container admin-main (max-width: 900px)");
    expect(adminTheme).toContain(".admin-shell .admin-workspace-layout__rail");
    expect(adminTheme).toContain(".admin-shell .admin-workspace-layout__mobile-nav");
    expect(workspaceLayout).toContain("min-width: 0");
    expect(workspaceLayout).toContain("max-width: 100%");
  });

  it("stacks shared workspace landing panels when their own column is narrow", () => {
    expect(workspaceLanding).toContain("container: workspace-landing / inline-size");
    expect(workspaceLanding).toContain("@container workspace-landing (max-width: 980px)");
    expect(workspaceLanding).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(workspaceLanding).toContain(".workspace-landing__aside .skima-grid--compact");
    expect(workspaceLanding).toContain(".workspace-landing__header > div:first-child:last-child");
    expect(workspaceLanding).not.toContain("prefers-color-scheme: dark");
  });

  it("adapts reusable feature grids to nested route widths", () => {
    expect(adminTheme).toContain("@container admin-screen (max-width: 1000px)");
    expect(adminTheme).toContain(".admin-v2-screen .fulfillment-v2__metrics");
    expect(adminTheme).toContain(".admin-v2-screen .coverage-v2__section-nav");
    expect(adminTheme).toContain(".admin-v2-screen .content-v2__layout");
    expect(adminTheme).toContain(".admin-v2-screen .utility-v2__setup-grid");
    expect(adminTheme).toContain(".admin-v2-screen .catalog-v2__task-grid");
  });
});
