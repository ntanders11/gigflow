import ArtistTopNav from "@/components/layout/ArtistTopNav";
import { MobileBottomNav, MobileNotificationBell } from "@/components/layout/MobileNav";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      {/* Desktop top tab bar — hidden on mobile (it hides itself below md) */}
      <ArtistTopNav />
      {/* pb-28 clears the taller mobile nav bar (bigger tap targets) plus
          the iPhone home-indicator safe area it now pads itself with */}
      <main className="pb-28 md:pb-0 min-w-0">{children}</main>
      {/* Mobile bottom tab bar */}
      <MobileBottomNav />
      {/* Fixed top-right notification bell — every artist page gets it via
          this shared layout, freeing the bottom bar down to 5 tabs (2026-09-25) */}
      <MobileNotificationBell />
    </div>
  );
}
