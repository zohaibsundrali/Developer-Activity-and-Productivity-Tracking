import SiteNav from '@/components/landing/SiteNav';
import SiteFooter from '@/components/landing/SiteFooter';
import ContactForm from './ContactForm';
import styles from '../landing.module.css';

export const metadata = { title: 'Talk to Sales', description: 'Explore Verisade for your team. Tell us about your workflow and request a demo.' };
export default function ContactPage() {
  return <div className={`${styles.page} min-h-screen bg-background text-foreground`}><SiteNav homeLinks /><main className="mx-auto grid max-w-6xl items-start gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24"><div><p className="text-xs font-semibold uppercase tracking-widest">Let’s talk about your team</p><h1 className="mt-5 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Big plans deserve a clear next step.</h1><p className="mt-6 text-lg leading-relaxed text-muted-foreground">See how Verisade brings your projects, people and workday insights together. Tell us what your team needs and let’s explore the right fit.</p><p className="mt-8 text-sm leading-relaxed text-muted-foreground">Interested in Enterprise? Share your team size and the workflows you’d like to cover in a demo.</p></div><ContactForm /></main><SiteFooter homeLinks /></div>;
}
