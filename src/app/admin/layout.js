import BillingGate from "@/components/billing/BillingGate";

/**
 * The gate is mounted here, once, rather than on each admin screen — a check
 * that every page has to remember is a check that a new page forgets.
 *
 * It exempts /admin/registration (no session yet) and /admin/upgrade (where it
 * sends people), and it fails open on every error. See the component.
 */
export default function AdminLayout({ children }) {
  return (
    <div className="min-h-screen overflow-x-hidden font-sans">
      <BillingGate>{children}</BillingGate>
    </div>
  );
}
