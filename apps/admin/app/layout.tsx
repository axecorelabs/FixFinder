import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "FixFinder Admin",
  description: "Admin dashboard for FixFinder operations"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
