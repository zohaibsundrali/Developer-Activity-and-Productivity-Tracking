"use client";
import { useState, useEffect, useCallback } from "react";
import { showError, showSuccess, showWarning } from "@/utils/alerts";

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
      const adminData = JSON.parse(localStorage.getItem("adminUser"));
      setCurrentAdmin(adminData);
      
      if (!adminData) {
        showWarning("Login required", "Admin not logged in.");
        setDevelopers([]);
        return;
      }
      
      // Try to fetch developers added by this admin
      try {
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
          
          setDevelopers(allData || []);
        } else {
          setMissingColumns(false);
          setDevelopers(data || []);
        }
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

  const formatDate = (dateString) => {
    if (!dateString) return 'Recently';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Show warning about missing columns
  if (missingColumns && developers.length > 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="mb-6">
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">
                  Database Setup Required
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p>
                    To enable admin isolation (each admin seeing only their own developers), 
                    please run this SQL in Supabase SQL Editor:
                  </p>
                  <pre className="mt-2 bg-yellow-100 p-2 rounded text-xs overflow-x-auto">
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
        
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold">Add Developer</h2>
            {/* {currentAdmin && (
              <p className="text-sm text-gray-500">
                Admin: {currentAdmin.name || currentAdmin.email}
              </p>
            )} */}
          </div>
          
          <button
            onClick={fetchAdminDevelopers}
            className="bg-gray-100 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-200 transition-colors text-sm flex items-center"
            disabled={loading}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
        
        <form onSubmit={handleAddDeveloper} className="space-y-4 max-w-md mb-8">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name *
            </label>
            <input 
              type="text" 
              name="name"
              value={newDeveloper.name}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
              placeholder="Enter developer's full name"
              required
              disabled={isAddingDeveloper || !currentAdmin}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email *
            </label>
            <input 
              type="email" 
              name="email"
              value={newDeveloper.email}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
              placeholder="Enter developer's email"
              required
              disabled={isAddingDeveloper || !currentAdmin}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password *
            </label>
            <input 
              type="password" 
              name="password"
              value={newDeveloper.password}
              onChange={handleInputChange}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
              placeholder="Set temporary password"
              required
              minLength="6"
              disabled={isAddingDeveloper || !currentAdmin}
            />
            <p className="text-xs text-gray-500 mt-1">Password must be at least 6 characters long</p>
          </div>
          
          <div className="flex space-x-3">
            <button 
              type="submit"
              disabled={isAddingDeveloper || !currentAdmin}
              className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                isAddingDeveloper || !currentAdmin
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-[#009578] hover:bg-[#0e7762]'
              } text-white`}
            >
              {!currentAdmin ? 'Please Login' : isAddingDeveloper ? 'Adding...' : 'Add Developer'}
            </button>
          </div>
        </form>
        
        <div className="border-t pt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">
              All Developers
              {developers.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({developers.length} total)
                </span>
              )}
            </h3>
          </div>
          
          {developers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Projects
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Added On
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {developers.map(developer => (
                    <tr key={developer.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {developer.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {developer.email}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex text-xs leading-5 font-semibold rounded-full px-2 py-1 ${
                          developer.status === 'active' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {developer.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        {developer.projects_count || 0}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(developer.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 0c1.013 0 1.827.833 1.827 1.86 0 1.03-.814 1.86-1.827 1.86s-1.827-.83-1.827-1.86c0-1.027.814-1.86 1.827-1.86z" />
              </svg>
              <p className="text-gray-500 text-lg mb-2">No developers added yet</p>
              {/* <p className="text-gray-400 text-sm">Add your first developer using the form above</p> */}
            </div>
          )}
        </div>
      </div>
    );
  }

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

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Add Developer</h2>
          {/* {currentAdmin && (
            <p className="text-sm text-gray-500">
              Admin: {currentAdmin.name || currentAdmin.email}
              {!missingColumns && (
                <span className="ml-2 text-green-600">✓ Isolated Mode</span>
              )}
            </p>
          )} */}
        </div>
        
        <button
          onClick={fetchAdminDevelopers}
          className="bg-gray-100 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-200 transition-colors text-sm flex items-center"
          disabled={loading}
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>
      
      {/* Developer Stats */}
      {developers.length > 0 && (
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
            <p className="text-sm text-gray-600">Total Developers</p>
            <p className="text-2xl font-bold">{developers.length}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg border border-green-100">
            <p className="text-sm text-gray-600">Active</p>
            <p className="text-2xl font-bold">
              {developers.filter(d => d.status === 'active').length}
            </p>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-100">
            <p className="text-sm text-gray-600">Inactive</p>
            <p className="text-2xl font-bold">
              {developers.filter(d => d.status === 'inactive').length}
            </p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
            <p className="text-sm text-gray-600">With Projects</p>
            <p className="text-2xl font-bold">
              {developers.filter(d => (d.projects_count || 0) > 0).length}
            </p>
          </div>
        </div>
      )}
      
      <form onSubmit={handleAddDeveloper} className="space-y-4 max-w-md mb-8">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Full Name *
          </label>
          <input 
            type="text" 
            name="name"
            value={newDeveloper.name}
            onChange={handleInputChange}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
            placeholder="Enter developer's full name"
            required
            disabled={isAddingDeveloper || !currentAdmin}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email *
          </label>
          <input 
            type="email" 
            name="email"
            value={newDeveloper.email}
            onChange={handleInputChange}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
            placeholder="Enter developer's email"
            required
            disabled={isAddingDeveloper || !currentAdmin}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Password *
          </label>
          <input 
            type="password" 
            name="password"
            value={newDeveloper.password}
            onChange={handleInputChange}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
            placeholder="Set temporary password"
            required
            minLength="6"
            disabled={isAddingDeveloper || !currentAdmin}
          />
          <p className="text-xs text-gray-500 mt-1">Password must be at least 6 characters long</p>
        </div>
        
        <div className="p-3 bg-gray-50 rounded-md">
          <p className="text-sm text-gray-600">
            <span className="font-medium">Note:</span> This developer will be linked to your admin account
            {!missingColumns && " and only visible to you"}
          </p>
        </div>
        
        <div className="flex space-x-3">
          <button 
            type="submit"
            disabled={isAddingDeveloper || !currentAdmin}
            className={`flex-1 py-2 px-4 rounded-md transition-colors ${
              isAddingDeveloper || !currentAdmin
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-[#009578] hover:bg-[#0e7762]'
            } text-white`}
          >
            {!currentAdmin ? 'Please Login' : isAddingDeveloper ? 'Adding...' : 'Add Developer'}
          </button>
        </div>
      </form>
      
      {/* Developers List */}
      <div className="border-t pt-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold">
              {!missingColumns ? 'Your Developers' : 'All Developers'}
              {developers.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({developers.length} total)
                </span>
              )}
            </h3>
            {!missingColumns && developers.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                Only developers added by you are shown
              </p>
            )}
          </div>
        </div>
        
        {developers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Projects
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Added On
                  </th>
                  {!missingColumns && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Added By
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {developers.map(developer => (
                  <tr key={developer.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {developer.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-600">
                        {developer.email}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex text-xs leading-5 font-semibold rounded-full px-2 py-1 ${
                        developer.status === 'active' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {developer.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      <span className="font-medium">{developer.projects_count || 0}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(developer.created_at)}
                    </td>
                    {!missingColumns && developer.added_by_name && (
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {developer.added_by_name}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 0c1.013 0 1.827.833 1.827 1.86 0 1.03-.814 1.86-1.827 1.86s-1.827-.83-1.827-1.86c0-1.027.814-1.86 1.827-1.86z" />
            </svg>
            <p className="text-gray-500 text-lg mb-2">
              {!missingColumns ? 'No developers added by you yet' : 'No developers found'}
            </p>
            {/* <p className="text-gray-400 text-sm">Add your first developer using the form above</p> */}
          </div>
        )}
      </div>
    </div>
  );
}