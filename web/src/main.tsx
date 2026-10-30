import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BrandProvider } from "./lib/brand";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrandProvider>
      <App />
    </BrandProvider>
  </StrictMode>,
);
