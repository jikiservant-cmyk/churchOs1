import { logout } from '@/lib/auth-actions';
import { redirect } from 'next/navigation';

export async function POST(req: Request) {
  const formData = await req.formData();
  await logout(formData);
  // Expected to redirect dynamically inside the server action, but just in case:
  const churchSlug = formData.get('churchSlug') as string;
  redirect(`/${churchSlug}/admin/login`);
}
