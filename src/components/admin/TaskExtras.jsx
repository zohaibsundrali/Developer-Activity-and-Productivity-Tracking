"use client";

import { useState, useEffect, useCallback } from "react";
import {
  setTaskType,
  setTaskLabels,
  setTaskCustomFields,
  setRecurring,
  loadLabels,
  createLabel,
  loadCustomFields,
  createCustomField,
  loadActivity,
  TASK_TYPES,
} from "@/utils/pmData";
import { showError } from "@/utils/alerts";
import { Badge, Button } from "@/components/ui";
import { Tag, Repeat, SlidersHorizontal, History, Plus } from "lucide-react";

// ---- shared tokens (match TaskDetailDrawer, compact drawer variant) -------
const FIELD_CLASS =
  "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const SECTION_HEADING_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const RECURRENCE_FREQS = ["daily", "weekly", "monthly"];
const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "checkbox", "user"];
const PRESET_COLORS = ["#6C82FF", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#A855F7"];

// "in_progress" -> "In Progress"
const pretty = (s) =>
  String(s || "")
    .split("_")
    .map((w) => (w && w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

// Native-Date-only relative time. Defined as a function (no new Date() at module scope).
function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

// A select option may be a plain string or a { label, value } object.
const optLabel = (o) => (o && typeof o === "object" ? o.label ?? o.value ?? "" : String(o ?? ""));
const optValue = (o) => (o && typeof o === "object" ? o.value ?? o.label ?? "" : String(o ?? ""));

export default function TaskExtras({ task, projectId, members, onChanged }) {
  const taskId = task?.id;
  const memberList = members || [];

  // ---- data collections ---------------------------------------------
  const [labels, setLabels] = useState([]);
  const [fields, setFields] = useState([]);
  const [activity, setActivity] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // ---- recurring local state (initialized from task.recurrence) ------
  const [recFreq, setRecFreq] = useState(task?.recurrence?.freq || "weekly");
  const [recEvery, setRecEvery] = useState(task?.recurrence?.interval || 1);

  // ---- "new label" / "add field" inputs ------------------------------
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6C82FF");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");

  // After any mutation: let parent reload, then re-fetch history.
  const afterChanged = useCallback(async () => {
    try {
      await onChanged?.();
    } catch {
      /* noop */
    }
    setRefreshKey((k) => k + 1);
  }, [onChanged]);

  // Keep recurrence inputs in sync when a different task is shown.
  useEffect(() => {
    setRecFreq(task?.recurrence?.freq || "weekly");
    setRecEvery(task?.recurrence?.interval || 1);
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- loaders -------------------------------------------------------
  const refetchLabels = useCallback(async () => {
    if (!projectId) return;
    try {
      setLabels((await loadLabels(projectId)) || []);
    } catch {
      /* best-effort */
    }
  }, [projectId]);

  const refetchFields = useCallback(async () => {
    if (!projectId) return;
    try {
      setFields((await loadCustomFields(projectId)) || []);
    } catch {
      /* best-effort */
    }
  }, [projectId]);

  useEffect(() => {
    refetchLabels();
    refetchFields();
  }, [refetchLabels, refetchFields]);

  // History re-fetches on mount and whenever a mutation bumps refreshKey.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!taskId) return;
      try {
        const rows = await loadActivity({ entityId: taskId, entityType: "task", limit: 30 });
        if (active) setActivity(rows || []);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      active = false;
    };
  }, [taskId, refreshKey]);

  // ---- mutations -----------------------------------------------------
  const onTypeChange = async (value) => {
    try {
      const { error } = await setTaskType(taskId, value, {
        projectId,
        action: "type_changed",
        meta: { to: value },
      });
      if (error) return showError("Could not change type", error.message || String(error));
      await afterChanged();
    } catch (err) {
      showError("Could not change type", err?.message || String(err));
    }
  };

  const toggleLabel = async (label) => {
    const current = task?.labels || [];
    const has = current.includes(label.name);
    const next = has ? current.filter((n) => n !== label.name) : [...current, label.name];
    try {
      const { error } = await setTaskLabels(taskId, next, {
        projectId,
        action: "labels_changed",
        meta: {},
      });
      if (error) return showError("Could not update labels", error.message || String(error));
      await afterChanged();
    } catch (err) {
      showError("Could not update labels", err?.message || String(err));
    }
  };

  const handleCreateLabel = async () => {
    const name = newLabelName.trim();
    if (!name || !projectId) return;
    try {
      const { error } = await createLabel(projectId, { name, color: newLabelColor || "#6C82FF" });
      if (error) return showError("Could not create label", error.message || String(error));
      setNewLabelName("");
      setNewLabelColor("#6C82FF");
      await refetchLabels();
    } catch (err) {
      showError("Could not create label", err?.message || String(err));
    }
  };

  const commitRecurring = async (checked, freq, every) => {
    const interval = Number(every) || 1;
    const recurrence = checked ? { freq, interval } : {};
    try {
      const { error } = await setRecurring(
        taskId,
        { is_recurring: checked, recurrence },
        { projectId, action: "recurring_changed", meta: { is_recurring: checked } }
      );
      if (error) return showError("Could not update recurrence", error.message || String(error));
      await afterChanged();
    } catch (err) {
      showError("Could not update recurrence", err?.message || String(err));
    }
  };

  const commitCustomField = async (field, value) => {
    const merged = { ...(task?.custom_fields || {}), [field.id]: value };
    try {
      const { error } = await setTaskCustomFields(taskId, merged, {
        projectId,
        action: "custom_field_changed",
        meta: { field: field.name },
      });
      if (error) return showError("Could not save field", error.message || String(error));
      await afterChanged();
    } catch (err) {
      showError("Could not save field", err?.message || String(err));
    }
  };

  const handleCreateField = async () => {
    const name = newFieldName.trim();
    if (!name || !projectId) return;
    const options =
      newFieldType === "select"
        ? newFieldOptions
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    try {
      const { error } = await createCustomField(projectId, {
        name,
        field_type: newFieldType,
        options,
      });
      if (error) return showError("Could not create field", error.message || String(error));
      setNewFieldName("");
      setNewFieldType("text");
      setNewFieldOptions("");
      await refetchFields();
    } catch (err) {
      showError("Could not create field", err?.message || String(err));
    }
  };

  // ---- derived -------------------------------------------------------
  const currentType = task?.task_type || "feature";
  const isRecurring = !!task?.is_recurring;
  const appliedLabels = task?.labels || [];
  const customValues = task?.custom_fields || {};

  const actorName = (row) => {
    if (row?.actor_name) return row.actor_name;
    const mem = memberList.find((m) => String(m.userId) === String(row?.actor_id));
    return mem?.name || "Someone";
  };

  const metaHint = (meta) => {
    if (!meta || typeof meta !== "object") return "";
    return meta.to || meta.field || meta.title || "";
  };

  if (!task) return null;

  // ---- per-field renderer -------------------------------------------
  const renderFieldInput = (field) => {
    const raw = customValues[field.id];
    switch (field.field_type) {
      case "number":
        return (
          <input
            type="number"
            className={`${FIELD_CLASS} w-full tabular-nums`}
            defaultValue={raw ?? ""}
            key={`cf-num-${taskId}-${field.id}`}
            onBlur={(e) =>
              commitCustomField(field, e.target.value === "" ? null : Number(e.target.value))
            }
          />
        );
      case "date":
        return (
          <input
            type="date"
            className={`${FIELD_CLASS} w-full`}
            value={raw || ""}
            onChange={(e) => commitCustomField(field, e.target.value || null)}
          />
        );
      case "select":
        return (
          <select
            className={`${FIELD_CLASS} w-full`}
            value={raw ?? ""}
            onChange={(e) => commitCustomField(field, e.target.value || null)}
          >
            <option value="">—</option>
            {(field.options || []).map((o, i) => (
              <option key={`${optValue(o)}-${i}`} value={optValue(o)}>
                {optLabel(o)}
              </option>
            ))}
          </select>
        );
      case "checkbox":
        return (
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={!!raw}
            onChange={(e) => commitCustomField(field, e.target.checked)}
          />
        );
      case "user":
        return (
          <select
            className={`${FIELD_CLASS} w-full`}
            value={raw ?? ""}
            onChange={(e) => commitCustomField(field, e.target.value || null)}
          >
            <option value="">Unassigned</option>
            {memberList.map((m) => (
              <option key={String(m.userId)} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        );
      case "text":
      default:
        return (
          <input
            type="text"
            className={`${FIELD_CLASS} w-full`}
            defaultValue={raw ?? ""}
            key={`cf-txt-${taskId}-${field.id}`}
            onBlur={(e) => commitCustomField(field, e.target.value)}
          />
        );
    }
  };

  return (
    <div className="text-sm">
      {/* 1. TYPE --------------------------------------------------------- */}
      <div>
        <h4 className={`${SECTION_HEADING_CLASS} mb-2 flex items-center gap-1.5`}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> Type
        </h4>
        <select
          className={`${FIELD_CLASS} w-full`}
          value={currentType}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {pretty(t)}
            </option>
          ))}
        </select>
      </div>

      {/* 2. LABELS ------------------------------------------------------- */}
      <div className="border-t border-border pt-3 mt-3">
        <h4 className={`${SECTION_HEADING_CLASS} mb-2 flex items-center gap-1.5`}>
          <Tag className="h-3.5 w-3.5" /> Labels
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label) => {
            const applied = appliedLabels.includes(label.name);
            return (
              <button
                key={String(label.id)}
                type="button"
                onClick={() => toggleLabel(label)}
                aria-pressed={applied}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  applied
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color || "#6C82FF" }}
                />
                {label.name}
              </button>
            );
          })}
          {labels.length === 0 ? (
            <span className="text-xs text-muted-foreground">No labels yet.</span>
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <input
            className={`${FIELD_CLASS} min-w-0 flex-1`}
            placeholder="New label…"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateLabel();
              }
            }}
          />
          <div className="flex items-center gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setNewLabelColor(c)}
                aria-pressed={newLabelColor === c}
                className={`h-5 w-5 rounded-full border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  newLabelColor === c ? "border-foreground" : "border-border"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <Button
            size="icon-sm"
            aria-label="Create label"
            onClick={handleCreateLabel}
            disabled={!newLabelName.trim()}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* 3. RECURRING ---------------------------------------------------- */}
      <div className="border-t border-border pt-3 mt-3">
        <h4 className={`${SECTION_HEADING_CLASS} mb-2 flex items-center gap-1.5`}>
          <Repeat className="h-3.5 w-3.5" /> Recurring
        </h4>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={isRecurring}
            onChange={(e) => commitRecurring(e.target.checked, recFreq, recEvery)}
          />
          Recurring task
        </label>

        {isRecurring ? (
          <div className="mt-2 flex items-center gap-2">
            <select
              className={`${FIELD_CLASS} flex-1`}
              value={recFreq}
              onChange={(e) => {
                setRecFreq(e.target.value);
                commitRecurring(true, e.target.value, recEvery);
              }}
            >
              {RECURRENCE_FREQS.map((f) => (
                <option key={f} value={f}>
                  {pretty(f)}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">every</span>
              <input
                type="number"
                min={1}
                className={`${FIELD_CLASS} w-16 tabular-nums`}
                value={recEvery}
                onChange={(e) => setRecEvery(e.target.value)}
                onBlur={(e) => commitRecurring(true, recFreq, e.target.value)}
              />
            </div>
          </div>
        ) : null}

        <p className="mt-2 text-xs text-muted-foreground">
          Recurring tasks are spawned by the automation scheduler.
        </p>
      </div>

      {/* 4. CUSTOM FIELDS ------------------------------------------------ */}
      <div className="border-t border-border pt-3 mt-3">
        <h4 className={`${SECTION_HEADING_CLASS} mb-2 flex items-center gap-1.5`}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> Custom Fields
        </h4>

        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">No custom fields — add one below.</p>
        ) : (
          <div className="space-y-2">
            {fields.map((field) => (
              <div key={String(field.id)} className="flex items-center gap-2">
                <label className="w-28 shrink-0 truncate text-xs font-medium text-foreground">
                  {field.name}
                </label>
                <div className="min-w-0 flex-1">{renderFieldInput(field)}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <input
            className={`${FIELD_CLASS} min-w-0 flex-1`}
            placeholder="Field name…"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
          />
          <select
            className={`${FIELD_CLASS} shrink-0`}
            value={newFieldType}
            onChange={(e) => setNewFieldType(e.target.value)}
          >
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {pretty(t)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            onClick={handleCreateField}
            disabled={!newFieldName.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {newFieldType === "select" ? (
          <input
            className={`${FIELD_CLASS} mt-1.5 w-full`}
            placeholder="Options, comma-separated…"
            value={newFieldOptions}
            onChange={(e) => setNewFieldOptions(e.target.value)}
          />
        ) : null}
      </div>

      {/* 5. HISTORY ------------------------------------------------------ */}
      <div className="border-t border-border pt-3 mt-3">
        <h4 className={`${SECTION_HEADING_CLASS} mb-2 flex items-center gap-1.5`}>
          <History className="h-3.5 w-3.5" /> History
        </h4>

        {activity.length === 0 ? (
          <p className="text-xs text-muted-foreground">No history yet.</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((row) => {
              const hint = metaHint(row.meta);
              return (
                <li key={String(row.id)} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-foreground">
                      <span className="font-medium">{actorName(row)}</span>{" "}
                      <span className="text-muted-foreground">{pretty(row.action)}</span>
                      {hint ? (
                        <span className="ml-1 rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-semibold text-info-on-tint">
                          {hint}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[10px] tabular-nums text-muted-foreground">
                      {relativeTime(row.created_at)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
