"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview", icon: "⊞" },
  { href: "/jobs", label: "Jobs", icon: "📋" },
  { href: "/artisans", label: "Artisans", icon: "🔧" },
  { href: "/webhooks", label: "Webhooks", icon: "⚡" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <div className="sidebarBrandName">FixFinder</div>
        <div className="sidebarBrandSub">Admin Console</div>
      </div>

      <nav className="sidebarNav">
        <div className="sidebarSection">Navigation</div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`navLink${pathname === item.href ? " navLinkActive" : ""}`}
          >
            <span className="navIcon">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
