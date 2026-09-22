import BillingGate from "@/components/billing/BillingGate";

export default function OrganizationLayout({ children }) {
  return <BillingGate>{children}</BillingGate>;
}
