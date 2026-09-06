import { inlineMarkdown, speechText } from "./AiMarkdown";

describe("Matty response formatting", () => {
  it("turns supported emphasis into presentation spans without exposing markers", () => {
    expect(inlineMarkdown("Your **station is ready** now")).toEqual([
      { text: "Your " },
      { text: "station is ready", bold: true },
      { text: " now" },
    ]);
  });
  it("renders inline code as a distinct safe span", () => {
    expect(inlineMarkdown("Status `in progress`")).toEqual([
      { text: "Status " },
      { text: "in progress", code: true },
    ]);
  });
});

describe("speechText", () => {
  it("removes visual markdown before reading a Matty response", () => {
    expect(speechText("**Refill ready**\n- Bring `SK-12`.")).toBe("Refill ready Bring SK-12.");
  });
});
