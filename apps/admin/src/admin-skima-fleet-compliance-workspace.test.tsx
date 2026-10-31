import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./session", () => ({
  useSessionState: () => ({
    status: "authenticated",
    context: { platformAdmin: { admin_kind: "super_admin" }, permissions: [] },
    supabase: {
      rpc: session.rpc,
      auth: { getUser: session.getUser },
      storage: { from: session.from },
    },
  }),
}));

vi.mock("@skima/frontend-core", () => ({
  createClientIdempotencyKey: vi.fn(() => "test-fleet-document-idempotency-key"),
}));

import { AdminSkimaFleetComplianceWorkspace } from "./admin-skima-fleet-compliance-workspace";

const ADMIN_USER_ID = "10000000-0000-4000-8000-000000000001";
const VEHICLE_ID = "20000000-0000-4000-8000-000000000002";
const SUBMISSION_ID = "30000000-0000-4000-8000-000000000003";

const vehicle = {
  vehicleId: VEHICLE_ID,
  registrationNumber: "ABC-123XY",
  manufacturer: "Toyota",
  model: "Hilux",
  status: "active",
  complianceReady: false,
  currentDriverName: "SKIMA Driver",
  currentDriverPublicId: "SKD-0001",
};

const roadworthiness = {
  requirementKey: "vehicle.roadworthiness",
  label: "Roadworthiness",
  documentPurposeKey: "vehicle.roadworthiness",
  moduleKey: "lpg",
  required: true,
  enforcement: "dispatch",
  status: "missing",
  evidenceId: null,
  documentSubmissionId: null,
  validFrom: null,
  validUntil: null,
  reviewedAt: null,
  current: false,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("AdminSkimaFleetComplianceWorkspace document upload", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "40000000-0000-4000-8000-000000000004"),
    });
    session.rpc.mockReset();
    session.getUser.mockReset();
    session.from.mockReset();
    session.upload.mockReset();
    session.remove.mockReset();

    session.getUser.mockResolvedValue({ data: { user: { id: ADMIN_USER_ID } }, error: null });
    session.upload.mockResolvedValue({ data: { path: "uploaded" }, error: null });
    session.remove.mockResolvedValue({ data: [], error: null });
    session.from.mockImplementation(() => ({
      upload: session.upload,
      remove: session.remove,
    }));

    session.rpc.mockImplementation((name: string) => {
      if (name === "read_platform_fleet_vehicle_options") {
        return Promise.resolve({ data: [vehicle], error: null });
      }
      if (name === "read_platform_fleet_vehicle_compliance") {
        return Promise.resolve({ data: [roadworthiness], error: null });
      }
      if (name === "record_platform_fleet_compliance_document") {
        return Promise.resolve({ data: SUBMISSION_ID, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `Unexpected RPC: ${name}` } });
    });
  });

  it("captures the selected File before the React state updater runs and records it in the private fleet path", async () => {
    render(<AdminSkimaFleetComplianceWorkspace onNavigate={vi.fn()} />, { wrapper });

    expect(await screen.findByText("Vehicle evidence")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Upload evidence" }));

    const file = new File(["roadworthiness evidence"], "roadworthiness.pdf", {
      type: "application/pdf",
    });
    const fileInput = screen.getByLabelText("Document or image");
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });
    fireEvent.change(fileInput);
    fireEvent.change(screen.getByLabelText("Admin review note"), {
      target: { value: "Checked current certificate against fleet records." },
    });

    const saveButton = screen.getByRole("button", { name: "Save evidence" });
    expect(saveButton).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(session.upload).toHaveBeenCalledTimes(1);
      expect(session.rpc).toHaveBeenCalledWith(
        "record_platform_fleet_compliance_document",
        expect.objectContaining({
          target_vehicle_id: VEHICLE_ID,
          target_requirement_key: "vehicle.roadworthiness",
          target_content_type: "application/pdf",
          target_byte_size: file.size,
          target_storage_path: expect.stringMatching(
            new RegExp(`^${ADMIN_USER_ID}/platform-fleet/${VEHICLE_ID}/vehicle\\.roadworthiness/`),
          ),
        }),
      );
    });

    const [bucket] = session.from.mock.calls[0];
    const [storagePath, uploadedFile, options] = session.upload.mock.calls[0];
    const documentRecordCall = session.rpc.mock.calls.find(
      ([name]) => name === "record_platform_fleet_compliance_document",
    );
    expect(bucket).toBe("skima-platform-documents");
    expect(storagePath).toMatch(
      new RegExp(`^${ADMIN_USER_ID}/platform-fleet/${VEHICLE_ID}/vehicle\\.roadworthiness/`),
    );
    expect(documentRecordCall?.[1].target_storage_path).toBe(storagePath);
    expect(documentRecordCall?.[1].target_reason).toBe(
      "Checked current certificate against fleet records.",
    );
    expect(uploadedFile).toBe(file);
    expect(options).toEqual({ contentType: "application/pdf", upsert: false });
    expect(await screen.findByText(/Roadworthiness saved/)).toBeInTheDocument();
  });
});
