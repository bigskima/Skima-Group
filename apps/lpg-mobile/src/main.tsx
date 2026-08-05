import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  document.body.innerHTML =
    '<main style="min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;padding:24px"><section role="alert" style="max-width:430px"><h1>Skima LPG could not start</h1><p>The application root was not found. Redeploy the app or contact support.</p></section></main>';
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
