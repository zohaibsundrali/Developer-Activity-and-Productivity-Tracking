"use client";

import { useEffect, useState, useCallback } from "react";
import { Receipt, FileText } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";
import { Button, DataTable } from "@/components/ui";
import {
  ClientPage,
  EmptyState,
  ErrorState,
  StatusBadge,
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

  // Money and dates are right-aligned and tabular so a column of figures lines
  // up on the decimal point; everything else stays left so it reads as text.
  const columns = [
    {
      key: "number",
      header: "Invoice",
      render: (inv) => (
        <span className="font-semibold tabular-nums text-foreground">
          {inv.number || inv.invoice_number || `#${inv.id}`}
        </span>
      ),
    },
    {
      key: "title",
      header: "Description",
      render: (inv) => <span className="text-muted-foreground">{inv.title || "—"}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (inv) => (
        <span className="text-base font-semibold tabular-nums text-foreground">
          {formatMoney(inv.amount, inv.currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (inv) => <StatusBadge status={inv.status} />,
    },
    {
      key: "issued",
      header: "Issued",
      align: "right",
      render: (inv) => (
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {formatDate(inv.issued_at || inv.issue_date || inv.created_at)}
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      align: "right",
      render: (inv) => (
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {formatDate(inv.due_at || inv.due_date)}
        </span>
      ),
    },
    {
      key: "pdf",
      header: <span className="sr-only">Document</span>,
      align: "right",
      width: "1%",
      render: (inv) => {
        const pdfAvailable = Boolean(inv.pdf_url ?? inv.has_pdf ?? true);
        return (
          <Button
            size="sm"
            onClick={() => handleViewPdf(inv)}
            disabled={!pdfAvailable || openingId === inv.id}
            title={pdfAvailable ? "View PDF" : "No PDF available"}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            {openingId === inv.id ? "Opening…" : "View PDF"}
          </Button>
        );
      },
    },
  ];

  if (error) {
    return (
      <ClientPage title="Invoices" description="Your billing history and documents" width="wide">
        <ErrorState message={error} onRetry={load} />
      </ClientPage>
    );
  }

  return (
    <ClientPage title="Invoices" description="Your billing history and documents" width="wide">
      {/* DataTable brings its own card shell, header casing, h-12 rows and
          overflow-x guard — the table markup lives there, not here. */}
      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        keyField="id"
        empty={
          <EmptyState
            icon={Receipt}
            title="No invoices yet"
            message="Invoices issued to you will appear here."
          />
        }
      />
    </ClientPage>
  );
}
