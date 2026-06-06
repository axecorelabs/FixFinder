import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type Job = {
  id: string;
  customerName: string;
  customerPhone: string;
  aiCategory: string;
  aiSummary: string | null;
  status: string;
  createdAt: string;
};

async function fetchJobs(): Promise<{ jobs: Job[]; total: number }> {
  try {
    const res = await fetch(`${API}/admin/jobs?limit=50`, { cache: "no-store" });
    if (!res.ok) return { jobs: [], total: 0 };
    return (await res.json()) as { jobs: Job[]; total: number };
  } catch {
    return { jobs: [], total: 0 };
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

function categoryBadge(cat: string) {
  const map: Record<string, string> = {
    hvac: "badgeBlue",
    plumbing: "badgeTeal",
    electrical: "badgeYellow",
    general: "badgeGray"
  };
  return map[cat] ?? "badgeGray";
}

export default async function JobsPage() {
  const authed = await isAdminAuthenticated();
  if (!authed) redirect("/signin");

  const { jobs, total } = await fetchJobs();

  return (
    <DashboardShell title="Jobs">
      <div className="card">
        <div className="cardHeader">
          <span className="cardTitle">All Jobs</span>
          <span className="cardMeta">{total} total</span>
        </div>
        <div className="tableWrap">
          {jobs.length === 0 ? (
            <div className="emptyState">
              <strong>No jobs yet</strong>
              <p>Customer job requests will appear here once submitted.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Category</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="tableMono">{job.id.slice(0, 8)}…</td>
                    <td style={{ fontWeight: 500 }}>{job.customerName}</td>
                    <td className="tableMono">{job.customerPhone}</td>
                    <td>
                      <span className={`badge ${categoryBadge(job.aiCategory)}`}>{job.aiCategory}</span>
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      <span className="textMuted">{job.aiSummary ?? "—"}</span>
                    </td>
                    <td>
                      <span className={`badge ${statusBadge(job.status)}`}>{job.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="tableMono">
                      {new Date(job.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric"
                      })}
                    </td>
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
