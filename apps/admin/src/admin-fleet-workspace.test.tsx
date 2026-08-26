import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("./session", () => ({
  useSessionState: () => ({
    status: "authenticated",
    supabase: { rpc: session.rpc },
  }),
}));

import { AdminFleetWorkspace } from "./admin-fleet-workspace";

function wrapper(props: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{props.children}</QueryClientProvider>;
}

const workspace = {
  partners: [],
  applications: [],
  vehicles: [],
  assignments: [],
  compliance: [],
  ownership: [],
  audit: [],
};

describe("AdminFleetWorkspace", () => {
  beforeEach(() => session.rpc.mockReset());

  it("keeps hook ordering stable while the Fleet workspace loads", async () => {
    let finish: ((value: unknown) => void) | undefined;
    session.rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

    render(<AdminFleetWorkspace />, { wrapper });
    expect(screen.getByText("Loading fleet operations")).toBeInTheDocument();

    await act(async () => finish?.({ data: { ...workspace, drivers: [] }, error: null }));
    expect(await screen.findByText("Fleet & Vehicles")).toBeInTheDocument();
  });

  it("accepts an older backend payload without the optional drivers collection", async () => {
    session.rpc.mockResolvedValue({ data: workspace, error: null });

    render(<AdminFleetWorkspace />, { wrapper });
    expect(await screen.findByText("Fleet & Vehicles")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vehicles" }));
    expect(screen.getByText("No vehicles match the current filters.")).toBeInTheDocument();
  });
});
