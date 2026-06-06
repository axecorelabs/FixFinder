import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { SignOutButton } from "./sign-out-button";

export function DashboardShell({
  title,
  actions,
  children
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <span className="topbarTitle">{title}</span>
          <div className="topbarRight">
            {actions}
            <SignOutButton />
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
