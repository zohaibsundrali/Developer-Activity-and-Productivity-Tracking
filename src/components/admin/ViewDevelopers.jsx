"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Swal from "sweetalert2";
import { RefreshCw, Users } from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import { showError, showInfo, showPre, showSuccess, showWarning } from "@/utils/alerts";
import { getOrgId } from "@/utils/orgContext";

export default function ViewDevelopers({ developers: initialDevelopers, onRefresh, supabase, user }) {
  const [developers, setDevelopers] = useState([]);
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  // Track which specific developer is currently being deleted (by their UUID).
  // Using a specific ID instead of a boolean prevents shared-state race conditions
  // where clicking delete on two different rows could delete the wrong developer.
  const [deletingId, setDeletingId] = useState(null);

  // Ref used as a guard so the deletion handler cannot be entered twice concurrently.
  const deletionInProgressRef = useRef(false);

  const withAssignedProjectCounts = useCallback(
    async (devs) => {
      const safeDevs = Array.isArray(devs) ? devs : [];
      if (safeDevs.length === 0) return [];

      // If we can't query, fall back to any precomputed counts if present.
      if (!supabase) {
        return safeDevs.map((d) => ({
          ...d,
          assigned_projects_count:
            typeof d.assigned_projects_count === "number"
              ? d.assigned_projects_count
              : typeof d.projects_count === "number"
                ? d.projects_count
                : 0,
        }));
      }

      const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
      
      const hydratedDevs = await Promise.all(
        safeDevs.map(async (dev) => {
          const email = normalizeEmail(dev?.email);
          if (!email) return { ...dev, assigned_projects_count: 0 };
          
          const orgId = getOrgId();
          let countQuery = supabase
            .from('projects')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_developer_email', dev.email); // Match the exact email case or use ilike if needed. Since email should be case sensitive or matching DB exact: dev.email
          if (orgId) countQuery = countQuery.eq('organization_id', orgId);
          const { count, error: countError } = await countQuery;

          return {
            ...dev,
            assigned_projects_count: countError ? 0 : (count || 0)
          };
        })
      );
      
      return hydratedDevs;
    },
    [supabase]
  );

  const fetchAdminDevelopers = useCallback(async () => {
    try {
      setLoading(true);
      
      // Get current admin from localStorage
      const adminData = JSON.parse(sessionStorage.getItem("adminUser"));
      setCurrentAdmin(adminData);
      
      if (!adminData) {
        showWarning("Login required", "Admin not logged in.");
        setDevelopers([]);
        return;
      }
      
      // Option 1: If initialDevelopers is passed, filter them
      if (initialDevelopers) {
        const filteredDevelopers = initialDevelopers.filter(dev => 
          dev.added_by === adminData.id || 
          dev.added_by_admin === adminData.email
        );
        const hydrated = await withAssignedProjectCounts(filteredDevelopers);
        setDevelopers(hydrated);
      } 
      // Option 2: Fetch directly from Supabase
      else if (supabase) {
        const orgId = getOrgId();
        let developersQuery = supabase
          .from('developers')
          .select('*')
          .or(`added_by.eq.${adminData.id},added_by_admin.ilike.%${adminData.email}%`)
          .order('created_at', { ascending: false });
        if (orgId) developersQuery = developersQuery.eq('organization_id', orgId);
        const { data, error } = await developersQuery;

        if (error) throw error;

        const hydrated = await withAssignedProjectCounts(data || []);
        setDevelopers(hydrated);
      }
      
    } catch (error) {
      showError("Load failed", `Error loading developers: ${error.message}`);
      setDevelopers([]);
    } finally {
      setLoading(false);
    }
  }, [initialDevelopers, supabase, withAssignedProjectCounts]);

  // Fetch admin's added developers on component mount
  useEffect(() => {
    fetchAdminDevelopers();
  }, [fetchAdminDevelopers]);

  // Keep the table in sync in real-time across tabs/sessions.
  useEffect(() => {
    if (!supabase || !currentAdmin) return;

    const base = `admin-developers-${currentAdmin.id || currentAdmin.email}`;

    const developersChannel = supabase
      .channel(`${base}-developers`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "developers" },
        () => {
          fetchAdminDevelopers();
          if (onRefresh) onRefresh();
        }
      )
      .subscribe();

    // Also refresh when projects change so the per-developer counts stay current.
    const projectsChannel = supabase
      .channel(`${base}-projects`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        () => {
          fetchAdminDevelopers();
          if (onRefresh) onRefresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(developersChannel);
      supabase.removeChannel(projectsChannel);
    };
  }, [supabase, currentAdmin, onRefresh, fetchAdminDevelopers]);

  const escapeHtml = (value = "") =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const toPreHtml = (text) => `<pre class="swal2-pre">${escapeHtml(text)}</pre>`;

  const formatDate = (dateString) => {
    if (!dateString) return 'No date';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleViewDeveloper = (developerId) => {
    const developer = developers.find(dev => dev.id === developerId);
    if (developer) {
      const details = `
        Developer Details:
        
        Name: ${developer.name}
        Email: ${developer.email}
        Status: ${developer.status}
        Projects: ${developer.assigned_projects_count ?? developer.projects_count ?? 0}
        Join Date: ${formatDate(developer.created_at)}
        Added By: ${developer.added_by_name || currentAdmin?.name || 'Admin'}
        Added On: ${formatDate(developer.created_at)}
        
        Company: ${developer.company || 'Not specified'}
        Last Updated: ${formatDate(developer.updated_at)}
      `;
      showPre("Developer details", details, "info");
    }
  };

  const handleEditDeveloper = async (developerId) => {
    const developer = developers.find(dev => dev.id === developerId);
    
    if (!developer) {
      showWarning("Not found", "Developer not found.");
      return;
    }
    
    // Check if current admin is the one who added this developer
    if (currentAdmin && 
        developer.added_by !== currentAdmin.id && 
        developer.added_by_admin !== currentAdmin.email) {
      showWarning("Permission denied", "You can only edit developers you added.");
      return;
    }
    
    try {
      setIsEditing(true);
      
      const nameResult = await Swal.fire({
        title: "Edit developer name",
        input: "text",
        inputValue: developer.name || "",
        inputPlaceholder: "Enter new name",
        showCancelButton: true,
        confirmButtonText: "Save",
        cancelButtonText: "Cancel",
      });
      if (!nameResult.isConfirmed) return;
      const newName = (nameResult.value || "").trim();
      if (!newName) {
        showWarning("Validation error", "Name cannot be empty.");
        return;
      }
      
      const emailResult = await Swal.fire({
        title: "Edit developer email",
        input: "email",
        inputValue: developer.email || "",
        inputPlaceholder: "Enter new email",
        showCancelButton: true,
        confirmButtonText: "Save",
        cancelButtonText: "Cancel",
      });
      if (!emailResult.isConfirmed) return;
      const newEmail = (emailResult.value || "").trim();
      if (!newEmail) {
        showWarning("Validation error", "Email cannot be empty.");
        return;
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        showWarning("Validation error", "Please enter a valid email address.");
        return;
      }
      
      // Check if email already exists (excluding current developer)
      const { data: existingDevs, error: checkError } = await supabase
        .from('developers')
        .select('id, email')
        .ilike('email', newEmail.trim())
        .neq('id', developerId);

      if (checkError) throw checkError;

      if (existingDevs && existingDevs.length > 0) {
        showWarning("Duplicate email", "A developer with this email already exists.");
        return;
      }

      const { error } = await supabase
        .from('developers')
        .update({ 
          name: newName.trim(), 
          email: newEmail.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', developerId);

      if (error) throw error;

      // Add notification
      await supabase
        .from('notifications')
        .insert([
          {
            message: `Developer "${developer.name}" updated to "${newName}"`,
            type: 'info',
            admin_id: currentAdmin?.id,
            admin_email: currentAdmin?.email,
            developer_id: developerId
          }
        ]);

      // Refresh the developers list
      await fetchAdminDevelopers();
      
      // Call parent refresh if provided
      if (onRefresh) {
        await onRefresh();
      }
      
      showSuccess("Saved", "Developer updated successfully.");
      
    } catch (error) {
      showError("Update failed", `Error updating developer: ${error.message}`);
    } finally {
      setIsEditing(false);
    }
  };

  const handleDeleteDeveloper = async (rowDeveloperId) => {
    // ── Concurrency guard ──────────────────────────────────────────────────────
    // deletionInProgressRef is set synchronously, so even two rapid clicks in
    // the same event-loop frame cannot both enter this function.
    if (deletionInProgressRef.current) {
      showInfo("Deletion in progress", "A deletion is already in progress. Please wait.");
      return;
    }

    // Resolve the developer using ONLY the primary key from the local list.
    // Never fall back to user_id here – that could resolve the wrong record.
    const developer = developers.find((dev) => dev.id === rowDeveloperId);

    if (!developer) {
      showWarning(
        "Not found",
        "Developer not found in the current list. Please refresh and try again."
      );
      return;
    }

    // Capture both identifiers NOW, before any async work, so that re-renders
    // cannot change what we are about to delete.
    const devId    = developer.id;        // UUID primary key – never changes
    const devEmail = developer.email || '';
    const devUserId = developer.user_id || '';

    // Client-side authorization pre-check
    if (currentAdmin) {
      const hasOwnershipInfo =
        developer.added_by || developer.added_by_admin || developer.admin_id;
      const isOwner =
        developer.added_by       === currentAdmin.id ||
        developer.added_by_admin === currentAdmin.email;
      if (hasOwnershipInfo && !isOwner) {
        showWarning("Permission denied", "You can only delete developers you added.");
        return;
      }
    }

    try {
      // Set the lock BEFORE any awaits so no other call sneaks in.
      deletionInProgressRef.current = true;
      setDeletingId(devId); // marks exactly this row as deleting in the UI

      // ── Step 1: Dry-run impact check ─────────────────────────────────────
      const impactParams = new URLSearchParams({
        developerId: devId,
        userId: devUserId,
        developerEmail: devEmail,
      }).toString();
      const impactResponse = await fetch(`/api/developer/delete?${impactParams}`);
      const impactData = await impactResponse.json();

      if (!impactResponse.ok || !impactData.success) {
        showPre(
          "Deletion check failed",
          `Could not load deletion impact:\n${impactData.error}`,
          "error"
        );
        return;
      }

      // ── Step 2: Confirmation with impact details ──────────────────────────
      const { impact, warning } = impactData;
      const impactMessage =
        `WARNING: This action cannot be undone!\n\n` +
        `Delete Developer: ${developer.name} (${devEmail})\n\n` +
        `The following data will be permanently deleted:\n` +
        `• Projects:      ${impact.projects}\n` +
        `• Tasks:         ${impact.tasks}\n` +
        `• Submissions:   ${impact.submissions}\n` +
        `• Activity logs: ${impact.activities}\n\n` +
        `${warning}\n\n` +
        `Are you absolutely sure you want to proceed?`;
      const confirmed = await Swal.fire({
        title: "Confirm deletion",
        icon: "warning",
        html: toPreHtml(impactMessage),
        showCancelButton: true,
        confirmButtonText: "Yes, delete",
        cancelButtonText: "Cancel",
      });
      if (!confirmed.isConfirmed) return;

      // ── Step 3: Final confirmation ────────────────────────────────────────
      const finalMessage =
        `FINAL CONFIRMATION\n\n` +
        `You are about to permanently delete "${developer.name}".\n\n` +
        `Click OK to proceed.`;
      const finalConfirmed = await Swal.fire({
        title: "Final confirmation",
        icon: "warning",
        html: toPreHtml(finalMessage),
        showCancelButton: true,
        confirmButtonText: "Delete permanently",
        cancelButtonText: "Cancel",
      });
      if (!finalConfirmed.isConfirmed) return;

      // ── Step 4: Execute deletion – send PRIMARY KEY only ─────────────────
      const deleteResponse = await fetch('/api/developer/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          developerId: devId,       // ← UUID pk, the single source of truth
          developerEmail: devEmail, // context only; backend uses id first
          userId: devUserId,
          adminId:    currentAdmin?.id,
          adminEmail: currentAdmin?.email,
        }),
      });

      const deleteData = await deleteResponse.json();

      if (!deleteResponse.ok || !deleteData.success) {
        showPre("Deletion failed", `Deletion failed:\n${deleteData.error}`, "error");
        return;
      }

      // ── Step 5: Optimistic UI – remove exactly the deleted row ────────────
      setDevelopers((prev) => prev.filter((dev) => dev.id !== devId));

      // Notify parent dashboard so counts update
      if (onRefresh) onRefresh();

      // ── Step 6: Success message ───────────────────────────────────────────
      const { deletionSummary } = deleteData;
      showPre(
        "Developer deleted",
        `Developer deleted successfully!\n\n` +
          `Name:  ${deletionSummary.developer.name}\n` +
          `Email: ${deletionSummary.developer.email}\n\n` +
          `Related data removed:\n` +
          `• Projects:    ${deletionSummary.relatedDataDeleted.projects}\n` +
          `• Tasks:       ${deletionSummary.relatedDataDeleted.tasks}\n` +
          `• Submissions: ${deletionSummary.relatedDataDeleted.submissions}`,
        "success"
      );
    } catch (error) {
      console.error('[ViewDevelopers] Deletion error:', error);
      showPre(
        "Unexpected error",
        `An unexpected error occurred:\n${error.message}`,
        "error"
      );
    } finally {
      // Always clear the lock and per-row loading indicator.
      deletionInProgressRef.current = false;
      setDeletingId(null);
    }
  };


  // Loading state
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-2 text-muted-foreground">Loading developers...</p>
        </div>
      </div>
    );
  }

  // Show warning if admin is not logged in
  if (!currentAdmin) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="text-center py-8">
          <Users className="w-16 h-16 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
          <p className="text-muted-foreground">Please log in as an admin to view developers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-card">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">View Developers</h2>
          {/* <p className="text-sm text-gray-500">
            Showing developers added by: {currentAdmin.name || currentAdmin.email}
          </p> */}
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchAdminDevelopers}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            disabled={loading}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Developers" value={developers.length} icon={Users} tone="info" />

        {/* <div className="bg-green-50 p-4 rounded-lg border border-green-100">
          <div className="flex items-center">
            <div className="bg-green-100 p-3 rounded-full mr-4">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-600">Active</p>
              <p className="text-2xl font-bold">{activeDevelopers.length}</p>
            </div>
          </div>
        </div> */}
        
        {/* <div className="bg-red-50 p-4 rounded-lg border border-red-100">
          <div className="flex items-center">
            <div className="bg-red-100 p-3 rounded-full mr-4">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-600">Inactive</p>
              <p className="text-2xl font-bold">{inactiveDevelopers.length}</p>
            </div>
          </div>
        </div> */}
      </div>

      {/* Developers Table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Projects
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Added On
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-border">
            {developers.map(developer => (
              <tr key={developer.id} className="hover:bg-muted/50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-foreground">
                    {developer.name}
                  </div>
                  {developer.added_by_name && (
                    <div className="text-xs text-muted-foreground">
                      Added by: {developer.added_by_name}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                  {developer.email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{developer.assigned_projects_count ?? developer.projects_count ?? 0}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                  {formatDate(developer.created_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
                  <button
                    onClick={() => handleViewDeveloper(developer.id)}
                    className="text-info hover:text-info px-2 py-1 hover:bg-info/10 rounded"
                    title="View Details"
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleEditDeveloper(developer.id)}
                    className="text-success hover:text-success px-2 py-1 hover:bg-success/10 rounded"
                    title="Edit Developer"
                    disabled={isEditing}
                  >
                    {isEditing ? 'Editing...' : 'Edit'}
                  </button>
                  <button
                    onClick={() => handleDeleteDeveloper(developer.id)}
                    className="text-destructive hover:text-destructive px-2 py-1 hover:bg-destructive/10 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete Developer"
                    disabled={deletingId !== null}
                  >
                    {deletingId === developer.id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {developers.length === 0 && !loading && (
        <div className="text-center py-8">
          <Users className="w-16 h-16 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
          <p className="text-muted-foreground text-lg mb-2">No developers added by you yet</p>

        </div>
      )}
    </div>
  );
}