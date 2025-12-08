"use client";
import { useRouter, useSearchParams } from 'next/navigation';

export default function ProjectDetails() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL parameters se project data get karein
  const project = {
    id: searchParams.get('id'),
    name: searchParams.get('name'),
    description: searchParams.get('description'),
    status: searchParams.get('status'),
    progress: parseInt(searchParams.get('progress') || '0'),
    deadline: searchParams.get('deadline'),
    created_at: searchParams.get('created_at'),
    file_url: searchParams.get('file_url'),
    file_name: searchParams.get('file_name')
  };

  const formatDate = (dateString) => {
    if (!dateString || dateString === 'null') return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleDownloadFile = () => {
    if (project.file_url && project.file_url !== 'null') {
      window.open(project.file_url, '_blank');
    }
  };

  const handleBack = () => {
    router.back(); // Wapas previous page par jao
  };

  const handleSubmitWork = () => {
    alert(`Submit work for project ${project.id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header with Back Button */}
        <div className="flex items-center mb-6">
          <button
            onClick={handleBack}
            className="flex items-center text-gray-600 hover:text-gray-800 mr-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Project Details</h1>
        </div>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Project Header */}
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 text-white">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold mb-2">{project.name}</h1>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  project.status === 'active' ? 'bg-green-100 text-green-800' :
                  project.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {project.status?.charAt(0).toUpperCase() + project.status?.slice(1)}
                </span>
              </div>
            </div>
          </div>

          {/* Project Content */}
          <div className="p-6">
            {/* Description Section */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">Project Description</h2>
              <div className="bg-gray-50 rounded-lg p-4 border">
                <p className="text-gray-700 leading-relaxed">
                  {project.description || 'No description provided for this project.'}
                </p>
              </div>
            </div>

            {/* Progress Section */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">Project Progress</h2>
              <div className="bg-white border rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-lg font-medium text-gray-700">Current Progress</span>
                  <span className="text-2xl font-bold text-blue-600">{project.progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4">
                  <div 
                    className="bg-blue-600 h-4 rounded-full transition-all duration-500"
                    style={{ width: `${project.progress}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Project Timeline */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-white border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2 text-gray-800">Assigned Date</h3>
                <div className="flex items-center text-gray-600">
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>{formatDate(project.created_at)}</span>
                </div>
              </div>

              {project.deadline && project.deadline !== 'null' && (
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-2 text-gray-800">Deadline</h3>
                  <div className="flex items-center text-gray-600">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{formatDate(project.deadline)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* File Attachment */}
            {project.file_url && project.file_url !== 'null' && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">Project Files</h2>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div>
                        <p className="font-semibold text-blue-900">
                          {project.file_name || 'Project Requirements Document'}
                        </p>
                        <p className="text-sm text-blue-700">Download the project requirements and guidelines</p>
                      </div>
                    </div>
                    <button
                      onClick={handleDownloadFile}
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      Download File
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex space-x-4 pt-6 border-t">
              <button
                onClick={handleBack}
                className="flex-1 bg-gray-500 text-white py-3 px-6 rounded-lg hover:bg-gray-600 transition-colors font-medium"
              >
                Back to Projects
              </button>
              <button
                onClick={handleSubmitWork}
                className="flex-1 bg-green-500 text-white py-3 px-6 rounded-lg hover:bg-green-600 transition-colors font-medium"
              >
                Submit Work
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}