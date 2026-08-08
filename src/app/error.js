'use client';

import { useEffect } from 'react';
import { reportError, installGlobalErrorHandlers } from '@/utils/logger';

/**
 * App Router error boundary for the root segment.
 *
 * AUDIT (Phase 5): unhandled render/data errors previously produced Next's
 * default screen and were never captured anywhere. This boundary reports them
 * through the logger seam and offers a recovery path.
 */
export default function Error({ error, reset }) {
  useEffect(() => {
    installGlobalErrorHandlers();
    reportError(error, { boundary: 'app/error.js' });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Something went wrong
        </h2>
        <p className="mb-4 text-sm text-gray-600">
          The page could not be displayed. The error has been logged.
        </p>
        {error?.digest ? (
          <p className="mb-4 font-mono text-xs text-gray-400">
            Reference: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
