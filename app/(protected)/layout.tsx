import Sidebar, { MobileBottomNav, MobileNotificationBell } from "@/components/layout/Sidebar";

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
      {/* pb-28 clears the taller mobile nav bar (bigger tap targets) plus
          the iPhone home-indicator safe area it now pads itself with */}
      <main className="flex-1 pb-28 md:pb-0 min-w-0">{children}</main>
      {/* Mobile bottom tab bar */}
      <MobileBottomNav />
      {/* Fixed top-right notification bell — every artist page gets it via
          this shared layout, freeing the bottom bar down to 5 tabs (2026-09-25) */}
      <MobileNotificationBell />
    </div>
  );
}
