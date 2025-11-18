"use client";
import { useState } from "react";

export default function ViewDevelopers({ developers, onRefresh, supabase, user }) {
  const [isEditing, setIsEditing] = useState(false);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleViewDeveloper = (developerId) => {
    const developer = developers.find(dev => dev.id === developerId);
    if (developer) {
      alert(`Developer Details:\n\nName: ${developer.name}\nEmail: ${developer.email}\nStatus: ${developer.status}\nProjects: ${developer.projects_count}\nJoin Date: ${formatDate(developer.created_at)}`);
    }
  };

  const handleEditDeveloper = async (developerId) => {
    const developer = developers.find(dev => dev.id === developerId);
    if (developer) {
      const newName = prompt("Enter new name:", developer.name);
      const newEmail = prompt("Enter new email:", developer.email);
      
      if (newName && newEmail) {
        try {
          const { error } = await supabase
            .from('developers')
            .update({ 
              name: newName, 
              email: newEmail,
              updated_at: new Date().toISOString()
            })
            .eq('id', developerId);

          if (error) throw error;

          await onRefresh();
          alert("Developer updated successfully!");
        } catch (error) {
          console.error('Error updating developer:', error);
          alert('Error updating developer: ' + error.message);
        }
      }
    }
  };

  const handleDeleteDeveloper = async (developerId) => {
    const developer = developers.find(dev => dev.id === developerId);
    if (developer && confirm(`Are you sure you want to delete ${developer.name}?`)) {
      try {
        const { error } = await supabase
          .from('developers')
          .delete()
          .eq('id', developerId);

        if (error) throw error;

        await supabase
          .from('notifications')
          .insert([
            {
              message: `Developer "${developer.name}" deleted`,
              type: 'warning',
              admin_id: user?.id
            }
          ]);

        await onRefresh();
        alert("Developer deleted successfully!");
      } catch (error) {
        console.error('Error deleting developer:', error);
        alert('Error deleting developer: ' + error.message);
      }
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">View Developers</h2>
        <button 
          onClick={onRefresh}
          className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 transition-colors"
        >
          Refresh
        </button>
      </div>
      
      <div className="mb-4 flex justify-between items-center">
        <p className="text-gray-600">Total Developers: {developers.length}</p>
        <div className="flex space-x-2">
          <button className="px-3 py-1 border border-gray-300 rounded-md text-sm">
            Active: {developers.filter(d => d.status === 'active').length}
          </button>
          <button className="px-3 py-1 border border-gray-300 rounded-md text-sm">
            Inactive: {developers.filter(d => d.status === 'inactive').length}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
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
                Join Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {developers.map(developer => (
              <tr key={developer.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {developer.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {developer.email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    developer.status === 'active' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {developer.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {developer.projects_count || 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(developer.created_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                  <button 
                    onClick={() => handleViewDeveloper(developer.id)}
                    className="text-blue-600 hover:text-blue-900"
                  >
                    View
                  </button>
                  <button 
                    onClick={() => handleEditDeveloper(developer.id)}
                    className="text-green-600 hover:text-green-900"
                  >
                    Edit
                  </button>
                  <button 
                    onClick={() => handleDeleteDeveloper(developer.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {developers.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">No developers found in database.</p>
        </div>
      )}
    </div>
  );
}