import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { App } from "./app/App";
import { Providers } from "./app/providers";
import { routes } from "./app/routes";
import { adoptTokenFromUrl } from "./shared/api/client";
import "./styles/global.css";

adoptTokenFromUrl();

// index.html ships the one mount point; a page without it is a broken build,
// said as such rather than asserted away.
const mount = document.getElementById("root");
if (!mount) throw new Error("Orbit Control's page has no #root element to mount into -- rebuild control-panel");

createRoot(mount).render(
  <StrictMode>
    <Providers>
      <App router={createBrowserRouter(routes)} />
    </Providers>
  </StrictMode>,
);
