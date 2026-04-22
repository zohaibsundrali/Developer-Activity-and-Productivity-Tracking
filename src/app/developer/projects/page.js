	import { redirect } from 'next/navigation';

	export default function DeveloperProjectsPage() {
		redirect('/developer/dashboard?section=projects');
	}
    