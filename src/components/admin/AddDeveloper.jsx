"use client";
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Users, AlertTriangle } from "lucide-react";
import { showError, showSuccess, showWarning } from "@/utils/alerts";

const formatDate = (dateString) => {
  if (!dateString) return 'Recently';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const DeveloperForm = ({
  newDeveloper,
  handleInputChange,
  handleAddDeveloper,
  isAddingDeveloper,
  currentAdmin
}) => (
  <form onSubmit={handleAddDeveloper} className="space-y-4 max-w-md mb-8">
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">
        Full Name *
      </label>
      <input
        type="text"
        name="name"
        value={newDeveloper.name}
        onChange={handleInputChange}
        className="w-full rounded-lg border border-input bg-background p-2 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
        placeholder="Enter developer's full name"
        required
        disabled={isAddingDeveloper || !currentAdmin}
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">
        Email *
      </label>
      <input
        type="email"
        name="email"
        value={newDeveloper.email}
        onChange={handleInputChange}
        className="w-full rounded-lg border border-input bg-background p-2 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
        placeholder="Enter developer's email"
        required
        disabled={isAddingDeveloper || !currentAdmin}
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">
        Password *
      </label>
      <input
        type="password"
        name="password"
        value={newDeveloper.password}
        onChange={handleInputChange}
        className="w-full rounded-lg border border-input bg-background p-2 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
        placeholder="Set developer password"
        required
        minLength="6"
        disabled={isAddingDeveloper || !currentAdmin}
      />
      <p className="text-xs text-muted-foreground mt-1">Password must be at least 6 characters long</p>
    </div>

    <div className="flex flex-col sm:flex-row gap-3">
      <button
        type="submit"
        disabled={isAddingDeveloper || !currentAdmin}
        className={`inline-flex w-full sm:flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors ${isAddingDeveloper || !currentAdmin
          ? 'bg-primary/50 cursor-not-allowed'
          : 'bg-primary hover:bg-primary/90'
          }`}
      >
        {!currentAdmin ? 'Please Login' : isAddingDeveloper ? 'Adding...' : 'Add Developer'}
      </button>
    </div>
  </form>
);

const DeveloperTable = ({ developers, missingColumns }) => (
  <div className="border-t border-border pt-6">
    <div className="flex justify-between items-center mb-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">
          {!missingColumns ? 'Your Developers' : 'All Developers'}
          {developers.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({developers.length} total)
            </span>
          )}
        </h3>
      </div>
    </div>

    {developers.length > 0 ? (
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Projects
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Added On
              </th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-border">
            {developers.map(developer => (
              <tr key={developer.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="text-sm font-medium text-foreground">
                    {developer.name}
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="text-sm text-muted-foreground">
                    {developer.email}
                  </div>
                </td>

                <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{developer.dynamic_projects_count ?? developer.projects_count ?? 0}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                  {formatDate(developer.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="text-center py-8">
        <Users className="w-16 h-16 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />
        <p className="text-muted-foreground text-lg mb-2">
          {!missingColumns ? 'No developers added by you yet' : 'No developers found'}
        </p>
      </div>
    )}
  </div>
);

export default function AddDeveloper({ user, developers: initialDevelopers, onRefresh, supabase }) {
  const [newDeveloper, setNewDeveloper] = useState({
    name: "",
    email: "",
    password: ""
  });
  const [isAddingDeveloper, setIsAddingDeveloper] = useState(false);
  const [developers, setDevelopers] = useState([]); // Only developers added by current admin
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missingColumns, setMissingColumns] = useState(false);

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

      // Try to fetch developers added by this admin
      try {
        let fetchedDevelopers = [];
        const { data, error } = await supabase
          .from('developers')
          .select('*')
          .or(`added_by.eq.${adminData.id},added_by_admin.ilike.%${adminData.email}%`)
          .order('created_at', { ascending: false });

        if (error) {
          // If columns don't exist, fetch all developers
          setMissingColumns(true);

          const { data: allData, error: allError } = await supabase
            .from('developers')
            .select('*')
            .order('created_at', { ascending: false });

          if (allError) throw allError;

          fetchedDevelopers = allData || [];
        } else {
          setMissingColumns(false);
          fetchedDevelopers = data || [];
        }

        // Fetch dynamic project counts for each developer
        const developersWithCounts = await Promise.all(
          fetchedDevelopers.map(async (developer) => {
            const { count, error: countError } = await supabase
              .from('projects')
              .select('*', { count: 'exact', head: true })
              .eq('assigned_developer_email', developer.email);
            
            return {
              ...developer,
              dynamic_projects_count: countError ? 0 : (count || 0)
            };
          })
        );

        setDevelopers(developersWithCounts);
      } catch (fetchError) {
        setMissingColumns(true);
        setDevelopers([]);
      }

    } catch (error) {
      showError("Load failed", `Error loading developers: ${error.message}`);
      setDevelopers([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Fetch current admin's developers on component mount
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchAdminDevelopers();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchAdminDevelopers]);

  const handleAddDeveloper = async (e) => {
    e.preventDefault();

    if (!currentAdmin) {
      showWarning("Login required", "Admin not logged in.");
      return;
    }

    if (!newDeveloper.name.trim() || !newDeveloper.email.trim() || !newDeveloper.password.trim()) {
      showWarning("Validation error", "Please fill in all fields.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newDeveloper.email)) {
      showWarning("Validation error", "Please enter a valid email address.");
      return;
    }

    if (newDeveloper.password.length < 6) {
      showWarning("Validation error", "Password must be at least 6 characters long.");
      return;
    }

    // Check if developer already exists (global check)
    try {
      const { data: existingDevs, error: checkError } = await supabase
        .from('developers')
        .select('email')
        .ilike('email', newDeveloper.email.trim());

      if (checkError) throw checkError;

      if (existingDevs && existingDevs.length > 0) {
        showWarning("Duplicate email", "A developer with this email already exists.");
        return;
      }
    } catch (error) {
      // Silently handle error
    }

    try {
      setIsAddingDeveloper(true);
      let insertedData = null; // Use let instead of const for reassignment

      // Prepare developer data
      const developerData = {
        name: newDeveloper.name.trim(),
        email: newDeveloper.email.trim(),
        // Development/testing only: store password as plain text.
        password: newDeveloper.password,
        status: 'active',
        projects_count: 0,
        company: user?.company || 'Unknown Company',
        created_at: new Date().toISOString()
      };

      // Try to add admin tracking columns
      try {
        developerData.added_by = currentAdmin.id;
        developerData.added_by_admin = currentAdmin.email;
        developerData.added_by_name = currentAdmin.name || 'Admin';
      } catch (err) {
        setMissingColumns(true);
      }

      // Add developer with admin who added them
      const { data, error } = await supabase
        .from('developers')
        .insert([developerData])
        .select();

      if (error) {
        // If error due to missing columns, try without them
        if (error.message.includes('added_by') || error.message.includes('schema cache')) {
          // Remove admin tracking columns
          const simplifiedData = {
            name: newDeveloper.name.trim(),
            email: newDeveloper.email.trim(),
            // Development/testing only: store password as plain text.
            password: newDeveloper.password,
            status: 'active',
            projects_count: 0,
            company: user?.company || 'Unknown Company',
            created_at: new Date().toISOString()
          };

          const { data: retryData, error: retryError } = await supabase
            .from('developers')
            .insert([simplifiedData])
            .select();

          if (retryError) throw retryError;

          insertedData = retryData; // Assign to let variable
          setMissingColumns(true);
        } else {
          throw error;
        }
      } else {
        insertedData = data; // Assign to let variable
      }

      // Add notification
      try {
        await supabase
          .from('notifications')
          .insert([
            {
              message: `New developer "${newDeveloper.name}" added successfully`,
              type: 'success',
              created_at: new Date().toISOString()
            }
          ]);
      } catch (notifError) {
        // Silently handle error
      }

      // Refresh the developers list
      await fetchAdminDevelopers();

      // Call parent refresh if provided
      if (onRefresh) {
        await onRefresh();
      }

      // Reset form
      setNewDeveloper({
        name: "",
        email: "",
        password: ""
      });

      showSuccess("Saved", "Developer added successfully.");

    } catch (error) {
      showError("Save failed", `Error adding developer: ${error.message}`);
    } finally {
      setIsAddingDeveloper(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewDeveloper(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Show warning about missing columns
  if (missingColumns && developers.length > 0) {
    return (
      <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-card">
        <div>
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-foreground">
                  Database Setup Required
                </h3>
                <div className="mt-2 text-sm text-muted-foreground">
                  <p>
                    To enable admin isolation (each admin seeing only their own developers),
                    please run this SQL in Supabase SQL Editor:
                  </p>
                  <pre className="mt-2 bg-muted p-2 rounded text-xs overflow-x-auto text-foreground">
                    {`ALTER TABLE developers
ADD COLUMN IF NOT EXISTS added_by UUID,
ADD COLUMN IF NOT EXISTS added_by_admin TEXT,
ADD COLUMN IF NOT EXISTS added_by_name TEXT;`}
                  </pre>
                  <p className="mt-2">
                    Currently showing all developers from all admins.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">Add Developer</h2>
          </div>

          <button
            onClick={fetchAdminDevelopers}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            disabled={loading}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <DeveloperForm
          newDeveloper={newDeveloper}
          handleInputChange={handleInputChange}
          handleAddDeveloper={handleAddDeveloper}
          isAddingDeveloper={isAddingDeveloper}
          currentAdmin={currentAdmin}
        />

        <DeveloperTable developers={developers} missingColumns={missingColumns} />
      </div>
    );
  }

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
          <h2 className="text-xl font-bold tracking-tight text-foreground">Add Developer</h2>
        </div>

        <button
          onClick={fetchAdminDevelopers}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          disabled={loading}
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <DeveloperForm
        newDeveloper={newDeveloper}
        handleInputChange={handleInputChange}
        handleAddDeveloper={handleAddDeveloper}
        isAddingDeveloper={isAddingDeveloper}
        currentAdmin={currentAdmin}
      />

      <DeveloperTable developers={developers} missingColumns={missingColumns} />
    </div>
  );
}