import { RouterContextProvider, createContext } from "react-router";
import type { Services } from "../server/app";

/** Server services available to loaders and actions via `context.get(servicesContext)`. */
export const servicesContext = createContext<Services>();

export function createRouterContext(services: Services): RouterContextProvider {
  const context = new RouterContextProvider();
  context.set(servicesContext, services);
  return context;
}
