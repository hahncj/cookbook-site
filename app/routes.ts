import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("recipes/new", "routes/recipe-new.tsx"),
  route("recipes/:id", "routes/recipe.tsx"),
  route("recipes/:id/edit", "routes/recipe-edit.tsx"),
  route("deleted", "routes/deleted.tsx"),
  route("theme", "routes/theme.ts"),
  route("sign-in", "routes/sign-in.tsx"),
  route("consent", "routes/consent.tsx"),
] satisfies RouteConfig;
