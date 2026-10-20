import { RouterProvider, type createBrowserRouter } from "react-router";

type AppRouter = ReturnType<typeof createBrowserRouter>;

// The router is handed in: main.tsx gives it the browser's history, a test
// gives it a memory one over the same routes.
export function App({ router }: { router: AppRouter }) {
  return <RouterProvider router={router} />;
}
