"use client";
import { useRouter } from 'next/navigation';

export default function MyProjects({ assignedProjects, supabase }) {
  const router = useRouter();

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleDownloadFile = (project) => {
    if (project.file_url) {
      window.open(project.file_url, '_blank');
    }
  };

  const handleViewProject = (project) => {
    // Project details ko URL parameters ke through bhejna
    router.push(`/developer/project-details?id=${project.id}&name=${encodeURIComponent(project.name)}&description=${encodeURIComponent(project.description || '')}&status=${project.status}&progress=${project.progress}&deadline=${project.deadline || ''}&created_at=${project.created_at}&file_url=${project.file_url || ''}&file_name=${project.file_name || ''}`);
  };

  const handleSubmitWork = (projectId) => {
    alert(`Submit work for project ${projectId}`);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">My Assigned Projects</h2>
      
      {assignedProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {assignedProjects.map(project => (
            <div key={project.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-lg font-semibold">{project.name}</h3>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  project.status === 'active' ? 'bg-green-100 text-green-800' :
                  project.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {project.status}
                </span>
              </div>
              
              {project.description && (
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                  {project.description}
                </p>
              )}
              
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

              <div className="space-y-1 mb-3">
                {project.deadline && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Deadline:</span> {formatDate(project.deadline)}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  Assigned: {formatDate(project.created_at)}
                </p>
              </div>

              {/* File Attachment */}
              {project.file_url && (
                <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-blue-700 truncate">
                        {project.file_name || 'Requirements File'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDownloadFile(project)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      Download
                    </button>
                  </div>
                </div>
              )}

              <div className="flex space-x-2">
                <button 
                  onClick={() => handleViewProject(project)}
                  className="flex-1 bg-blue-500 text-white py-1 px-3 rounded text-sm hover:bg-blue-600"
                >
                  View Project
                </button>
                <button 
                  onClick={() => handleSubmitWork(project.id)}
                  className="flex-1 bg-green-500 text-white py-1 px-3 rounded text-sm hover:bg-green-600"
                >
                  Submit Work
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-500">No projects assigned to you yet.</p>
        </div>
      )}
    </div>
  );
}