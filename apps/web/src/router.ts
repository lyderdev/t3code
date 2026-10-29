import { createRouter, RouterHistory } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export function getRouter(history: RouterHistory) {
  const basepath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return createRouter({
    routeTree,
    history,
    ...(basepath ? { basepath } : {}),
    context: {},
    defaultPreload: "intent",
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
