"use client";

import { useEffect, useState, useCallback } from "react";
import { Receipt, FileText } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  SectionHeader,
  formatDate,
} from "./ClientShared";

function formatMoney(amount, currency) {
  if (amount == null || amount === "") return "—";
  const num = Number(amount);
  if (isNaN(num)) return String(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency || ""}`.trim();
  }
}

export default function ClientInvoices() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await authFetch("/api/client/invoices");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load invoices.");
        return;
      }
      setItems(Array.isArray(data.invoices) ? data.invoices : Array.isArray(data) ? data : []);
    } catch {
      setError("Something went wrong while loading invoices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleViewPdf = async (invoice) => {
    try {
      setOpeningId(invoice.id);
      const res = await authFetch(`/api/client/invoices/${invoice.id}/pdf`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.url) {
        showError("Unavailable", payload?.error || "No PDF is available for this invoice.");
        return;
      }
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch {
      showError("Unavailable", "Something went wrong. Please try again.");
    } finally {
      setOpeningId(null);
    }
  };

  if (loading) return <Spinner label="Loading invoices…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <SectionHeader title="Invoices" subtitle="Your billing history and documents" />

      {items.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          message="Invoices issued to you will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Number</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Issued</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 text-right font-semibold">PDF</th>
                </tr>
              </thead>
              <tbody>
                {items.map((inv) => {
                  const pdfAvailable = Boolean(inv.pdf_url ?? inv.has_pdf ?? true);
                  return (
                    <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {inv.number || inv.invoice_number || `#${inv.id}`}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.title || "—"}</td>
                      <td className="px-4 py-3 font-medium text-foreground tabular-nums">
                        {formatMoney(inv.amount, inv.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(inv.issued_at || inv.issue_date || inv.created_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(inv.due_at || inv.due_date)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleViewPdf(inv)}
                          disabled={!pdfAvailable || openingId === inv.id}
                          className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                          title={pdfAvailable ? "View PDF" : "No PDF available"}
                        >
                          <FileText className="mr-1.5 h-3.5 w-3.5" />
                          {openingId === inv.id ? "Opening…" : "View PDF"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
