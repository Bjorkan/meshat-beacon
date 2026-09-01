import type { ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "number") return [String(value)];
  return typeof value === "string" ? value.split(",").filter(Boolean) : [];
}

function validateSearch(search: Record<string, unknown>) {
  return {
    ...search,
    types: list(search.types).map(Number).filter(Number.isFinite),
    routes: list(search.routes).map(Number).filter(Number.isFinite),
    obs: list(search.obs),
    scope: list(search.scope),
  };
}

// Router wrapper for component tests: components under test call useSearch/useNavigate against
// whatever route they land on; a splat child catches every path so no route registration is needed.
export function TestRouter({ children, initialEntry = "/" }: { children: ReactNode; initialEntry?: string }) {
  const rootRoute = createRootRoute({ component: () => <Outlet />, validateSearch });
  const splatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => children,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => children,
  });
  const history = createMemoryHistory({ initialEntries: [initialEntry] });
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, splatRoute]), history });
  return <RouterProvider router={router} />;
}
