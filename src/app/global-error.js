'use client';

import { useEffect } from 'react';
import { reportError } from '@/utils/logger';

/**
 * Last-resort App Router boundary: catches errors thrown in the root layout
 * itself, where app/error.js cannot render. It must supply its own
 * <html>/<body> because the root layout failed.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    reportError(error, { boundary: 'app/global-error.js', fatal: true });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            background: '#f9fafb',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '28rem',
              width: '100%',
              textAlign: 'center',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '24px',
            }}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
              Application error
            </h2>
            <p style={{ fontSize: '14px', color: '#4b5563', marginBottom: '16px' }}>
              The application failed to load. The error has been logged.
            </p>
            {error?.digest ? (
              <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '16px' }}>
                Reference: {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: '#111827',
                color: '#fff',
                border: 0,
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
