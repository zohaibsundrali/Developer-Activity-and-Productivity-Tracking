/** Finalize reserved signup accounts only after Auth exists; no Auth mutation. */
export async function recoverSignups(svc, { limit = 10 } = {}) {
  const { data, error } = await svc.rpc('claim_signup_recovery', { p_limit: limit });
  if (error) throw new Error('Signup recovery lookup unavailable');
  let completed = 0;
  const errors = [];
  for (const attempt of data || []) {
    try {
      const result = await svc.rpc('finish_signup', { p_id: attempt.id, p_claim: attempt.claim_id });
      if (result.error || !result.data?.success) throw new Error('Signup finalization unavailable');
      completed += 1;
    } catch {
      errors.push({ signupId: attempt.id, message: 'Signup finalization unavailable' });
      // Retain the lease for bounded backoff; subsequent runs retry safely.
    }
  }
  return { completed, errors };
}
