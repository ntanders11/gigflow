import Sidebar from "@/components/layout/Sidebar";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <div className="sticky top-0 h-screen self-start">
        <Sidebar />
      </div>
      <main className="flex-1">{children}</main>
    </div>
  );
}
