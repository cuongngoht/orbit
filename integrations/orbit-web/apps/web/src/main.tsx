import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { takeAccessLink } from "./services/accessLink";
import "./themes/global.css";

// An access link's token leaves the address bar before anything reads the URL.
takeAccessLink();

const mount = document.getElementById("root");
if (!mount) throw new Error("Orbit Web's page has no #root element to mount into");

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
