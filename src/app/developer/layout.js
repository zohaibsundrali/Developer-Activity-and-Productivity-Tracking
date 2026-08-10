import BillingGate from "@/components/billing/BillingGate";

/**
 * The billing gate covers this area too.
 *
 * It was mounted only on /admin at first, which left the lock trivially
 * side-stepped: middleware lets `userType === 'admin'` into /developer, so a
 * locked admin bounced off /admin/dashboard could simply navigate to
 * /developer/dashboard and carry on — as could every developer in the
 * organization, who was never redirected at all.
 *
 * A developer cannot enter a card, so `canPay` is false for them and the gate
 * shows the "ask your owner or admin" screen rather than a dead-end payment
 * form. See the component.
 */
export default function DeveloperLayout({ children }) {
  return (
    <div className="min-h-screen overflow-x-hidden font-sans">
      <BillingGate>{children}</BillingGate>
    </div>
  );
}
