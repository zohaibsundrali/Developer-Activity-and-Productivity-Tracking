"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import {
  loadRules,
  saveRule,
  deleteRule,
  toggleRule,
  TRIGGER_EVENTS,
  ACTION_TYPES,
} from "@/utils/automation";
import { loadEmployees } from "@/utils/employeesData";
import { loadLabels, BOARD_COLUMNS, DRAGGABLE_COLUMNS, PRIORITIES, TASK_TYPES } from "@/utils/pmData";
import { showError, showSuccess } from "@/utils/alerts";
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  X,
  Zap,
  ArrowRight,
  Save,
} from "lucide-react";

/* ---- shared token classes (design system) -------------------------------- */
const INPUT_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const PRIMARY_BTN =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60";
const SECONDARY_BTN =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:border-primary";
const ICON_BTN =
  "rounded-lg border border-border bg-background p-2 text-muted-foreground hover:border-primary";
const PANEL = "rounded-xl border border-border bg-card p-5 shadow-card";
const BADGE = "rounded-full px-2 py-0.5 text-[10px] font-semibold";

/* ---- label helpers ------------------------------------------------------- */
const titleCase = (value) =>
  typeof value === "string" && value ? value.charAt(0).toUpperCase() + value.slice(1) : "";

const statusLabel = (id) => {
  const col = (BOARD_COLUMNS || []).find((c) => c.id === id);
  return col ? col.label : id || "";
};

const eventLabel = (id) => {
  const ev = (TRIGGER_EVENTS || []).find((e) => e.id === id);
  return ev ? ev.label : id || "";
};

const personName = (employees, userId) => {
  if (!userId) return "someone";
  const emp = (employees || []).find((e) => e.userId === userId);
  return emp?.name || "someone";
};

const formatDate = (value) => {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString();
  } catch {
    return "";
  }
};

/* Summary segments: { t: text, s: strong? } */
const seg = (t, s = false) => ({ t, s });

function triggerSegments(trigger) {
  const t = trigger || {};
  const out = [];

  switch (t.event) {
    case "task_created":
      out.push(seg("a task is created", true));
      break;
    case "status_changed":
      out.push(seg("status changes"));
      if (t.from) {
        out.push(seg(" from "));
        out.push(seg(statusLabel(t.from), true));
      }
      if (t.to) {
        out.push(seg(" to "));
        out.push(seg(statusLabel(t.to), true));
      }
      break;
    case "assigned":
      out.push(seg("a task is assigned", true));
      break;
    case "priority_changed":
      out.push(seg("priority changes"));
      if (t.toPriority) {
        out.push(seg(" to "));
        out.push(seg(titleCase(t.toPriority), true));
      }
      break;
    default:
      out.push(seg("no trigger set yet"));
      break;
  }

  if (t.taskType) {
    out.push(seg(" · only "));
    out.push(seg(t.taskType, true));
    out.push(seg(" tasks"));
  }
  if (t.priority) {
    out.push(seg(" · only "));
    out.push(seg(titleCase(t.priority), true));
    out.push(seg(" priority"));
  }
  return out;
}

function actionSegments(action, employees) {
  const a = action || {};
  const out = [];
  switch (a.type) {
    case "assign":
      out.push(seg("assign to "));
      out.push(seg(personName(employees, a.userId), true));
      break;
    case "set_status":
      out.push(seg("set status to "));
      out.push(seg(statusLabel(a.status) || "—", true));
      break;
    case "set_priority":
      out.push(seg("set priority to "));
      out.push(seg(titleCase(a.priority) || "—", true));
      break;
    case "add_label":
      out.push(seg("add label "));
      out.push(seg(a.label || "—", true));
      break;
    case "notify":
      out.push(seg("notify "));
      out.push(seg(a.target === "user" ? personName(employees, a.userId) : "assignee", true));
      break;
    case "email":
      out.push(seg("email "));
      out.push(seg(a.target === "user" ? personName(employees, a.userId) : "assignee", true));
      break;
    default:
      out.push(seg("do nothing"));
      break;
  }
  return out;
}

function summarySegments(rule, employees) {
  const actions = Array.isArray(rule?.actions) ? rule.actions : [];
  const out = [seg("When "), ...triggerSegments(rule?.trigger)];
  out.push(seg(" → "));
  if (!actions.length) {
    out.push(seg("no actions yet"));
    return out;
  }
  actions.forEach((action, i) => {
    if (i > 0) out.push(seg(", "));
    actionSegments(action, employees).forEach((s) => out.push(s));
  });
  return out;
}

