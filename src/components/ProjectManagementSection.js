export default function ProjectManagementSection() {
const projectFeatures = [
    { name: 'Task Time Estimation', included: true },
    { name: 'Actual vs Estimated Analysis', included: true },
    { name: 'Progress Monitoring', included: true },
    { name: 'Project Timeline View', included: true }
];

const reportFeatures = [
    'Daily & weekly productivity reports',
    'Time spent on apps & websites',
    'Task completion status charts',
    'Filter reports by date range',
    'Export reports to PDF format'
];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
      <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200">
        <h3 className="text-2xl font-bold text-black mb-6">Project Planning</h3>
        <p className="text-gray-600 mb-6 font-light">
          Create work breakdown structures, estimate tasks, and track actual vs. 
          estimated time and budget.
        </p>
        
        <div className="space-y-4">
          {projectFeatures.map((feature, index) => (
            <div key={index} className="flex items-center justify-between py-3 border-b border-gray-100">
              <span className="text-gray-700">{feature.name}</span>
              <span className="font-bold text-green-600">✓ Included</span>
            </div>
          ))}
        </div>
      </div>
      
      <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-200">
        <h3 className="text-2xl font-bold text-black mb-6">Reports & Invoices</h3>
        <p className="text-gray-600 mb-6 font-light">
          Generate professional reports and invoices with multiple export options.
        </p>
        
        <div className="space-y-4">
          {reportFeatures.map((item, index) => (
            <div key={index} className="flex items-center">
              <svg className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-gray-700">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}