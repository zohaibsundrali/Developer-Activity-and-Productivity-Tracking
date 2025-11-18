export default function AllProjects({ projects }) {
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleViewProjectActivity = (projectId) => {
    alert(`View Project ${projectId} Activity`);
  };

  const handleViewProjectProductivity = (projectId) => {
    alert(`View Project ${projectId} Productivity`);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">All Projects</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map(project => (
          <div key={project.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
            <h3 className="text-lg font-semibold mb-2">{project.name}</h3>
            <div className="mb-2">
              <div className="flex justify-between text-sm mb-1">
                <span>Progress</span>
                <span>{project.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-[#009578] h-2 rounded-full" 
                  style={{ width: `${project.progress}%` }}
                ></div>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Developers: {project.developers_count}
            </p>
            <p className="text-xs text-gray-500">
              Created: {formatDate(project.created_at)}
            </p>
            <div className="flex space-x-2 mt-3">
              <button 
                onClick={() => handleViewProjectActivity(project.id)}
                className="flex-1 bg-blue-500 text-white py-1 px-3 rounded text-sm hover:bg-blue-600"
              >
                Activity
              </button>
              <button 
                onClick={() => handleViewProjectProductivity(project.id)}
                className="flex-1 bg-green-500 text-white py-1 px-3 rounded text-sm hover:bg-green-600"
              >
                Productivity
              </button>
            </div>
          </div>
        ))}
      </div>
      {projects.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">No projects found in database.</p>
        </div>
      )}
    </div>
  );
}