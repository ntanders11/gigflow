// Wording for the automatic follow-up email. {venue} is replaced with the
// venue's name; the artist's signature (name, phone, website) is always added
// underneath, so artists only edit the message itself.

export const DEFAULT_FOLLOW_UP_TEMPLATE = `Hi there,

I wanted to follow up on my email from last week about playing at {venue}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Happy to work around your schedule. Thanks for your time!`;

export const MAX_TEMPLATE_LENGTH = 2000;

export function renderFollowUpBody(template: string | null | undefined, venueName: string, signature: string): string {
  const text = (template && template.trim() ? template : DEFAULT_FOLLOW_UP_TEMPLATE)
    .replace(/\{venue\}/gi, venueName)
    .trim();
  return signature ? `${text}\n\n${signature}` : text;
}
