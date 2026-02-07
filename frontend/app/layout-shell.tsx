"use client";
import { usePathname } from "next/navigation";
import Sidebar from "./sidebar";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  if (isLanding) {
    return <main className="h-screen overflow-y-auto">{children}</main>;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
