import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { App } from "../app/App";
import { Providers, createQueryClient } from "../app/providers";
import { routes } from "../app/routes";

// The whole app -- shell, sidebar, guard, pages -- over the REAL route table,
// starting at `path`. Returns the router so a test can read where it ended up.
export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers client={createQueryClient()}>
      <App router={router} />
    </Providers>,
  );
  return router;
}
