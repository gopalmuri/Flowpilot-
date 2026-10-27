/** Click-to-fill ideas shown under the "What do you want to automate?" box. */
export const EXAMPLE_PROMPTS: string[] = [
  'When a new lead comes in, sort it by size and tell the sales team on Slack',
  'Draft a reply to every customer email and ask me to approve it before it is sent',
  'Pull the name, company and amount out of each invoice request and ask a manager to approve it',
  'Alert the team if a support request sounds urgent',
  'Check that every sign-up has an email address and add it to the CRM',
];

/** One-line starters: a short label to show, the full request to send. */
export const EXAMPLE_IDEAS: { label: string; prompt: string }[] = [
  { label: 'Follow up new leads', prompt: EXAMPLE_PROMPTS[0] },
  { label: 'Reply to customer emails', prompt: EXAMPLE_PROMPTS[1] },
  { label: 'Approve invoices', prompt: EXAMPLE_PROMPTS[2] },
  { label: 'Alert on urgent requests', prompt: EXAMPLE_PROMPTS[3] },
];
