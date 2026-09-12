/** Reconcile terminal SDK loss without mistaking another tab's broadcast for
 * this tab's logout. Never perform awaited SDK work inside an Auth callback. */
export function observeTerminalAuthLoss(auth, onLoss) {
  let generation = 0;
  let disposed = false;
  let completed = false;
  let timer;
  const { data } = auth.onAuthStateChange((event, session) => {
    if (disposed || completed) return;
    const own = ++generation;
    clearTimeout(timer);
    if (event !== "SIGNED_OUT" && !(event === "INITIAL_SESSION" && !session)) return;
    timer = setTimeout(async () => {
      try {
        const result = await auth.getSession();
        if (disposed || completed || own !== generation || result?.error || result?.data?.session !== null) return;
        completed = true;
        if (await onLoss() === false) completed = false;
      } catch { /* Unavailable session verification is not confirmed logout. */ }
    }, 0);
  });
  return () => { disposed = true; ++generation; clearTimeout(timer); data?.subscription?.unsubscribe(); };
}

export function protectedGateStatus(status, previouslyAllowed) {
  if (status === "denied") return "denied";
  return previouslyAllowed ? "allowed" : status;
}
