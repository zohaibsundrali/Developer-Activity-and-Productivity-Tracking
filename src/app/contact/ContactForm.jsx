'use client';
import { useState } from 'react';

export default function ContactForm() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (status === 'sending') return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setStatus('sending');
    setError('');
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not send your request. Please try again.');
      setStatus('sent');
    } catch (error) { setError(error.message); setStatus('idle'); }
  }
  if (status === 'sent') return <div role="status" className="rounded-2xl border border-border bg-accent p-8"><h2 className="text-2xl font-semibold">Your request is on its way.</h2><p className="mt-3 leading-relaxed">Thanks for telling us about your team. We’ll reply to the email you provided.</p></div>;
  return <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
    {[['name', 'Full name', 'text', 'name', 120], ['email', 'Work email', 'email', 'email', 254], ['company', 'Company', 'text', 'organization', 200]].map(([name, label, type, autoComplete, maxLength]) => <div key={name}><label htmlFor={`contact-${name}`} className="mb-2 block text-sm font-medium">{label}</label><input id={`contact-${name}`} name={name} type={type} autoComplete={autoComplete} maxLength={maxLength} required disabled={status === 'sending'} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>)}
    <div><label htmlFor="contact-message" className="mb-2 block text-sm font-medium">What would you like to explore?</label><textarea id="contact-message" name="message" rows={4} maxLength={3000} required disabled={status === 'sending'} placeholder="Tell us about your team size, workflow and what you’d like to see in a demo." className="w-full rounded-lg border border-input bg-background p-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button disabled={status === 'sending'} className="min-h-12 w-full rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">{status === 'sending' ? 'Sending…' : 'Request a demo'}</button>
    <p className="text-xs leading-relaxed text-muted-foreground">We’ll use these details to respond to your request.</p>
  </form>;
}
