"use client";

import { FormEvent, useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type WebhookResult = {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
};

type WebhookStatusResponse = {
  customer: WebhookResult;
  artisan: WebhookResult;
};

export function DashboardClient() {
  const [customerWebhookUrl, setCustomerWebhookUrl] = useState("");
  const [artisanWebhookUrl, setArtisanWebhookUrl] = useState("");
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookMessage, setWebhookMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatusResponse | null>(null);

  useEffect(() => {
    refreshWebhookStatus();
  }, []);

  async function refreshWebhookStatus() {
    setWebhookLoading(true);
    setWebhookMessage("");
    setErrorMessage("");

    const response = await fetch(`${API_BASE_URL}/admin/webhooks/status`);
    const body = (await response.json()) as WebhookStatusResponse | { error?: string };

    if (!response.ok) {
      setErrorMessage((body as { error?: string }).error ?? "Failed to fetch webhook status.");
      setWebhookLoading(false);
      return;
    }

    setWebhookStatus(body as WebhookStatusResponse);
    setWebhookMessage("Webhook status refreshed.");
    setWebhookLoading(false);
  }

  async function connectWebhooks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWebhookLoading(true);
    setWebhookMessage("");
    setErrorMessage("");

    const response = await fetch(`${API_BASE_URL}/admin/webhooks/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerWebhookUrl,
        artisanWebhookUrl,
        dropPendingUpdates: false
      })
    });

    const body = (await response.json()) as { error?: string };

    if (!response.ok) {
      setErrorMessage(body.error ?? "Failed to connect webhooks.");
      setWebhookLoading(false);
      return;
    }

    setWebhookMessage("Webhook connection successful for both bots.");
    await refreshWebhookStatus();
    setWebhookLoading(false);
  }

  async function disconnectWebhooks() {
    setWebhookLoading(true);
    setWebhookMessage("");
    setErrorMessage("");

    const response = await fetch(`${API_BASE_URL}/admin/webhooks/disconnect`, {
      method: "POST"
    });

    const body = (await response.json()) as { error?: string };

    if (!response.ok) {
      setErrorMessage(body.error ?? "Failed to disconnect webhooks.");
      setWebhookLoading(false);
      return;
    }

    setWebhookMessage("Webhook disconnected for both bots.");
    await refreshWebhookStatus();
    setWebhookLoading(false);
  }

  return (
    <>
      <section className="dashboardGrid">
        <article className="panel">
          <h2>Overview</h2>
          <p>
            FixFinder is designed so artisan registration is handled by the Telegram artisan bot.
            The admin dashboard is for monitoring bot health, managing webhook connectivity, and
            validating runtime status.
          </p>
          <ul>
            <li><strong>Customer bot</strong>: receives jobs from customers.</li>
            <li><strong>Artisan bot</strong>: gathers artisan signups and availability.</li>
            <li><strong>Admin role</strong>: manage webhook endpoints and monitor delivery state.</li>
          </ul>
        </article>
        <article className="panel">
          <h2>System status</h2>
          <p>
            <strong>API base URL:</strong> {API_BASE_URL}
          </p>
          <p>
            <strong>Webhook status:</strong> {webhookStatus ? "Loaded" : "Not loaded yet"}
          </p>
          <p>
            <strong>Expected flow:</strong> artisans register through Telegram, then bots handle matching.
          </p>
        </article>
      </section>

      <section className="panel">
        <header className="panelHeader">
          <div>
            <h2>Webhook management</h2>
            <p className="muted">
              Connect or disconnect webhook URLs for the bot endpoints. If the bots are in polling mode,
              webhook connectivity is not required.
            </p>
          </div>
          <button type="button" onClick={refreshWebhookStatus} disabled={webhookLoading}>
            {webhookLoading ? "Refreshing..." : "Refresh status"}
          </button>
        </header>

        <form onSubmit={connectWebhooks} className="form">
          <label>
            Customer bot webhook URL
            <input
              type="url"
              required
              value={customerWebhookUrl}
              onChange={(event) => setCustomerWebhookUrl(event.target.value)}
              placeholder="https://your-domain.com/webhooks/customer"
            />
          </label>

          <label>
            Artisan bot webhook URL
            <input
              type="url"
              required
              value={artisanWebhookUrl}
              onChange={(event) => setArtisanWebhookUrl(event.target.value)}
              placeholder="https://your-domain.com/webhooks/artisan"
            />
          </label>

          <div className="actions">
            <button type="submit" disabled={webhookLoading}>
              {webhookLoading ? "Connecting..." : "Connect webhooks"}
            </button>
            <button type="button" className="secondary" onClick={disconnectWebhooks} disabled={webhookLoading}>
              Disconnect webhooks
            </button>
          </div>
        </form>

        {webhookMessage ? <p className="message">{webhookMessage}</p> : null}
        {errorMessage ? <p className="error">{errorMessage}</p> : null}

        {webhookStatus ? (
          <section className="statusGrid">
            <article>
              <h3>Customer bot</h3>
              <p>URL: {webhookStatus.customer.url || "Not connected"}</p>
              <p>Pending updates: {webhookStatus.customer.pending_update_count ?? 0}</p>
              <p>Error: {webhookStatus.customer.last_error_message || "None"}</p>
            </article>
            <article>
              <h3>Artisan bot</h3>
              <p>URL: {webhookStatus.artisan.url || "Not connected"}</p>
              <p>Pending updates: {webhookStatus.artisan.pending_update_count ?? 0}</p>
              <p>Error: {webhookStatus.artisan.last_error_message || "None"}</p>
            </article>
          </section>
        ) : null}
      </section>
    </>
  );
}
