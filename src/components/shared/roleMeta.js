import {
  Crown,
  ShieldCheck,
  Briefcase,
  UserCog,
  Wallet,
  Users,
  ClipboardCheck,
  Code2,
  Palette,
  Server,
  User,
  UserCircle,
} from "lucide-react";

import { ROLES } from "@/utils/roles";

/**
 * How a role LOOKS. One definition, shared by every screen that draws one.
 *
 * This lived inside EmployeeDirectory. The moment a second screen needed the
 * same icons and badge variants — the team-structure view — copying it would
 * have produced two maps that drift, which is the exact failure this codebase
 * keeps finding: `designer`, `qa` and `finance` were missing from the badge
 * map for weeks after migration 058 added them, so three real roles rendered
 * as if the product had never heard of them.
 *
 * The role VOCABULARY itself stays in utils/roles.js, which is pure and has no
 * icon dependency so the server can import it. This file is presentation only
 * and must never be imported by an API route.
 */

/**
 * role → Badge variant. Never colour alone: every badge carries its label too.
 *
 * `qa`, `developer` and `designer` share a variant on purpose — they are the
 * people doing the work, they rank the same (see ROLE_RANK), and inventing
 * three tints to separate them would spend the palette on a distinction the
 * product does not make.
 */
export const ROLE_VARIANTS = {
  owner: "default",
  admin: "info",
  manager: "secondary",
  hr: "secondary",
  finance: "secondary",
  team_lead: "secondary",
  qa: "success",
  developer: "success",
  designer: "success",
  devops: "success",
  employee: "outline",
  client: "outline",
};

export function roleVariant(role) {
  return ROLE_VARIANTS[role] || "outline";
}

/**
 * role → icon, singular name, and plural.
 *
 * `plural` is for headcounts ("3 Designers"); `label` for naming one person's
 * role. HR and QA are initialisms and are the same either way, which is why
 * they are spelled out here rather than derived by adding an "s".
 */
export const ROLE_META = {
  owner: { icon: Crown, label: "Owner", plural: "Owners" },
  admin: { icon: ShieldCheck, label: "Admin", plural: "Admins" },
  manager: { icon: Briefcase, label: "Manager", plural: "Managers" },
  hr: { icon: UserCog, label: "HR", plural: "HR" },
  finance: { icon: Wallet, label: "Finance", plural: "Finance" },
  team_lead: { icon: Users, label: "Team Lead", plural: "Team Leads" },
  qa: { icon: ClipboardCheck, label: "QA", plural: "QA" },
  developer: { icon: Code2, label: "Developer", plural: "Developers" },
  designer: { icon: Palette, label: "Designer", plural: "Designers" },
  devops: { icon: Server, label: "DevOps", plural: "DevOps" },
  employee: { icon: User, label: "Employee", plural: "Employees" },
  client: { icon: UserCircle, label: "Client", plural: "Clients" },
};

/** snake_case → "Team Lead", for a role this file has never heard of. */
export const prettyRole = (role) =>
  String(role || "")
    .split("_")
    .map((w) => (w[0]?.toUpperCase() || "") + w.slice(1))
    .join(" ");

export const roleIcon = (role) => ROLE_META[role]?.icon || Users;
export const roleLabel = (role) => ROLE_META[role]?.label || prettyRole(role);
export const rolePlural = (role) => ROLE_META[role]?.plural || prettyRole(role);

/**
 * Sort key: highest privilege first, so a list of roles reads the way an org
 * chart does.
 *
 * A role this file has never heard of sorts AFTER the known ones rather than
 * being dropped. An unrecognised role is exactly the thing somebody needs to
 * see — dropping it would hide the one clue that something granted it.
 */
export const roleOrder = (role) => {
  const i = ROLES.indexOf(role);
  return i === -1 ? ROLES.length : i;
};
