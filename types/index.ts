export type VenueStage =
  | "discovered"
  | "contacted"
  | "responded"
  | "negotiating"
  | "booked"
  | "dormant";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type InteractionType = "email" | "call" | "in_person" | "note";

export interface Zone {
  id: string;
  user_id: string;
  name: string;
  zip_code: string | null;
  radius_mi: number;
  created_at: string;
}

export interface Venue {
  id: string;
  zone_id: string;
  user_id: string;
  name: string;
  type: string | null;
  city: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  stage: VenueStage;
  confidence: ConfidenceLevel;
  live_music_details: string | null;
  zone_ring: string | null;
  notes: string | null;
  last_contacted_at: string | null;
  follow_up_date: string | null;
  address: string | null;
  gig_time: string | null;
  gig_end_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface Interaction {
  id: string;
  venue_id: string;
  user_id: string;
  type: InteractionType;
  notes: string | null;
  occurred_at: string;
  email_subject: string | null;
  email_body: string | null;
  email_sent: boolean;
  resend_id: string | null;
  created_at: string;
}

export const STAGES: { key: VenueStage; label: string }[] = [
  { key: "discovered", label: "Discovered" },
  { key: "contacted", label: "Contacted" },
  { key: "responded", label: "Responded" },
  { key: "negotiating", label: "Negotiating" },
  { key: "booked", label: "Booked" },
  { key: "dormant", label: "Dormant" },
];

export const STAGE_COLORS: Record<VenueStage, string> = {
  discovered: "bg-slate-100 text-slate-700",
  contacted: "bg-blue-100 text-blue-700",
  responded: "bg-yellow-100 text-yellow-700",
  negotiating: "bg-orange-100 text-orange-700",
  booked: "bg-green-100 text-green-700",
  dormant: "bg-slate-100 text-slate-400",
};

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  HIGH: "bg-green-50 text-green-700 border-green-200",
  MEDIUM: "bg-yellow-50 text-yellow-700 border-yellow-200",
  LOW: "bg-red-50 text-red-700 border-red-200",
};

// ============================================================
// GIGS
// ============================================================

export type GigStatus = "upcoming" | "completed" | "cancelled";

export interface Gig {
  id: string;
  venue_id: string;
  user_id: string;
  date: string;           // YYYY-MM-DD
  start_time: string | null; // HH:MM
  end_time: string | null;   // HH:MM
  notes: string | null;
  status: GigStatus;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ARTIST PROFILE
// ============================================================

export interface Package {
  id: string;
  label: string;
  price_min: number | null;
  price_max: number | null;
  description: string;
  duration: string;
  color: string;
}

export interface VideoSample {
  id: string;
  title: string;
  url: string;
  platform: "youtube" | "spotify" | "other";
}

export interface SocialLinks {
  instagram: string;
  spotify: string;
  youtube: string;
  website: string;
}

export interface ArtistProfile {
  id: string;
  user_id: string;
  display_name: string | null;
  phone: string | null;
  bio: string;
  genres: string[];
  photo_url: string | null;
  social_links: SocialLinks;
  video_samples: VideoSample[];
  packages: Package[];
  created_at: string;
  updated_at: string;
}

// ============================================================
// INVOICES
// ============================================================

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export type PaymentType = "full" | "deposit";

export interface Invoice {
  id: string;
  venue_id: string;
  user_id: string;
  amount_cents: number;
  payment_type: PaymentType;
  event_date: string | null;
  package_label: string | null;
  description: string | null;
  status: InvoiceStatus;
  paid_at: string | null;
  stripe_invoice_id: string | null;
  stripe_invoice_url: string | null;
  created_at: string;
  updated_at: string;
}
