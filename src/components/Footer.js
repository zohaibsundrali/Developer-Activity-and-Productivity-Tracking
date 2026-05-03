export default function Footer() {
  return (
    <footer className="bg-white text-black py-12 border-t border-gray-200">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-6 md:mb-0 text-center md:text-left">
            <h2 className="text-lg font-bold mb-2">
              Developer Activity & Productivity Tracking
            </h2>

          </div>

          <div className="text-center md:text-right">
            <p className="text-black text-sm">
              © 2026 All rights reserved.
            </p>

          </div>
        </div>


      </div>
    </footer>
  );
}