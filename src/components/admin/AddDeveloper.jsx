"use client";
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Users, AlertTriangle } from "lucide-react";
import {
  PageHeader,
  Section,
  Card,
  CardContent,
  Badge,
  EmptyState,
  ErrorState,
  SkeletonTable,
  SkeletonCard,
  Field,
  Input,
  Button,
} from "@/components/ui";
import { showError, showSuccess, showWarning } from "@/utils/alerts";
import { getOrgId } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";

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
  <form onSubmit={handleAddDeveloper} className="space-y-4 max-w-md">
    <Field label="Full Name" htmlFor="developer-name" required>
      <Input
        id="developer-name"
        type="text"
        name="name"
        value={newDeveloper.name}
        onChange={handleInputChange}
        placeholder="Enter developer's full name"
        required
        disabled={isAddingDeveloper || !currentAdmin}
      />
    </Field>

    <Field label="Email" htmlFor="developer-email" required>
      <Input
        id="developer-email"
        type="email"
        name="email"
        value={newDeveloper.email}
        onChange={handleInputChange}
        placeholder="Enter developer's email"
        required
        disabled={isAddingDeveloper || !currentAdmin}
      />
    </Field>

    <Field
      label="Password"
      htmlFor="developer-password"
      hint="Password must be at least 6 characters long"
      required
    >
      <Input
        id="developer-password"
        type="password"
        name="password"
        value={newDeveloper.password}
        onChange={handleInputChange}
        placeholder="Set developer password"
        required
        minLength="6"
        disabled={isAddingDeveloper || !currentAdmin}
      />
    </Field>

    <div className="flex flex-col sm:flex-row gap-3">
      <Button
        type="submit"
        disabled={isAddingDeveloper || !currentAdmin}
        className="w-full sm:flex-1"
      >
        {!currentAdmin ? 'Please Login' : isAddingDeveloper ? 'Adding...' : 'Add Developer'}
      </Button>
    </div>
  </form>
);

