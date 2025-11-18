import "./globals.css";

export const metadata = {
  title: "Developer Activity Tracking",
  description: "Track developer activity and productivity",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}