import { POST as handleNajikiWebhook } from '@/app/api/najiki/webhook/route';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleNajikiWebhook(req);
}
