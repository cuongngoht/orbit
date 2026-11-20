import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { takeAccessLink, watchAccessLinks } from "./services/accessLink";
import "./themes/global.css";

// An access link's token leaves the address bar before anything reads the URL -- at start, and when a link is opened
// over the page already open (only the fragment changes then, and nothing reloads).
takeAccessLink();
watchAccessLinks();

const mount = document.getElementById("root");
if (!mount) throw new Error("Orbit Web's page has no #root element to mount into");

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