/* ---- draft helpers ------------------------------------------------------- */
function defaultAction(type) {
  switch (type) {
    case "assign":
      return { type: "assign", userId: "" };
    case "set_status":
      return { type: "set_status", status: (DRAGGABLE_COLUMNS || [])[0]?.id || "pending" };
    case "set_priority":
      return { type: "set_priority", priority: (PRIORITIES || [])[0] || "low" };
    case "add_label":
      return { type: "add_label", label: "" };
    case "email":
      return { type: "email", target: "assignee", subject: "", message: "" };
    case "notify":
    default:
      return { type: "notify", target: "assignee", title: "", message: "" };
  }
}

function emptyDraft() {
  return {
    id: null,
    name: "",
    enabled: true,
    trigger: { event: "status_changed" },
    actions: [defaultAction("notify")],
  };
}

function draftFromRule(rule) {
  return {
    id: rule?.id || null,
    name: rule?.name || "",
    enabled: rule?.enabled !== false,
    trigger: rule?.trigger && typeof rule.trigger === "object" ? { ...rule.trigger } : {},
    actions: Array.isArray(rule?.actions) ? rule.actions.map((a) => ({ ...a })) : [],
  };
}

/* Strip empty optional keys so the stored JSON stays exactly on-contract. */
function cleanAction(action) {
  const a = action || {};
  switch (a.type) {
    case "assign":
      return { type: "assign", userId: a.userId || null };
    case "set_status":
      return { type: "set_status", status: a.status || null };
    case "set_priority":
      return { type: "set_priority", priority: a.priority || null };
    case "add_label":
      return { type: "add_label", label: a.label || null };
    case "notify": {
      const out = { type: "notify", target: a.target === "user" ? "user" : "assignee" };
      if (out.target === "user" && a.userId) out.userId = a.userId;
      if (a.title) out.title = a.title;
      if (a.message) out.message = a.message;
      return out;
    }
    case "email": {
      const out = { type: "email", target: a.target === "user" ? "user" : "assignee" };
      if (out.target === "user" && a.userId) out.userId = a.userId;
      if (a.subject) out.subject = a.subject;
      if (a.message) out.message = a.message;
      return out;
    }
    default:
      return { type: a.type || "notify" };
  }
}

