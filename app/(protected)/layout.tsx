import Sidebar from "@/components/layout/Sidebar";
import { MobileBottomNav } from "@/components/layout/Sidebar";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar — hidden on mobile, visible on md+ */}
      <div className="hidden md:block sticky top-0 h-screen self-start">
        <Sidebar />
      </div>
      {/* Main content — full width on mobile, flex-1 on desktop */}
      <main className="flex-1 pb-20 md:pb-0 min-w-0">{children}</main>
      {/* Mobile bottom tab bar */}
      <MobileBottomNav />
    </div>
  );
}
