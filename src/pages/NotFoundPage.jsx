import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center text-center px-4">
      <div className="bg-blue-50 p-6 rounded-full mb-6">
        <FileQuestion className="h-16 w-16 text-blue-300" />
      </div>
      <h1 className="text-5xl font-bold text-gray-900 mb-2">404</h1>
      <h2 className="text-2xl font-semibold text-gray-700 mb-4">Page Not Found</h2>
      <p className="text-gray-500 mb-8 max-w-md">
        The page you are looking for doesn't exist, has been moved, or you don't have permission to view it.
      </p>
      <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-700 text-white">
        <Link to="/">Return Home</Link>
      </Button>
    </div>
  );
}
