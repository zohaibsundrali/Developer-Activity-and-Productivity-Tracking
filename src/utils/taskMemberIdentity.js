/** Typed collaborator names; untyped mentions are usable only when unique. */
export function indexTaskMembers(members = []) {
  const byIdentity = new Map();
  const byId = new Map();
  const ambiguous = new Set();
  for (const member of members || []) {
    if (member?.userId == null) continue;
    const id = String(member.userId);
    const key = `${member.userType}:${id}`;
    byIdentity.set(key, member);
    if (ambiguous.has(id)) continue;
    if (byId.has(id) && byId.get(id).userType !== member.userType) {
      ambiguous.add(id); byId.delete(id);
    } else byId.set(id, member);
  }
  return { byIdentity, byId };
}
