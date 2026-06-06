import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type Stats = {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  totalArtisans: number;
  availableArtisans: number;
  pendingOffers: number;
};

type Job = {
  id: string;
  customerName: string;
  aiCategory: string;
  aiSummary: string | null;
  status: string;
  createdAt: string;
};

async function fetchStats(): Promise<Stats | null> {
  try {
    const res = await fetch(`${API}/admin/stats`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Stats) : null;
  } catch {
    return null;
  }
}

async function fetchRecentJobs(): Promise<Job[]> {
  try {
    const res = await fetch(`${API}/admin/jobs?limit=8`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { jobs: Job[] };
    return data.jobs;
  } catch {
    return [];
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    completed: "badgeGreen",
    accepted: "badgeTeal",
    in_progress: "badgeBlue",
    offered: "badgeYellow",
    matching: "badgeYellow",
    canceled: "badgeRed",
    created: "badgeGray",
    collecting_details: "badgeGray"
  };
  return map[status] ?? "badgeGray";
}

export default async function OverviewPage() {
  const authed = await isAdminAuthenticated();
  if (!authed) redirect("/signin");

  const [stats, jobs] = await Promise.all([fetchStats(), fetchRecentJobs()]);

  const STAT_CARDS = [
    { label: "Total Jobs", value: stats?.totalJobs ?? "—", icon: "📋", sub: "all time" },
    { label: "Active Jobs", value: stats?.activeJobs ?? "—", icon: "🔄", sub: "in progress" },
    { label: "Completed", value: stats?.completedJobs ?? "—", icon: "✅", sub: "successfully closed" },
    { label: "Artisans", value: stats?.totalArtisans ?? "—", icon: "👷", sub: "registered" },
    { label: "Available Now", value: stats?.availableArtisans ?? "—", icon: "🟢", sub: "ready to take jobs" },
    { label: "Pending Offers", value: stats?.pendingOffers ?? "—", icon: "⏳", sub: "awaiting response" }
  ];

  return (
    <DashboardShell title="Overview">
      <div className="statsRow">
        {STAT_CARDS.map((card) => (
          <div key={card.label} className="statCard">
            <div className="statHeader">
              <span className="statLabel">{card.label}</span>
              <span className="statIcon">{card.icon}</span>
            </div>
            <div className="statValue">{card.value}</div>
            <div className="statSub">{card.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="cardHeader">
          <span className="cardTitle">Recent Jobs</span>
          <a href="/jobs" className="textSm textMuted" style={{ textDecoration: "none", color: "var(--accent)" }}>
            View all →
          </a>
        </div>
        <div className="tableWrap">
          {jobs.length === 0 ? (
            <div className="emptyState">
              <strong>No jobs yet</strong>
              <p>Jobs submitted by customers will appear here.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Category</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td style={{ fontWeight: 500 }}>{job.customerName}</td>
                    <td>
                      <span className={`badge badgeTeal`}>{job.aiCategory}</span>
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      <span className="textMuted">{job.aiSummary ?? "—"}</span>
                    </td>
                    <td>
                      <span className={`badge ${statusBadge(job.status)}`}>{job.status.replace("_", " ")}</span>
                    </td>
                    <td className="tableMono">{new Date(job.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
