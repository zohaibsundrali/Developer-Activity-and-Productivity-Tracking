import BillingGate from "@/components/billing/BillingGate";

/**
 * The client portal had no layout at all, so it had no gate either — a locked
 * organization's clients kept approving work, commenting and filing support
 * requests as if nothing had happened.
 *
 * A client can never pay the organization's bill, so `canPay` is false and the
 * gate shows the explanatory screen rather than a payment form. The wording is
 * deliberately about the workspace being paused rather than about money: a
 * client is the agency's customer, not ours, and should not be handed the
 * details of somebody else's billing problem.
 */
export default function ClientLayout({ children }) {
  return (
    <div className="min-h-screen overflow-x-hidden font-sans">
      <BillingGate>{children}</BillingGate>
    </div>
  );
}
