import { ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  CylinderArt,
  DriverArt,
  PhoneStatus,
  StationArt,
  StepDots,
} from "../../../shared/ui/lpgComponents";

const slides = [
  {
    art: <CylinderArt size="large" tone="red" />,
    text: "Upload your cylinder photos, choose kilograms, receive a quote, and pay securely.",
    title: "Start with your real LPG cylinder.",
  },
  {
    art: <StationArt />,
    text: "Every refill is tied to cylinder scans, order status, and settlement.",
    title: "Stations receive and refill with confidence.",
  },
  {
    art: <DriverArt />,
    text: "Pickup, station refill, return route, delivery OTP, and commission stay connected.",
    title: "Drivers earn through verified delivery.",
  },
] as const;

export function OnboardingScreen(props: { readonly onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = slides[index] ?? slides[0];

  return (
    <main className="lpg-app-shell">
      <section className="phone-frame onboarding-screen">
        <PhoneStatus />
        <button type="button" className="skip-button" onClick={props.onComplete}>Skip</button>
        <div className="onboarding-art">{slide.art}</div>
        <h1>{slide.title}</h1>
        <p>{slide.text}</p>
        <div className="onboarding-footer">
          <StepDots total={slides.length} active={index} />
          <button
            type="button"
            className="round-next"
            aria-label={index === slides.length - 1 ? "Continue to login" : "Next"}
            onClick={() => index === slides.length - 1 ? props.onComplete() : setIndex(index + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  );
}
