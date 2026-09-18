"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { subscribeAlerts, getAlerts, getServerAlerts, dismissAlert } from "@/utils/alerts";

const icons = {
  success: [CheckCircle2, "text-success"],
  error: [AlertCircle, "text-destructive"],
  warning: [AlertTriangle, "text-warning"],
  info: [Info, "text-primary"],
};

function Toast({ alert }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [Icon, color] = icons[alert.icon] || icons.info;
  // Errors and detailed reports stay until dismissed. Hover/focus pauses others.
  useEffect(() => {
    if (hovered || focused || alert.pre || alert.icon === "error") return;
    const timer = setTimeout(() => dismissAlert(alert.id), 7000);
    return () => clearTimeout(timer);
  }, [alert.id, alert.pre, alert.icon, hovered, focused]);

  return (
    <div
      role={alert.icon === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className="pointer-events-auto flex gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg"
    >
      <Icon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{alert.title}</p>
        {alert.text && <p className="mt-1 max-h-52 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{alert.text}</p>}
      </div>
      <button type="button" aria-label={`Dismiss ${alert.title}`} onClick={() => dismissAlert(alert.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function AlertsViewport() {
  const alerts = useSyncExternalStore(subscribeAlerts, getAlerts, getServerAlerts);
  const confirmation = alerts.find((alert) => alert.confirmation);
  return (
    <>
      <section aria-label="Notifications" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm flex-col gap-3 overflow-y-auto">
        {alerts.filter((alert) => !alert.confirmation).slice(0, 4).map((alert) => <Toast key={alert.id} alert={alert} />)}
      </section>
      {confirmation && (
        <Modal key={confirmation.id} open title={confirmation.title} onClose={() => dismissAlert(confirmation.id)} size="sm" className="max-h-[85dvh]" overlayClassName="z-[110]" footer={
          <>
            <Button variant="outline" onClick={() => dismissAlert(confirmation.id)}>{confirmation.cancelButtonText || "Cancel"}</Button>
            <Button variant={confirmation.destructive ? "destructive" : "default"} onClick={() => dismissAlert(confirmation.id, true)}>{confirmation.confirmButtonText || "Confirm"}</Button>
          </>
        }>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{confirmation.text}</p>
        </Modal>
      )}
    </>
  );
}
