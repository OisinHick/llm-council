/**
 * Main application entrypoint for the LLM Council web interface.
 *
 * This file bootstraps the React application:
 * - Selects the DOM container element with ID "root".
 * - Initializes the React 18 concurrent root via `createRoot`.
 * - Imports global base styles (`index.css`) containing reset rules and theme variables.
 * - Wraps the root `<App />` component in React `<StrictMode>` to highlight potential side
 *   effects during development.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Find root mounting element in index.html and initialize React concurrent tree
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element '#root' not found in document. Unable to mount application.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

