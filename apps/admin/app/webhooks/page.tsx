import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WebhookPanel } from "@/components/webhook-panel";

export default async function WebhooksPage() {
  const authed = await isAdminAuthenticated();
  if (!authed) redirect("/signin");

  return (
    <DashboardShell title="Webhooks">
      <WebhookPanel />
    </DashboardShell>
  );
}
