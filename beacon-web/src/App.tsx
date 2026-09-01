// App root: providers + the router. Everything else (navigation, route selection, URL state)
// lives in the route tree — see src/router.tsx.

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "./hooks/useTheme";
import { SplashScreen } from "./components/SplashScreen";
import { router } from "./router";
import { queryClient } from "./api/query-client";
import { SelectionResetOnRegion } from "./state/SelectionResetOnRegion";

export { PathLinkRestore } from "./features/packets/PathLinkRestore";
export { SelectionResetOnRegion };

export function App({ appRouter = router }: { appRouter?: typeof router }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SplashScreen />
        <RouterProvider router={appRouter} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
