export default function DashboardOverview({ user, developers, projects, onRefresh }) {
  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold text-gray-700 mb-4">
        Dashboard Overview
      </h2>
      <p className="text-gray-600 mb-8">
        Welcome to your admin dashboard. Here you can manage your organization's settings and users.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2">Profile</h3>
          <p className="text-gray-600">Name: {user?.full_name}</p>
          <p className="text-gray-600">Email: {user?.email}</p>
          <p className="text-gray-600">Company: {user?.company}</p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2">Quick Actions</h3>
          <div className="space-y-2">
            <button className="w-full bg-[#009578] text-white p-2 rounded hover:bg-[#0e7762]">
              Manage Users
            </button>
            <button className="w-full bg-[#009578] text-white p-2 rounded hover:bg-[#0e7762]">
              Settings
            </button>
            <button 
              onClick={onRefresh}
              className="w-full bg-gray-500 text-white p-2 rounded hover:bg-gray-600"
            >
              Refresh Data
            </button>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2">Statistics</h3>
          <p className="text-green-600">Developers: {developers.length}</p>
          <p className="text-blue-600">Projects: {projects.length}</p>
          <p className="text-gray-600">Role: {user?.role}</p>
        </div>
      </div>
    </div>
  );
}