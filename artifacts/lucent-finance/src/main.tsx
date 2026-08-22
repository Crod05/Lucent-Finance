import { ClerkProvider } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/theme-init";

const configuredPublishableKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!configuredPublishableKey) {
  throw new Error(
    "Lucent Finance cannot start without VITE_CLERK_PUBLISHABLE_KEY.",
  );
}

const publishableKey = publishableKeyFromHost(
  window.location.hostname,
  configuredPublishableKey,
);

createRoot(document.getElementById("root")!).render(
  <ClerkProvider publishableKey={publishableKey}>
    <App />
  </ClerkProvider>,
);
