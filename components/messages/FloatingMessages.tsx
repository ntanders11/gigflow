"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import MailIcon from "@/components/messages/MailIcon";
import { UnreadBadge, useUnreadMessages } from "@/components/messages/UnreadMessages";

// The envelope that floats beside the notification bell on phones, so the
// artist side's Messages are one tap away without adding a sixth bottom tab.
// Styled to match FloatingBell and sits just left of it (bell: right 12px,
// 42px wide, so this starts 8px further in).
export default function FloatingMessages() {
  const pathname = usePathname();
  const unread = useUnreadMessages(pathname);

  return (
    <Link
      href="/messages"
      aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
      className="md:hidden fixed z-50 rounded-full flex items-center justify-center"
      style={{
        top: "calc(13px + var(--app-top-inset))",
        right: "62px",
        width: "42px",
        height: "42px",
        backgroundColor: "#262b33",
        border: "1px solid rgba(255,255,255,0.22)",
        boxShadow: "0 2px 10px rgba(0,0,0,0.55)",
        color: pathname.startsWith("/messages") ? "#D4A64F" : "#F4E8D2",
      }}
    >
      <MailIcon size={19} />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1">
          <UnreadBadge count={unread} />
        </span>
      )}
    </Link>
  );
}
