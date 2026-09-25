import { sendEmail, isValidEmail } from '@/utils/emailService';
import { clientIp, rateLimited } from '@/utils/rateLimit';

export async function POST(request) {
  if (rateLimited(`sales:${clientIp(request)}`, { max: 3 })) {
    return Response.json({ error: 'Too many requests. Please try again in a few minutes.' }, { status: 429 });
  }
  const raw = await request.text();
  if (raw.length > 12000) return Response.json({ error: 'Please shorten your message.' }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  const fields = ['name', 'email', 'company', 'message'];
  if (!body || fields.some((key) => typeof body[key] !== 'string' || !body[key].trim()) ||
    body.name.length > 120 || body.company.length > 200 || body.email.length > 254 ||
    body.message.length > 3000 || !isValidEmail(body.email.trim())) {
    return Response.json({ error: 'Enter your name, company, valid email and a message of up to 3,000 characters.' }, { status: 400 });
  }
  // Fixed, operator-owned recipient; visitors cannot use this as an email relay.
  const recipient = process.env.SALES_CONTACT_EMAIL || process.env.GMAIL_EMAIL;
  if (!recipient || !isValidEmail(recipient)) return Response.json({ error: 'Demo requests are temporarily unavailable. Please try again later.' }, { status: 503 });
  const escape = (value) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = `Verisade demo request\n\nName: ${body.name.trim()}\nEmail: ${body.email.trim()}\nCompany: ${body.company.trim()}\n\n${body.message.trim()}`;
  const result = await sendEmail({ to: recipient, subject: 'Verisade — new demo request', text, html: `<pre>${escape(text)}</pre>` });
  if (!result.delivered) return Response.json({ error: 'We could not send your request. Please try again later.' }, { status: 503 });
  return Response.json({ success: true });
}
