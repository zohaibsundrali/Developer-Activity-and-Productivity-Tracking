"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Swal from "sweetalert2";
import { showError, showInfo, showPre, showSuccess, showWarning } from "@/utils/alerts";

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

  const fetchAdminDevelopers = useCallback(async () => {
    try {
      setLoading(true);
      
      // Get current admin from localStorage
      const adminData = JSON.parse(localStorage.getItem("adminUser"));
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
        setDevelopers(filteredDevelopers);
      } 
      // Option 2: Fetch directly from Supabase
      else if (supabase) {
        const { data, error } = await supabase
          .from('developers')
          .select('*')
          .or(`added_by.eq.${adminData.id},added_by_admin.ilike.%${adminData.email}%`)
          .order('created_at', { ascending: false });

        if (error) throw error;
        
        setDevelopers(data || []);
      }
      
    } catch (error) {
      showError("Load failed", `Error loading developers: ${error.message}`);
      setDevelopers([]);
    } finally {
      setLoading(false);
    }
  }, [initialDevelopers, supabase]);

  // Fetch admin's added developers on component mount
  useEffect(() => {
    fetchAdminDevelopers();
  }, [fetchAdminDevelopers]);

  // Keep the table in sync in real-time across tabs/sessions.
  useEffect(() => {
    if (!supabase || !currentAdmin) return;

    const channel = supabase
      .channel(`admin-developers-${currentAdmin.id || currentAdmin.email}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'developers' },
        () => {
          fetchAdminDevelopers();
          if (onRefresh) onRefresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
        Projects: ${developer.projects_count || 0}
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

  const toggleDeveloperStatus = async (developerId) => {
    const developer = developers.find(dev => dev.id === developerId);
    
    if (!developer) {
      showWarning("Not found", "Developer not found.");
      return;
    }
    
    // Check if current admin is the one who added this developer
    if (currentAdmin && 
        developer.added_by !== currentAdmin.id && 
        developer.added_by_admin !== currentAdmin.email) {
      showWarning("Permission denied", "You can only modify developers you added.");
      return;
    }
    
    const newStatus = developer.status === 'active' ? 'inactive' : 'active';
    
    const statusConfirm = await Swal.fire({
      title: "Change status?",
      text: `Change ${developer.name}'s status to ${newStatus}?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes, change",
      cancelButtonText: "Cancel",
    });
    if (!statusConfirm.isConfirmed) return;
    
    try {
      const { error } = await supabase
        .from('developers')
        .update({ 
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', developerId);

      if (error) throw error;

      // Add notification
      await supabase
        .from('notifications')
        .insert([
          {
            message: `Developer "${developer.name}" status changed to ${newStatus}`,
            type: newStatus === 'active' ? 'success' : 'warning',
            admin_id: currentAdmin?.id,
            admin_email: currentAdmin?.email,
            developer_id: developerId
          }
        ]);

      // Refresh the developers list
      await fetchAdminDevelopers();
      
      showSuccess(
        "Status updated",
        `Developer status changed to ${newStatus} successfully.`
      );
      
    } catch (error) {
      showError("Update failed", `Error updating developer status: ${error.message}`);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#009578]"></div>
          <p className="mt-2 text-gray-500">Loading developers...</p>
        </div>
      </div>
    );
  }

  // Show warning if admin is not logged in
  if (!currentAdmin) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="text-center py-8">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 0c1.013 0 1.827.833 1.827 1.86 0 1.03-.814 1.86-1.827 1.86s-1.827-.83-1.827-1.86c0-1.027.814-1.86 1.827-1.86z" />
          </svg>
          <p className="text-gray-500">Please log in as an admin to view developers.</p>
        </div>
      </div>
    );
  }

  const activeDevelopers = developers.filter(d => d.status === 'active');
  const inactiveDevelopers = developers.filter(d => d.status === 'inactive');

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">View Developers</h2>
          {/* <p className="text-sm text-gray-500">
            Showing developers added by: {currentAdmin.name || currentAdmin.email}
          </p> */}
        </div>
        
        <div className="flex items-center space-x-3">
          <button 
            onClick={fetchAdminDevelopers}
            className="bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 transition-colors flex items-center"
            disabled={loading}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>
      
      {/* Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
          <div className="flex items-center">
            <div className="bg-blue-100 p-3 rounded-full mr-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 0c1.013 0 1.827.833 1.827 1.86 0 1.03-.814 1.86-1.827 1.86s-1.827-.83-1.827-1.86c0-1.027.814-1.86 1.827-1.86z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Developers</p>
              <p className="text-2xl font-bold">{developers.length}</p>
            </div>
          </div>
        </div>
        
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[950px] divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Projects
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Added On
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {developers.map(developer => (
              <tr key={developer.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {developer.name}
                  </div>
                  {developer.added_by_name && (
                    <div className="text-xs text-gray-500">
                      Added by: {developer.added_by_name}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {developer.email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => toggleDeveloperStatus(developer.id)}
                    className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full cursor-pointer transition-colors ${
                      developer.status === 'active' 
                        ? 'bg-green-100 text-green-800 hover:bg-green-200' 
                        : 'bg-red-100 text-red-800 hover:bg-red-200'
                    }`}
                    title="Click to change status"
                  >
                    {developer.status}
                  </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <span className="font-medium">{developer.projects_count || 0}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(developer.created_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
                  <button 
                    onClick={() => handleViewDeveloper(developer.id)}
                    className="text-blue-600 hover:text-blue-900 px-2 py-1 hover:bg-blue-50 rounded"
                    title="View Details"
                  >
                    View
                  </button>
                  <button 
                    onClick={() => handleEditDeveloper(developer.id)}
                    className="text-green-600 hover:text-green-900 px-2 py-1 hover:bg-green-50 rounded"
                    title="Edit Developer"
                    disabled={isEditing}
                  >
                    {isEditing ? 'Editing...' : 'Edit'}
                  </button>
                  <button 
                    onClick={() => handleDeleteDeveloper(developer.id)}
                    className="text-red-600 hover:text-red-900 px-2 py-1 hover:bg-red-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 0c1.013 0 1.827.833 1.827 1.86 0 1.03-.814 1.86-1.827 1.86s-1.827-.83-1.827-1.86c0-1.027.814-1.86 1.827-1.86z" />
          </svg>
          <p className="text-gray-500 text-lg mb-2">No developers added by you yet</p>
         
        </div>
      )}
    </div>
  );
}