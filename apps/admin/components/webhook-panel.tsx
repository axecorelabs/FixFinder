"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type WebhookResult = {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
};

type StatusResponse = {
  customer: WebhookResult;
  artisan: WebhookResult;
};

type AutoSetupResponse = {
  ok: boolean;
  customerWebhookUrl: string;
  artisanWebhookUrl: string;
  error?: string;
};

function WebhookCard({ label, data }: { label: string; data: WebhookResult }) {
  const connected = !!data.url;
  return (
    <div className="card" style={{ padding: "1.25rem" }}>
      <div className="flexBetween" style={{ marginBottom: "0.75rem" }}>
        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{label}</span>
        {connected ? (
          <span className="badge badgeGreen">
            <span className="dot dotGreen" />
            Connected
          </span>
        ) : (
          <span className="badge badgeGray">
            <span className="dot dotGray" />
            Not set
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: "0.4rem" }}>
        <div>
          <span className="textMuted textSm">URL: </span>
          <span className="textSm" style={{ wordBreak: "break-all" }}>
            {data.url || "—"}
          </span>
        </div>
        <div>
          <span className="textMuted textSm">Pending updates: </span>
          <span className="textSm">{data.pending_update_count ?? 0}</span>
        </div>
        {data.last_error_message && (
          <div style={{ marginTop: "0.25rem" }}>
            <span className="badge badgeRed">{data.last_error_message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", padding: "1px 5px", borderRadius: 4, fontSize: "0.8rem", fontFamily: "Menlo, Consolas, monospace" }}>
      {children}
    </code>
  );
}

export function WebhookPanel() {
  const [customerUrl, setCustomerUrl] = useState("");
  const [artisanUrl, setArtisanUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  function clearMessages() {
    setSuccess("");
    setError("");
  }

  async function loadStatus() {
    setLoading(true);
    clearMessages();
    try {
      const res = await fetch(`${API}/admin/webhooks/status`);
      const body = (await res.json()) as StatusResponse | { error?: string };
      if (!res.ok) {
        setError((body as { error?: string }).error ?? "Failed to fetch status.");
      } else {
        setStatus(body as StatusResponse);
      }
    } catch {
      setError("Could not reach API.");
    } finally {
      setLoading(false);
    }
  }

  async function autoSetup() {
    setLoading(true);
    clearMessages();
    try {
      const res = await fetch(`${API}/admin/webhooks/auto-setup`, { method: "POST" });
      const body = (await res.json()) as AutoSetupResponse;
      if (!res.ok) {
        setError(body.error ?? "Auto-setup failed.");
      } else {
        setSuccess(
          `Auto-setup complete.\nCustomer: ${body.customerWebhookUrl}\nArtisan: ${body.artisanWebhookUrl}`
        );
        await loadStatus();
      }
    } catch {
      setError("Network error — could not reach API.");
    } finally {
      setLoading(false);
    }
  }

  async function connect(e: { preventDefault(): void }) {
    e.preventDefault();
    setLoading(true);
    clearMessages();
    try {
      const res = await fetch(`${API}/admin/webhooks/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerWebhookUrl: customerUrl, artisanWebhookUrl: artisanUrl, dropPendingUpdates: false })
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Connection failed.");
      } else {
        setSuccess("Webhooks connected successfully for both bots.");
        await loadStatus();
      }
    } catch {
      setError("Network error — could not reach API.");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    clearMessages();
    try {
      const res = await fetch(`${API}/admin/webhooks/disconnect`, { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Disconnect failed.");
      } else {
        setSuccess("Webhooks removed from both bots.");
        await loadStatus();
      }
    } catch {
      setError("Network error — could not reach API.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem", maxWidth: 760 }}>

      {/* Auto-setup card — shown prominently at the top */}
      <div className="card">
        <div className="cardHeader">
          <div>
            <span className="cardTitle">Auto-Setup from Environment</span>
            <p className="textMuted textSm" style={{ marginTop: "0.2rem" }}>
              Constructs webhook URLs from <Code>PUBLIC_BASE_URL</Code> +{" "}
              <Code>CUSTOMER_BOT_WEBHOOK_PATH</Code> / <Code>ARTISAN_BOT_WEBHOOK_PATH</Code> and
              registers them with Telegram in one click. Also runs automatically on API startup when{" "}
              <Code>PUBLIC_BASE_URL</Code> is set.
            </p>
          </div>
        </div>
        <div className="cardBody">
          <div className="actions">
            <button type="button" className="btnPrimary" onClick={autoSetup} disabled={loading}>
              {loading ? "Running…" : "⚡ Auto-setup webhooks"}
            </button>
          </div>
          {success && (
            <div className="alertSuccess" style={{ marginTop: "1rem", whiteSpace: "pre-line" }}>
              {success}
            </div>
          )}
          {error && (
            <div className="alertError" style={{ marginTop: "1rem" }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Current status */}
      <div className="card">
        <div className="cardHeader">
          <span className="cardTitle">Live Webhook Status</span>
          <button type="button" className="btnSecondary" onClick={loadStatus} disabled={loading}>
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
        <div className="cardBody">
          {status ? (
            <div className="twoCol">
              <WebhookCard label="Customer Bot" data={status.customer} />
              <WebhookCard label="Artisan Bot" data={status.artisan} />
            </div>
          ) : (
            <p className="textMuted textSm">{loading ? "Loading status…" : "Status not loaded."}</p>
          )}
        </div>
      </div>

      {/* Manual connect form */}
      <div className="card">
        <div className="cardHeader">
          <div>
            <span className="cardTitle">Manual Override</span>
            <p className="textMuted textSm" style={{ marginTop: "0.2rem" }}>
              Set custom webhook URLs directly. Use this if your bots are on different domains.
            </p>
          </div>
        </div>
        <div className="cardBody">
          <form onSubmit={connect} className="form">
            <label className="formLabel">
              Customer Bot Webhook URL
              <input
                type="url"
                required
                value={customerUrl}
                onChange={(e) => setCustomerUrl(e.target.value)}
                placeholder="https://your-domain.com/webhooks/customer"
              />
            </label>
            <label className="formLabel">
              Artisan Bot Webhook URL
              <input
                type="url"
                required
                value={artisanUrl}
                onChange={(e) => setArtisanUrl(e.target.value)}
                placeholder="https://your-domain.com/webhooks/artisan"
              />
            </label>

            <div className="actions">
              <button type="submit" className="btnPrimary" disabled={loading}>
                {loading ? "Connecting…" : "Connect webhooks"}
              </button>
              <button type="button" className="btnDanger" onClick={disconnect} disabled={loading}>
                Disconnect webhooks
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Info */}
      <div className="card">
        <div className="cardHeader">
          <span className="cardTitle">Bot Mode Reference</span>
        </div>
        <div className="cardBody" style={{ display: "grid", gap: "0.6rem" }}>
          <p className="textSm" style={{ color: "var(--text-2)", lineHeight: 1.7 }}>
            Webhooks are only needed when running in webhook mode.
            Set <Code>CUSTOMER_BOT_MODE=webhook</Code> and <Code>ARTISAN_BOT_MODE=webhook</Code> in
            your environment. In <strong>polling</strong> mode the bots connect to Telegram directly —
            no public URL required, ideal for local development.
          </p>
          <p className="textSm" style={{ color: "var(--text-2)", lineHeight: 1.7 }}>
            For auto-setup, add <Code>PUBLIC_BASE_URL=https://your-domain.com</Code> to your{" "}
            <Code>.env</Code>. The API will register both webhooks automatically at startup and
            whenever you click Auto-setup above.
          </p>
        </div>
      </div>
    </div>
  );
}
