import { useEffect } from "react";
import { router } from "expo-router";

/** Legacy Bills links now return to Logistics; Bills lives in the Refill app. */
export default function LegacyBillsRedirect() {
  useEffect(() => {
    router.replace("/(customer)" as never);
  }, []);
  return null;
}
