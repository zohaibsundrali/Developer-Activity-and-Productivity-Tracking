/** In-flight notification work belongs to one organization and typed profile. */
export function createNotificationRequestGuard() {
  let identity;
  let generation = 0;
  let active = true;
  return {
    enter(nextIdentity) {
      if (identity !== nextIdentity) { identity = nextIdentity; generation += 1; }
      return generation;
    },
    isCurrent(ticket) { return active && ticket === generation; },
    activate() { active = true; },
    deactivate() { active = false; },
  };
}
