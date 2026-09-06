import { inlineMarkdown } from "./AiMarkdown";

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
