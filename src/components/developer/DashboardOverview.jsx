export default function DashboardOverview({ 
  user, 
  assignedProjects, 
  unreadCount, 
  onSectionChange 
}) {
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold text-gray-700 mb-4">
        Developer Dashboard Overview
      </h2>
      <p className="text-gray-600 mb-8">
        Welcome to your developer dashboard. Here you can view your assigned projects and track your activity.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2">Profile</h3>
          <p className="text-gray-600">Name: {user?.name}</p>
          <p className="text-gray-600">Email: {user?.email}</p>
          <p className="text-gray-600">Company: {user?.company}</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2">Statistics</h3>
          <p className="text-green-600">Assigned Projects: {assignedProjects.length}</p>
          <p className="text-blue-600">Active Projects: {assignedProjects.filter(p => p.status === 'active').length}</p>
          <p className="text-gray-600">Completed: {assignedProjects.filter(p => p.status === 'completed').length}</p>
          <p className="text-orange-600">Unread Notifications: {unreadCount}</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2">Quick Actions</h3>
          <div className="space-y-2">
            <button 
              onClick={() => onSectionChange("projects")}
              className="w-full bg-[#009578] text-white p-2 rounded hover:bg-[#0e7762]"
            >
              View My Projects
            </button>
            <button 
              onClick={() => onSectionChange("notifications")}
              className="w-full bg-[#009578] text-white p-2 rounded hover:bg-[#0e7762] relative"
            >
              Notifications
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Recent Projects Preview */}
      {assignedProjects.length > 0 && (
        <div className="mt-8 bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Recent Projects</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assignedProjects.slice(0, 2).map(project => (
              <div key={project.id} className="border rounded-lg p-4">
                <h4 className="font-medium">{project.name}</h4>
                <p className="text-sm text-gray-600 mt-1">Progress: {project.progress}%</p>
                <p className="text-xs text-gray-500">Deadline: {formatDate(project.deadline)}</p>
                <p className={`text-xs mt-1 ${
                  project.status === 'active' ? 'text-green-600' :
                  project.status === 'completed' ? 'text-blue-600' :
                  'text-yellow-600'
                }`}>
                  Status: {project.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}