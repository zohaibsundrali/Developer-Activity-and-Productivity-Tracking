/** Server-side request deadline, retained while fetch consumes response bodies.
 * Aborting a response does not establish that its remote write rolled back. */
export function fetchWithDeadline(timeoutMs, fetcher = (...args) => fetch(...args)) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) {
    throw new RangeError('Request deadline must be between 1 and 60000 milliseconds');
  }
  return (input, options = {}) => {
    const callerSignal = options.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    return fetcher(input, { ...options, signal });
  };
}
