const root = document.getElementById("root");
let startupPhase = true;

window.addEventListener("error", (event) => {
  if (startupPhase) {
    renderBootError(event.error ?? event.message);
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (startupPhase) {
    renderBootError(event.reason);
  }
});

void import("./main")
  .then(() => {
    startupPhase = false;
  })
  .catch((error: unknown) => {
    renderBootError(error);
  });

function renderBootError(error: unknown) {
  if (!root) {
    return;
  }

  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
    ? error
    : "Skima could not start.";

  root.innerHTML = `
    <main style="align-items:center;background:#f7f8fb;color:#121826;display:grid;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:24px;">
      <section role="alert" style="background:#fff;border:1px solid #d9e0ea;border-radius:8px;box-shadow:0 12px 32px rgba(18,24,38,.12);display:grid;gap:16px;max-width:560px;padding:24px;width:100%;">
        <div>
          <h1 style="font-size:28px;letter-spacing:0;margin:0;">Skima</h1>
          <p style="color:#5f6b7a;margin:8px 0 0;">Skima could not start</p>
        </div>
        <p style="margin:0;">${escapeHtml(message)}</p>
      </section>
    </main>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
