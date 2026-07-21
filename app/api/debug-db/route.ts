import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createAdminClient();
    
    const { data: churches, error: churchError } = await supabase
      .schema('church')
      .from('churches')
      .select('*');
      
    const { data: profiles, error: profileError } = await supabase
      .from('admin_profiles')
      .select('*');

    return NextResponse.json({
      churches: churches || [],
      churchError,
      profiles: profiles || [],
      profileError
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
