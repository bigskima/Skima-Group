import { friendlyError } from "./friendlyError";

describe("friendlyError", () => {
  it.each([
    "permission denied for table locations",
    "PGRST204 schema cache failure",
    "SQLSTATE 42501",
    "violates foreign key constraint",
    "function public.resolve_service_availability failed",
  ])("does not expose implementation details from %s", (message) => {
    expect(friendlyError(new Error(message), "Please try again.")).toBe("Please try again.");
  });

  it("translates location coordinates into a customer action", () => {
    expect(friendlyError(new Error("valid latitude and longitude are required"))).toBe(
      "This saved location needs a valid map position before SKIMA can check service availability.",
    );
  });
});
