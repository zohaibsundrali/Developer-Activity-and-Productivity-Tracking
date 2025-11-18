export default function Notifications({ notifications }) {
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">Notifications</h2>
      <div className="space-y-4">
        {notifications.map(notification => (
          <div 
            key={notification.id} 
            className={`p-4 rounded-lg border-l-4 ${
              notification.type === 'success' ? 'border-green-500 bg-green-50' :
              notification.type === 'warning' ? 'border-yellow-500 bg-yellow-50' :
              'border-blue-500 bg-blue-50'
            }`}
          >
            <p className="text-gray-800">{notification.message}</p>
            <p className="text-sm text-gray-500 mt-1">
              {formatDate(notification.created_at)}
            </p>
          </div>
        ))}
      </div>
      {notifications.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">No notifications found.</p>
        </div>
      )}
    </div>
  );
}