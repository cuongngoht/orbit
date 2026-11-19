import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./themes/global.css";

const mount = document.getElementById("root");
if (!mount) throw new Error("Orbit Web's page has no #root element to mount into");

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
