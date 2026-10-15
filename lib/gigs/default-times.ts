// Where every time box in the app starts: 7:00 PM to 9:00 PM.
//
// A blank native <input type="time"> can silently keep reporting an empty
// value in Safari until every segment (hour, minute, AM/PM) has been
// explicitly set by the user — if any segment is left on its placeholder,
// .value stays "" even though the field looks filled in. Starting on an
// already-complete time (rather than blank) means there's no "partially set"
// state: the person can accept the default or change just the hour/minutes,
// and AM/PM is already right (evening, since nearly every gig is).
// Shared by the artist gig form, the venue booking edit/Book Again forms, and
// the venue's Request to Book form so they can never drift apart.
export const DEFAULT_START_TIME = "19:00";
export const DEFAULT_END_TIME = "21:00";
