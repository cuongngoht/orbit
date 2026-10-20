import { Navigate, type RouteObject } from "react-router";
import { AppShell } from "./layout/AppShell";
import { DESTINATIONS, HOME } from "./navigation";
import { NotFoundPage } from "./NotFoundPage";
import { RouteError } from "./RouteError";

// Derived from DESTINATIONS, never written beside it: a page the sidebar lists
// is a page the router serves, and the other way round. Every page has an
// error element of its own, so a page that fails to draw is replaced by a
// message INSIDE the shell; the shell's own one is the last resort.
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to={HOME} replace /> },
      ...DESTINATIONS.map((d) => ({ path: d.path, errorElement: <RouteError />, children: [{ index: true, element: d.element }, ...(d.children ?? [])] })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