/* ========================================================================== */
export default function AutomationRules() {
  const [orgId, setOrgId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(""); // "" = org-wide scope
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [rules, setRules] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);

  const [draft, setDraft] = useState(null); // null = editor closed
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  /* ---- projects (self-contained picker) ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingProjects(true);
      const id = getOrgId();
      if (!cancelled) setOrgId(id);
      const runQuery = (withArchived) => {
        let q = supabase.from("projects").select("id, name").eq("organization_id", id);
        if (withArchived) q = q.eq("archived", false);
        return q.order("created_at", { ascending: false });
      };
      try {
        let { data, error } = await runQuery(true);
        if (error) ({ data, error } = await runQuery(false));
        if (cancelled) return;
        setProjects(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) showError("Failed to load projects", err?.message || String(err));
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- rules + supporting data for the chosen scope ---- */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const id = orgId || getOrgId();
      const scoped = projectId || null;
      const [ruleRes, empRes, labelRes] = await Promise.all([
        loadRules(scoped),
        loadEmployees(id),
        loadLabels(scoped),
      ]);
      setRules(Array.isArray(ruleRes) ? ruleRes : []);
      setEmployees(Array.isArray(empRes?.employees) ? empRes.employees : []);

      // Labels are matched by NAME on the task, so de-duplicate across projects.
      const seen = new Set();
      const uniqueLabels = (Array.isArray(labelRes) ? labelRes : []).filter((l) => {
        const name = l?.name;
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      setLabels(uniqueLabels);
    } catch (err) {
      showError("Failed to load automation rules", err?.message || String(err));
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /* ---- mutations ---- */
  const handleToggle = async (rule) => {
    if (!rule?.id) return;
    setBusyId(rule.id);
    try {
      const { error } = await toggleRule(rule.id, !rule.enabled);
      if (error) throw error;
      await reload();
    } catch (err) {
      showError("Could not update rule", err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (rule) => {
    if (!rule?.id) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(`Delete the rule "${rule.name || "Untitled rule"}"? This cannot be undone.`);
      if (!ok) return;
    }
    setBusyId(rule.id);
    try {
      const { error } = await deleteRule(rule.id);
      if (error) throw error;
      if (draft?.id === rule.id) setDraft(null);
      await reload();
      typeof showSuccess === "function" && showSuccess("Rule deleted");
    } catch (err) {
      showError("Could not delete rule", err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    const name = (draft.name || "").trim();
    if (!name || !draft.trigger?.event) {
      showError(
        "Rule incomplete",
        "Give the rule a name and choose a trigger event before saving."
      );
      return;
    }
    setSaving(true);
    try {
      const patch = {
        name,
        enabled: draft.enabled !== false,
        trigger: { ...(draft.trigger || {}) },
        actions: (Array.isArray(draft.actions) ? draft.actions : []).map(cleanAction),
      };
      if (draft.id) patch.id = draft.id;
      const { error } = await saveRule(projectId || null, patch);
      if (error) throw error;
      typeof showSuccess === "function" && showSuccess("Rule saved");
      setDraft(null);
      await reload();
    } catch (err) {
      showError("Could not save rule", err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  /* ---- draft editing ---- */
  const patchDraft = (patch) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const setTriggerKey = (key, value) =>
    setDraft((d) => {
      if (!d) return d;
      const trigger = { ...(d.trigger || {}) };
      if (value === "" || value == null) delete trigger[key];
      else trigger[key] = value;
      return { ...d, trigger };
    });

  const changeEvent = (event) =>
    setDraft((d) => {
      if (!d) return d;
      const trigger = { ...(d.trigger || {}), event };
      if (event !== "status_changed") {
        delete trigger.from;
        delete trigger.to;
      }
      if (event !== "priority_changed") delete trigger.toPriority;
      return { ...d, trigger };
    });

  const patchAction = (index, patch) =>
    setDraft((d) => {
      if (!d) return d;
      const actions = (Array.isArray(d.actions) ? d.actions : []).map((a, i) =>
        i === index ? { ...a, ...patch } : a
      );
      return { ...d, actions };
    });

  const changeActionType = (index, type) =>
    setDraft((d) => {
      if (!d) return d;
      const actions = (Array.isArray(d.actions) ? d.actions : []).map((a, i) =>
        i === index ? defaultAction(type) : a
      );
      return { ...d, actions };
    });

  const addAction = () =>
    setDraft((d) =>
      d
        ? { ...d, actions: [...(Array.isArray(d.actions) ? d.actions : []), { type: "notify", target: "assignee" }] }
        : d
    );

  const removeAction = (index) =>
    setDraft((d) =>
      d
        ? { ...d, actions: (Array.isArray(d.actions) ? d.actions : []).filter((_, i) => i !== index) }
        : d
    );

  /* ---- action row renderer ---- */
  const renderActionFields = (action, index) => {
    const a = action || {};
    switch (a.type) {
      case "assign":
        return (
          <select
            value={a.userId || ""}
            onChange={(e) => patchAction(index, { userId: e.target.value || "" })}
            className={INPUT_CLASS}
            aria-label="Assign to"
          >
            <option value="">Select person…</option>
            {(employees || []).map((emp) => (
              <option key={emp.userId || emp.membershipId} value={emp.userId}>
                {emp.name}
              </option>
            ))}
          </select>
        );
      case "set_status":
        return (
          <select
            value={a.status || ""}
            onChange={(e) => patchAction(index, { status: e.target.value })}
            className={INPUT_CLASS}
            aria-label="Set status to"
          >
            <option value="">Select status…</option>
            {/* Review outcomes are omitted: the engine refuses to write them. */}
            {(DRAGGABLE_COLUMNS || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        );
      case "set_priority":
        return (
          <select
            value={a.priority || ""}
            onChange={(e) => patchAction(index, { priority: e.target.value })}
            className={INPUT_CLASS}
            aria-label="Set priority to"
          >
            <option value="">Select priority…</option>
            {(PRIORITIES || []).map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </select>
        );
      case "add_label":
        return (
          <select
            value={a.label || ""}
            onChange={(e) => patchAction(index, { label: e.target.value })}
            className={INPUT_CLASS}
            aria-label="Add label"
          >
            <option value="">Select label…</option>
            {(labels || []).map((l) => (
              <option key={l.id || l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        );
      case "notify":
      case "email": {
        const isEmail = a.type === "email";
        return (
          <>
            <select
              value={a.target === "user" ? "user" : "assignee"}
              onChange={(e) =>
                patchAction(index, {
                  target: e.target.value,
                  ...(e.target.value === "assignee" ? { userId: "" } : {}),
                })
              }
              className={INPUT_CLASS}
              aria-label="Send to"
            >
              <option value="assignee">Assignee</option>
              <option value="user">Specific person</option>
            </select>

            {a.target === "user" && (
              <select
                value={a.userId || ""}
                onChange={(e) => patchAction(index, { userId: e.target.value || "" })}
                className={INPUT_CLASS}
                aria-label="Recipient"
              >
                <option value="">Select person…</option>
                {(employees || []).map((emp) => (
                  <option key={emp.userId || emp.membershipId} value={emp.userId}>
                    {emp.name}
                  </option>
                ))}
              </select>
            )}

            <input
              value={(isEmail ? a.subject : a.title) || ""}
              onChange={(e) =>
                patchAction(index, isEmail ? { subject: e.target.value } : { title: e.target.value })
              }
              placeholder={isEmail ? "Subject (optional)" : "Title (optional)"}
              className={`${INPUT_CLASS} min-w-[10rem] flex-1`}
              aria-label={isEmail ? "Email subject" : "Notification title"}
            />
            <input
              value={a.message || ""}
              onChange={(e) => patchAction(index, { message: e.target.value })}
              placeholder="Message (optional)"
              className={`${INPUT_CLASS} min-w-[12rem] flex-1`}
              aria-label="Message"
            />
          </>
        );
      }
      default:
        return null;
    }
  };

  const scopeLabel = projectId
    ? projects.find((p) => p.id === projectId)?.name || "this project"
    : "all projects";

  /* ---- render ---- */
  return (
    <div className="space-y-4">
      {/* 1) Toolbar */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setDraft(null);
            }}
            className={INPUT_CLASS}
            disabled={loadingProjects}
            aria-label="Select automation scope"
          >
            <option value="">All projects (org-wide)</option>
            {(projects || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || "Untitled project"}
              </option>
            ))}
          </select>

          <span className="text-xs text-muted-foreground">
            <span className="tabular-nums">{rules.length}</span>{" "}
            {rules.length === 1 ? "rule" : "rules"}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDraft(emptyDraft())}
              className={PRIMARY_BTN}
              disabled={loading}
            >
              <Plus className="h-4 w-4" /> New rule
            </button>
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              title="Refresh"
              className={`${SECONDARY_BTN} inline-flex items-center gap-1.5 disabled:opacity-60`}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* 3) Editor (inline panel, not a modal) */}
      {draft && (
        <div className={PANEL}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <Zap className="h-4 w-4 text-primary" />
              {draft.id ? "Edit rule" : "New rule"}
            </h3>
            <span className="text-xs text-muted-foreground">Scope: {scopeLabel}</span>
          </div>

          {/* Name */}
          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="rule-name">
              Rule name
            </label>
            <input
              id="rule-name"
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              placeholder="e.g. Auto-assign bugs to QA"
              className={`${INPUT_CLASS} w-full max-w-md`}
            />
          </div>

          {/* When */}
          <div className="mt-5 rounded-lg border border-border bg-background p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              When
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={draft.trigger?.event || ""}
                onChange={(e) => changeEvent(e.target.value)}
                className={INPUT_CLASS}
                aria-label="Trigger event"
              >
                <option value="">Select trigger…</option>
                {(TRIGGER_EVENTS || []).map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.label}
                  </option>
                ))}
              </select>

              {draft.trigger?.event === "status_changed" && (
                <>
                  <span className="text-sm text-muted-foreground">from</span>
                  <select
                    value={draft.trigger?.from || ""}
                    onChange={(e) => setTriggerKey("from", e.target.value)}
                    className={INPUT_CLASS}
                    aria-label="From status"
                  >
                    <option value="">Any status</option>
                    {(BOARD_COLUMNS || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-muted-foreground">to</span>
                  <select
                    value={draft.trigger?.to || ""}
                    onChange={(e) => setTriggerKey("to", e.target.value)}
                    className={INPUT_CLASS}
                    aria-label="To status"
                  >
                    <option value="">Any status</option>
                    {(BOARD_COLUMNS || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {draft.trigger?.event === "priority_changed" && (
                <>
                  <span className="text-sm text-muted-foreground">to</span>
                  <select
                    value={draft.trigger?.toPriority || ""}
                    onChange={(e) => setTriggerKey("toPriority", e.target.value)}
                    className={INPUT_CLASS}
                    aria-label="To priority"
                  >
                    <option value="">Any priority</option>
                    {(PRIORITIES || []).map((p) => (
                      <option key={p} value={p}>
                        {titleCase(p)}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            {/* optional narrowing filters — shown for every event */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Only when type is</span>
              <select
                value={draft.trigger?.taskType || ""}
                onChange={(e) => setTriggerKey("taskType", e.target.value)}
                className={INPUT_CLASS}
                aria-label="Only when type is"
              >
                <option value="">Any</option>
                {(TASK_TYPES || []).map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </select>

              <span className="text-sm text-muted-foreground">Only when priority is</span>
              <select
                value={draft.trigger?.priority || ""}
                onChange={(e) => setTriggerKey("priority", e.target.value)}
                className={INPUT_CLASS}
                aria-label="Only when priority is"
              >
                <option value="">Any</option>
                {(PRIORITIES || []).map((p) => (
                  <option key={p} value={p}>
                    {titleCase(p)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Then */}
          <div className="mt-3 rounded-lg border border-border bg-background p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Then
            </p>

            <div className="space-y-2">
              {(Array.isArray(draft.actions) ? draft.actions : []).map((action, index) => (
                <div
                  key={`action-${index}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2"
                >
                  <select
                    value={action?.type || "notify"}
                    onChange={(e) => changeActionType(index, e.target.value)}
                    className={INPUT_CLASS}
                    aria-label="Action type"
                  >
                    {(ACTION_TYPES || []).map((at) => (
                      <option key={at.id} value={at.id}>
                        {at.label}
                      </option>
                    ))}
                  </select>

                  {renderActionFields(action, index)}

                  <button
                    type="button"
                    onClick={() => removeAction(index)}
                    title="Remove action"
                    aria-label="Remove action"
                    className={`ml-auto ${ICON_BTN} hover:border-destructive hover:text-destructive`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {!(Array.isArray(draft.actions) && draft.actions.length) && (
                <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                  No actions yet — add at least one so the rule does something.
                </p>
              )}
            </div>

            <button type="button" onClick={addAction} className={`mt-2 ${SECONDARY_BTN} inline-flex items-center gap-1.5`}>
              <Plus className="h-4 w-4" /> Add action
            </button>
          </div>

          {/* Enabled + save/cancel */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.enabled !== false}
                onChange={(e) => patchDraft({ enabled: e.target.checked })}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Rule is enabled
            </label>

            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => setDraft(null)} className={SECONDARY_BTN} disabled={saving}>
                Cancel
              </button>
              <button type="button" onClick={handleSave} className={PRIMARY_BTN} disabled={saving}>
                <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save rule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2) Rule list */}
      {loading && !rules.length ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
        </div>
      ) : !rules.length ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
          <Zap className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No automation rules yet — create one to auto-assign work, move statuses, or send reminders.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => {
            const enabled = rule?.enabled !== false;
            const busy = busyId === rule?.id;
            const created = formatDate(rule?.created_at);
            return (
              <div key={rule.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                {/* Row 1 */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={enabled ? "Disable rule" : "Enable rule"}
                    onClick={() => handleToggle(rule)}
                    disabled={busy}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                      enabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
                        enabled ? "translate-x-[1.125rem]" : "translate-x-0.5"
                      }`}
                    />
                  </button>

                  <p className="font-semibold text-foreground">{rule.name || "Untitled rule"}</p>

                  <span
                    className={`${BADGE} ${
                      enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {enabled ? "Enabled" : "Disabled"}
                  </span>

                  {!rule.project_id && (
                    <span className={`${BADGE} bg-muted text-muted-foreground`}>Org-wide</span>
                  )}

                  {created && (
                    <span className="text-xs tabular-nums text-muted-foreground">{created}</span>
                  )}

                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDraft(draftFromRule(rule))}
                      title="Edit rule"
                      aria-label="Edit rule"
                      className={ICON_BTN}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(rule)}
                      disabled={busy}
                      title="Delete rule"
                      aria-label="Delete rule"
                      className={`${ICON_BTN} hover:border-destructive hover:text-destructive disabled:opacity-60`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Row 2 — human-readable summary */}
                <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {summarySegments(rule, employees).map((s, i) => (
                      <span key={`seg-${rule.id}-${i}`} className={s.s ? "text-foreground" : undefined}>
                        {s.t}
                      </span>
                    ))}
                  </span>
                </p>

                <p className="sr-only">Trigger: {eventLabel(rule?.trigger?.event)}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* 4) Footnote */}
      <p className="text-xs text-muted-foreground">
        Rules run when a task is created, moved, or assigned. Due-date reminders and recurring tasks
        run daily from the scheduler.
      </p>
    </div>
  );
}
