import { AuthProvider } from '@/contexts/AuthContext';
import './globals.css';
import 'sweetalert2/dist/sweetalert2.min.css';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen overflow-x-hidden">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}