const DeveloperTable = ({ developers, missingColumns, loading, error, onRetry }) => (
  <Section
    title={!missingColumns ? 'Your Developers' : 'All Developers'}
    description={
      !missingColumns
        ? 'Developers you have added to this organization.'
        : 'Every developer in this organization, from all admins.'
    }
    actions={
      developers.length > 0 ? (
        <Badge variant="secondary" size="sm">{developers.length} total</Badge>
      ) : null
    }
  >
    {loading ? (
      <Card className="sm:py-5">
        <CardContent className="sm:px-5">
          <SkeletonTable rows={5} cols={4} />
        </CardContent>
      </Card>
    ) : error ? (
      <ErrorState
        title="Couldn't load developers"
        description={error}
        onRetry={onRetry}
      />
    ) : developers.length > 0 ? (
      <Card className="sm:py-5">
        <CardContent className="sm:px-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] divide-y divide-border">
              <thead>
                <tr className="h-10">
                  <th className="px-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Name
                  </th>
                  <th className="px-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Email
                  </th>
                  <th className="px-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Projects
                  </th>
                  <th className="px-4 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Added On
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {developers.map(developer => (
                  <tr
                    key={developer.id}
                    className="h-12 transition-colors duration-150 hover:bg-muted/40"
                  >
                    <td className="px-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-foreground">
                        {developer.name}
                      </div>
                    </td>
                    <td className="px-4 whitespace-nowrap">
                      <div className="text-sm text-muted-foreground">
                        {developer.email}
                      </div>
                    </td>

                    <td className="px-4 whitespace-nowrap text-sm text-muted-foreground">
                      <span className="font-medium tabular-nums text-foreground">{developer.dynamic_projects_count ?? developer.projects_count ?? 0}</span>
                    </td>
                    <td className="px-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(developer.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    ) : (
      <EmptyState
        icon={Users}
        title={!missingColumns ? 'No developers added by you yet' : 'No developers found'}
        description="Developers you add with the form above will appear here."
      />
    )}
  </Section>
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
  // Presentation-only: mirrors an error that is already caught below, so the
  // list can render an ErrorState with retry instead of a silent empty table.
  const [loadError, setLoadError] = useState(null);

  const fetchAdminDevelopers = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);

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
        const orgId = getOrgId();
        let fetchedDevelopers = [];
        let devQuery = supabase
          .from('developers')
          .select('*')
          .or(`added_by.eq.${adminData.id},added_by_admin.ilike.%${adminData.email}%`)
          .order('created_at', { ascending: false });
        if (orgId) devQuery = devQuery.eq('organization_id', orgId);
        const { data, error } = await devQuery;

        if (error) {
          // If columns don't exist, fetch all developers
          setMissingColumns(true);

          let allQuery = supabase
            .from('developers')
            .select('*')
            .order('created_at', { ascending: false });
          if (orgId) allQuery = allQuery.eq('organization_id', orgId);
          const { data: allData, error: allError } = await allQuery;

          if (allError) throw allError;

          fetchedDevelopers = allData || [];
        } else {
          setMissingColumns(false);
          fetchedDevelopers = data || [];
        }

        // Fetch dynamic project counts for each developer
        const developersWithCounts = await Promise.all(
          fetchedDevelopers.map(async (developer) => {
            // Org-scoped like every sibling query here (and like the identical
            // count in ViewDevelopers). RLS already keeps other tenants' projects
            // out of this result, so the filter is defence in depth rather than a
            // fix for a live leak — but it is what stops the count going wrong the
            // moment this runs under the service role or moves to an API route.
            let countQuery = supabase
              .from('projects')
              .select('*', { count: 'exact', head: true })
              .eq('assigned_developer_email', developer.email);
            if (orgId) countQuery = countQuery.eq('organization_id', orgId);
            const { count, error: countError } = await countQuery;

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
        setLoadError(fetchError?.message || String(fetchError));
      }

    } catch (error) {
      showError("Load failed", `Error loading developers: ${error.message}`);
      setDevelopers([]);
      setLoadError(error?.message || String(error));
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

    // Check if developer already exists (scoped to current organization)
    try {
      const orgId = getOrgId();
      let dupQuery = supabase
        .from('developers')
        .select('email')
        .ilike('email', newDeveloper.email.trim());
      if (orgId) dupQuery = dupQuery.eq('organization_id', orgId);
      const { data: existingDevs, error: checkError } = await dupQuery;

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
        organization_id: getOrgId(),
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
            organization_id: getOrgId(),
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

      // Create a membership for the new developer so they get org context at
      // login, then mint the auth account.
      const orgId = getOrgId();
      const createdDeveloper = Array.isArray(insertedData) ? insertedData[0] : insertedData;
      if (orgId && createdDeveloper?.id) {
        // Undo the profile + membership rows written above. Without this a
        // refused provision leaves a developer who shows up in every staff
        // list, holds a seat, and has no auth account to log in with — worse
        // than the add having plainly failed.
        const rollbackDeveloper = async () => {
          try {
            await supabase.from('memberships').delete().eq('user_id', createdDeveloper.id);
          } catch { /* the developer row below is the one that matters */ }
          try {
            await supabase.from('developers').delete().eq('id', createdDeveloper.id);
          } catch { /* nothing further we can do from the browser */ }
        };

        await supabase
          .from('memberships')
          .insert([{
            organization_id: orgId,
            user_id: createdDeveloper.id,
            user_type: 'developer',
            email: createdDeveloper.email,
            role: 'developer',
            status: 'active',
          }]);

        // Provision a Supabase Auth account (with org claim) so this developer
        // can authenticate via Supabase Auth and be covered by RLS.
        // authFetch attaches the admin's Bearer token; the route derives the
        // organization from that token (it no longer accepts one from the body).
        //
        // authFetch RESOLVES on a 4xx rather than throwing, so the response has
        // to be inspected. Treating this call as best-effort is what let a plan
        // limit (402) be reported to the admin as success.
        let provisionRes = null;
        let provisionErr = null;
        try {
          provisionRes = await authFetch("/api/auth/provision", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: createdDeveloper.email,
              password: newDeveloper.password,
              role: "developer",
              userType: "developer",
              appUserId: createdDeveloper.id,
            }),
          });
        } catch (err) {
          provisionErr = err;
        }

        if (provisionErr || !provisionRes?.ok) {
          const payload = provisionRes ? await provisionRes.json().catch(() => null) : null;
          await rollbackDeveloper();
          await fetchAdminDevelopers();

          if (provisionRes?.status === 402) {
            showWarning(
              payload?.error || "Plan limit reached",
              payload?.detail ||
                "Your plan has no seat left for another developer. Upgrade the plan to add more."
            );
          } else {
            showError(
              "Save failed",
              payload?.error ||
                provisionErr?.message ||
                "The developer account could not be created, so nothing was saved."
            );
          }
          return;
        }
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

  const pageHeader = (
    <PageHeader
      title="Add Developer"
      description="Create developer accounts for your organization and review the ones you have added."
      actions={
        <Button variant="outline" onClick={fetchAdminDevelopers} disabled={loading}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Refresh
        </Button>
      }
    />
  );

  // Show warning about missing columns
  if (missingColumns && developers.length > 0) {
    return (
      <div className="space-y-6">
        {pageHeader}

        <div
          role="status"
          className="animate-fade-in rounded-xl border border-warning/30 bg-warning/10 p-4 sm:p-5"
        >
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle aria-hidden="true" className="h-5 w-5 text-warning" />
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
                <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-2 text-xs text-foreground">
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

        <Section
          title="New developer"
          description="The account is created immediately and the developer can sign in with these details."
        >
          <Card className="sm:py-5">
            <CardContent className="sm:px-5">
              <DeveloperForm
                newDeveloper={newDeveloper}
                handleInputChange={handleInputChange}
                handleAddDeveloper={handleAddDeveloper}
                isAddingDeveloper={isAddingDeveloper}
                currentAdmin={currentAdmin}
              />
            </CardContent>
          </Card>
        </Section>

        <DeveloperTable
          developers={developers}
          missingColumns={missingColumns}
          loading={loading}
          error={loadError}
          onRetry={fetchAdminDevelopers}
        />
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        {pageHeader}
        <SkeletonCard lines={4} />
        <Card className="sm:py-5">
          <CardContent className="sm:px-5">
            <SkeletonTable rows={5} cols={4} />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show warning if admin is not logged in
  if (!currentAdmin) {
    return (
      <div className="space-y-6">
        {pageHeader}
        <EmptyState
          icon={Users}
          title="Admin sign-in required"
          description="Please log in as an admin to view developers."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pageHeader}

      <Section
        title="New developer"
        description="The account is created immediately and the developer can sign in with these details."
      >
        <Card className="sm:py-5">
          <CardContent className="sm:px-5">
            <DeveloperForm
              newDeveloper={newDeveloper}
              handleInputChange={handleInputChange}
              handleAddDeveloper={handleAddDeveloper}
              isAddingDeveloper={isAddingDeveloper}
              currentAdmin={currentAdmin}
            />
          </CardContent>
        </Card>
      </Section>

      <DeveloperTable
        developers={developers}
        missingColumns={missingColumns}
        loading={loading}
        error={loadError}
        onRetry={fetchAdminDevelopers}
      />
    </div>
  );
}
