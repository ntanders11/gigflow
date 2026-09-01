export type VenueStage =
  | "discovered"
  | "contacted"
  | "responded"
  | "negotiating"
  | "booked"
  | "dormant";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type InteractionType = "email" | "call" | "in_person" | "note" | "reply" | "follow_up";

export type EmailProvider = "gmail" | "outlook";
export type EmailConnectionStatus = "active" | "needs_reconnect";

export interface EmailConnection {
  provider: EmailProvider;
  connected_email: string;
  status: EmailConnectionStatus;
}

export interface OutreachInfo {
  count: number;
  lastDate: string | null;
  lastFollowUpDate: string | null;
}

export interface Zone {
  id: string;
  user_id: string;
  name: string;
  zip_code: string | null;
  radius_mi: number;
  lat: number | null;
  lon: number | null;
  geocode_failed: boolean;
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
  venue_profile_id: string | null;
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
  sent_via: "resend" | "gmail" | "outlook" | null;
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
  checklist: string[];    // array of completed checklist item IDs
  status: GigStatus;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ARTIST BLACKOUT DATES
// ============================================================

// A date range an artist has marked themselves unavailable for. Client
// shape only — deliberately omits user_id/created_at/updated_at, which
// no consumer of this type needs.
export interface BlackoutDate {
  id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  note: string | null;
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
  contact_email: string | null;
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

// ============================================================
// VENUE PROFILES
// ============================================================

export interface VenueProfile {
  id: string;
  user_id: string;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  venue_type: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  description: string | null;
  genres: string[];
  stage_equipment: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

// A single candidate result from the venue-signup search — either an
// unclaimed match pulled from some artist's private pipeline, or an
// already-claimed venue_profiles row (surfaced so the search can say
// "taken" instead of offering it as claimable).
export interface VenueMatchCandidate {
  name: string;
  city: string | null;
  address: string | null;
  venue_type: string | null;
  status: "claimable" | "taken";
}

// ============================================================
// MUTUAL RATINGS
// ============================================================

// The raw shape of a venue_artist_ratings row as stored — used only
// server-side. API responses never send this shape directly to a
// client; they shape it into RatingView (below) so an unrevealed
// half is never even present in the JSON, not just hidden in the UI.
export interface VenueArtistRatingRow {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  qualifying_gig_id: string | null;
  venue_stars: number | null;
  venue_review: string | null;
  venue_rated_at: string | null;
  artist_stars: number | null;
  artist_review: string | null;
  artist_rated_at: string | null;
  featured_by_artist_rank: number | null;
  featured_by_venue_rank: number | null;
  created_at: string;
  updated_at: string;
}

// What an API route actually returns to a client — always includes the
// caller's own half, includes the counterpart's half only if `revealed`.
export interface RatingView {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  revealed: boolean;
  my_stars: number;
  my_review: string | null;
  their_stars: number | null;
  their_review: string | null;
  featured_rank: number | null;
  counterpart_name: string;
  counterpart_photo_url: string | null;
}

export interface PendingRating {
  venue_profile_id?: string;   // present on the artist's pending list
  artist_user_id?: string;     // present on the venue's pending list
  counterpart_name: string;
  counterpart_photo_url: string | null;
  qualifying_gig_id: string;
  qualifying_gig_date: string;
}

export interface PublicRatingsResponse {
  average: number | null;
  count: number;
  reviews: {
    reviewer_id: string;
    reviewer_name: string;
    reviewer_photo_url: string | null;
    stars: number;
    review: string | null;
  }[];
}

// ============================================================
// BOOKING REQUESTS
// ============================================================

export type BookingRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

// The raw shape of a booking_requests row as stored — server-side only.
export interface BookingRequestRow {
  id: string;
  venue_profile_id: string;
  artist_user_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
  status: BookingRequestStatus;
  cancelled_by: "artist" | "venue" | null;
  gig_id: string | null;
  created_at: string;
  updated_at: string;
}

// What the artist's pending-list endpoint returns per request.
export interface PendingBookingRequest {
  id: string;
  venue_name: string;
  venue_photo_url: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
}

// What the venue's sent-requests endpoint returns per request.
export interface VenueBookingRequestView {
  id: string;
  artist_name: string;
  artist_photo_url: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  message: string | null;
  status: BookingRequestStatus;
  cancelled_by: "artist" | "venue" | null;
}

// ============================================================
// NOTIFICATIONS
// ============================================================

export type NotificationType =
  | "booking_request_received"
  | "booking_request_accepted"
  | "booking_request_declined"
  | "booking_cancelled_by_venue"
  | "booking_cancelled_by_artist"
  | "booking_rescheduled"
  | "rating_available"
  | "rating_revealed"
  | "follow_up_sent";

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string;
  read: boolean;
  created_at: string;
}
