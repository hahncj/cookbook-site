import { Form, Link, useNavigation } from "react-router";
import { createApiKey, listApiKeys, revokeApiKey } from "../../server/api-keys";
import { disconnectTool, listConnectedTools } from "../../server/connections";
import { requireAdminWrite } from "../admin.server";
import { AppearanceControl } from "../components/appearance";
import { servicesContext } from "../context";
import { useRootData } from "../root";
import { getViewer } from "../session.server";
import type { Route } from "./+types/settings";

export function meta() {
  return [{ title: "Settings · 540 Kitchen" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const services = context.get(servicesContext);
  // E3: open to everyone for Appearance. The admin sections load only for
  // admins; their actions still refuse everyone else (401/403, AC-064).
  const viewer = await getViewer(request, services);
  if (!viewer?.isAdmin) return { admin: null };
  const [approvalRequired, tools, keys] = await Promise.all([
    services.submissions.approvalRequired(),
    listConnectedTools(services.db),
    listApiKeys(services.db),
  ]);
  return {
    admin: { approvalRequired, tools, keys, mcpUrl: `${services.config.baseUrl}/mcp`, apiBase: `${services.config.baseUrl}/api/v1` },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const services = context.get(servicesContext);
  const admin = await requireAdminWrite(request, services);
  const form = await request.formData();
  const intent = form.get("intent");
  const now = new Date();
  switch (intent) {
    case "approval":
      await services.submissions.setApprovalRequired(form.get("required") === "true", admin.userId);
      return { intent };
    case "disconnect":
      await disconnectTool(services.db, String(form.get("clientId") ?? ""), { now, userId: admin.userId });
      return { intent };
    case "create-key": {
      const created = await createApiKey(services.db, String(form.get("name") ?? ""), admin.userId, now);
      return created ? { intent, newKey: created.key, newKeyName: created.name } : { intent, error: "Give the key a name." };
    }
    case "revoke-key":
      await revokeApiKey(services.db, String(form.get("id") ?? ""), now);
      return { intent };
  }
  return { intent: null };
}

const formatDate = (date: Date | string | null) =>
  date ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "never";

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { theme } = useRootData();
  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <h1>Settings</h1>

      <section className="card" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className="section-title">
          Appearance
        </h2>
        <p className="muted">Saved on this device. System follows your phone or computer's light or dark setting.</p>
        <div style={{ marginTop: 12 }}>
          <AppearanceControl theme={theme} />
        </div>
      </section>

      {loaderData.admin && <AdminSettings data={loaderData.admin} actionData={actionData} />}
    </div>
  );
}

type AdminData = NonNullable<Route.ComponentProps["loaderData"]["admin"]>;

function AdminSettings({ data, actionData }: { data: AdminData; actionData: Route.ComponentProps["actionData"] }) {
  const { approvalRequired, tools, keys, mcpUrl, apiBase } = data;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <>
      <section className="card" aria-labelledby="admin-tools-heading">
        <h2 id="admin-tools-heading" className="section-title">
          Admin tools
        </h2>
        <ul className="settings-links">
          <li>
            <Link to="/backup">Backup</Link>
            <span className="muted">Download a copy of everything, or restore one into an empty cookbook.</span>
          </li>
          <li>
            <Link to="/deleted">Deleted recipes</Link>
            <span className="muted">Restore recipes you deleted.</span>
          </li>
        </ul>
      </section>

      <section className="card" aria-labelledby="approval-heading">
        <h2 id="approval-heading" className="section-title">
          Approval for AI tools
        </h2>
        <p>
          {approvalRequired
            ? "On: recipes and changes sent by AI tools wait for your review before anything in the cookbook changes."
            : "Off: valid recipes and changes from your AI tools save right away. You can still undo any change from the recipe's history."}
        </p>
        <p className="muted" style={{ marginTop: 6 }}>
          Applies to new submissions only. Anything already waiting stays in the review list. AI tools can never change this setting.
        </p>
        <Form method="post" style={{ marginTop: 12 }}>
          <input type="hidden" name="intent" value="approval" />
          <input type="hidden" name="required" value={approvalRequired ? "false" : "true"} />
          <button type="submit" className={approvalRequired ? "btn" : "btn btn-primary"} disabled={busy}>
            {approvalRequired ? "Turn approval off" : "Turn approval on"}
          </button>
        </Form>
      </section>

      <section className="card" aria-labelledby="tools-heading">
        <h2 id="tools-heading" className="section-title">
          Connected AI apps
        </h2>
        <p>
          Connect ChatGPT, Claude.ai or another app that supports remote MCP connectors with this URL; it asks you to sign in and
          allow access:
        </p>
        <p className="code-line">
          <code>{mcpUrl}</code>
        </p>
        {tools.length === 0 ? (
          <p className="muted">No apps connected yet.</p>
        ) : (
          <ul className="trash-list">
            {tools.map((tool) => (
              <li key={tool.clientId}>
                <span>
                  <strong>{tool.name}</strong>
                  <span className="muted">
                    {tool.domain ? ` · ${tool.domain}` : ""} · connected {formatDate(tool.connectedAt)}
                  </span>
                </span>
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (!window.confirm(`Disconnect ${tool.name}? It stops working right away; you can connect it again later.`)) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="intent" value="disconnect" />
                  <input type="hidden" name="clientId" value={tool.clientId} />
                  <button type="submit" className="btn btn-danger" disabled={busy}>
                    Disconnect
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="keys-heading">
        <h2 id="keys-heading" className="section-title">
          API keys
        </h2>
        <p>
          For tools that don't support sign-in, such as scripts or Claude Code. A key can read recipes and send submissions for review,
          using the MCP URL above or the HTTP API at <code>{apiBase}</code>. It can't approve anything or change settings.
        </p>
        {actionData && "newKey" in actionData && actionData.newKey && (
          <div className="notice" role="status" style={{ marginTop: 12 }}>
            <strong>Copy your new key “{actionData.newKeyName}” now. It won't be shown again.</strong>
            <p className="code-line">
              <code>{actionData.newKey}</code>
            </p>
          </div>
        )}
        {keys.length > 0 && (
          <ul className="trash-list">
            {keys.map((key) => (
              <li key={key.id}>
                <span>
                  <strong>{key.name}</strong>
                  <span className="muted">
                    {" "}
                    · {key.prefix}… · created {formatDate(key.createdAt)} · last used {formatDate(key.lastUsedAt)}
                  </span>
                </span>
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (!window.confirm(`Revoke the key “${key.name}”? Tools using it stop working right away.`)) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="intent" value="revoke-key" />
                  <input type="hidden" name="id" value={key.id} />
                  <button type="submit" className="btn btn-danger" disabled={busy}>
                    Revoke
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
        <Form method="post" className="key-form">
          <input type="hidden" name="intent" value="create-key" />
          <div className="field">
            <label htmlFor="key-name">New key name</label>
            <input id="key-name" name="name" maxLength={60} placeholder="e.g. Claude Code on my laptop" required />
          </div>
          <button type="submit" className="btn" disabled={busy}>
            Create key
          </button>
        </Form>
        {actionData && "error" in actionData && actionData.error && <p className="error-text">{actionData.error}</p>}
      </section>
    </>
  );
}
