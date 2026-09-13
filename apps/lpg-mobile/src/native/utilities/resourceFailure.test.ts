import { ApiGatewayError } from "@skima/frontend-core";
import { classifyResourceFailure } from "./resourceFailure";

describe("classifyResourceFailure", () => {
  it("classifies gateway forbidden responses as non-retryable permission restrictions", () => {
    const error = new ApiGatewayError({
      status: 403,
      code: "FORBIDDEN",
      message: "Permission denied",
    });

    expect(classifyResourceFailure(error)).toEqual({
      kind: "permission",
      retryable: false,
    });
  });

  it("classifies missing resources separately from backend failures", () => {
    const error = new ApiGatewayError({
      status: 404,
      code: "NOT_FOUND",
      message: "Settlement statement not found",
    });

    expect(classifyResourceFailure(error)).toEqual({
      kind: "missing",
      retryable: false,
    });
  });

  it("classifies temporary gateway outages as retryable", () => {
    const error = new ApiGatewayError({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Service temporarily unavailable",
    });

    expect(classifyResourceFailure(error)).toEqual({
      kind: "temporary",
      retryable: true,
    });
  });

  it("classifies connection failures as network problems", () => {
    expect(classifyResourceFailure(new Error("Network request failed"))).toEqual({
      kind: "network",
      retryable: true,
    });
  });

  it("recognizes branch ownership and station-scope restrictions", () => {
    expect(classifyResourceFailure(new Error("Station branch access belongs to another station"))).toEqual({
      kind: "ownership",
      retryable: false,
    });
  });
});
