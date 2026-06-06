import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type Artisan = {
  id: string;
  name: string;
  phone: string;
  skillType: string;
  serviceArea: string;
  ratingAvg: number;
  availableNow: boolean;
  activeStatus: boolean;
  createdAt: string;
};

async function fetchArtisans(): Promise<Artisan[]> {
  try {
    const res = await fetch(`${API}/admin/artisans`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { artisans: Artisan[] };
    return data.artisans;
  } catch {
    return [];
  }
}

function skillBadge(skill: string) {
  const map: Record<string, string> = {
    hvac: "badgeBlue",
    plumbing: "badgeTeal",
    electrical: "badgeYellow",
    general: "badgeGray"
  };
  return map[skill] ?? "badgeGray";
}

function StarRating({ value }: { value: number }) {
  const score = Math.round(Number(value) * 10) / 10;
  const stars = Math.round(score);
  return (
    <span title={`${score}/5`}>
      {"★".repeat(stars)}{"☆".repeat(5 - stars)}
      <span className="textMuted" style={{ marginLeft: 4 }}>{score}</span>
    </span>
  );
}

export default async function ArtisansPage() {
  const authed = await isAdminAuthenticated();
  if (!authed) redirect("/signin");

  const artisans = await fetchArtisans();
  const available = artisans.filter((a) => a.availableNow && a.activeStatus).length;

  return (
    <DashboardShell title="Artisans">
      <div className="statsRow" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", maxWidth: 560 }}>
        <div className="statCard">
          <div className="statHeader">
            <span className="statLabel">Total</span>
            <span className="statIcon">👷</span>
          </div>
          <div className="statValue">{artisans.length}</div>
          <div className="statSub">registered artisans</div>
        </div>
        <div className="statCard">
          <div className="statHeader">
            <span className="statLabel">Available</span>
            <span className="statIcon">🟢</span>
          </div>
          <div className="statValue">{available}</div>
          <div className="statSub">ready right now</div>
        </div>
        <div className="statCard">
          <div className="statHeader">
            <span className="statLabel">Offline</span>
            <span className="statIcon">⚫</span>
          </div>
          <div className="statValue">{artisans.length - available}</div>
          <div className="statSub">unavailable or inactive</div>
        </div>
      </div>

      <div className="card">
        <div className="cardHeader">
          <span className="cardTitle">Registered Artisans</span>
          <span className="cardMeta">{artisans.length} total</span>
        </div>
        <div className="tableWrap">
          {artisans.length === 0 ? (
            <div className="emptyState">
              <strong>No artisans yet</strong>
              <p>Artisans register via the Artisan Telegram bot.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Skill</th>
                  <th>Service Area</th>
                  <th>Rating</th>
                  <th>Status</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {artisans.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{a.name}</td>
                    <td className="tableMono">{a.phone}</td>
                    <td>
                      <span className={`badge ${skillBadge(a.skillType)}`}>{a.skillType}</span>
                    </td>
                    <td>{a.serviceArea}</td>
                    <td>
                      <StarRating value={a.ratingAvg} />
                    </td>
                    <td>
                      {a.activeStatus && a.availableNow ? (
                        <span className="badge badgeGreen">
                          <span className="dot dotGreen" />
                          Available
                        </span>
                      ) : !a.activeStatus ? (
                        <span className="badge badgeRed">
                          <span className="dot dotRed" />
                          Inactive
                        </span>
                      ) : (
                        <span className="badge badgeGray">
                          <span className="dot dotGray" />
                          Offline
                        </span>
                      )}
                    </td>
                    <td className="tableMono">
                      {new Date(a.createdAt).toLocaleDateString("en-GB", {
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
