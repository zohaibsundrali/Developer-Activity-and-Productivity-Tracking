"use client";
import { useState } from "react";

export default function AddDeveloper({ user, developers, onRefresh, supabase }) {
  const [newDeveloper, setNewDeveloper] = useState({
    name: "",
    email: "",
    password: ""
  });
  const [isAddingDeveloper, setIsAddingDeveloper] = useState(false);

  const handleAddDeveloper = async (e) => {
    e.preventDefault();
    
    if (!newDeveloper.name.trim() || !newDeveloper.email.trim() || !newDeveloper.password.trim()) {
      alert("Please fill in all fields");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newDeveloper.email)) {
      alert("Please enter a valid email address");
      return;
    }

    const existingDeveloper = developers.find(dev => 
      dev.email.toLowerCase() === newDeveloper.email.toLowerCase()
    );
    
    if (existingDeveloper) {
      alert("A developer with this email already exists");
      return;
    }

    try {
      setIsAddingDeveloper(true);

      const { data, error } = await supabase
        .from('developers')
        .insert([
          {
            name: newDeveloper.name.trim(),
            email: newDeveloper.email.trim(),
            password: newDeveloper.password,
            status: 'active',
            projects_count: 0,
            company: user?.company || 'Unknown Company'
          }
        ])
        .select();

      if (error) throw error;

      await supabase
        .from('notifications')
        .insert([
          {
            message: `New developer "${newDeveloper.name}" added successfully`,
            type: 'success',
            admin_id: user?.id
          }
        ]);

      await onRefresh();

      setNewDeveloper({
        name: "",
        email: "",
        password: ""
      });

      alert("Developer added successfully to database!");
      
    } catch (error) {
      console.error('Error adding developer:', error);
      alert('Error adding developer to database: ' + error.message);
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
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">Add Developer</h2>
      <form onSubmit={handleAddDeveloper} className="space-y-4 max-w-md">
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
            disabled={isAddingDeveloper}
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
            disabled={isAddingDeveloper}
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
            disabled={isAddingDeveloper}
          />
          <p className="text-xs text-gray-500 mt-1">Password must be at least 6 characters long</p>
        </div>
        <div className="flex space-x-3">
          <button 
            type="submit"
            disabled={isAddingDeveloper}
            className={`flex-1 py-2 px-4 rounded-md transition-colors ${
              isAddingDeveloper 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-[#009578] hover:bg-[#0e7762]'
            } text-white`}
          >
            {isAddingDeveloper ? 'Adding...' : 'Add Developer'}
          </button>
        </div>
      </form>
      
      {developers.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4">Recently Added Developers</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {developers.slice(0, 4).map(developer => (
              <div key={developer.id} className="border rounded-lg p-4">
                <h4 className="font-medium">{developer.name}</h4>
                <p className="text-sm text-gray-600">{developer.email}</p>
                <div className="flex justify-between items-center mt-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    developer.status === 'active' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {developer.status}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatDate(developer.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}