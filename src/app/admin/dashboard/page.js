import { redirect } from "next/navigation";

export default async function LegacyDashboard({ searchParams }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams || {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item != null) query.append(key, item);
    }
  }
  redirect(`/organization/dashboard${query.size ? `?${query}` : ""}`);
}
