import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("recipes/new", "routes/recipe-new.tsx"),
  route("recipes/:id", "routes/recipe.tsx"),
  route("recipes/:id/edit", "routes/recipe-edit.tsx"),
  route("recipes/:id/history", "routes/recipe-history.tsx"),
  route("recipes/:id/history/:revision", "routes/recipe-version.tsx"),
  route("deleted", "routes/deleted.tsx"),
  route("backup", "routes/backup.tsx"),
  route("api/photos", "routes/api.photos.ts"),
  route("api/backup", "routes/api.backup.ts"),
  route("api/backup/restore", "routes/api.backup.restore.ts"),
  route("api/backup/photo", "routes/api.backup.photo.ts"),
  route("theme", "routes/theme.ts"),
  route("sign-in", "routes/sign-in.tsx"),
  route("consent", "routes/consent.tsx"),
] satisfies RouteConfig;
