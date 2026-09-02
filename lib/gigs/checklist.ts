// Shared with the gig-reminders cron (app/api/gigs/reminders/route.ts),
// which needs the total item count to say how many prep items are still
// open — pulled out of GigsSection.tsx so the two can't drift apart.
export const CHECKLIST_ITEMS = [
  { id: "load_in",    label: "Load-in time confirmed" },
  { id: "sound_check",label: "Sound check scheduled" },
  { id: "payment",    label: "Deposit / payment arranged" },
  { id: "set_list",   label: "Set list ready" },
  { id: "equipment",  label: "Equipment packed" },
  { id: "parking",    label: "Parking figured out" },
  { id: "contact",    label: "Point of contact confirmed" },
];
