import { createAdminClient } from './supabase/server';

export interface Church {
  id: string;
  name: string;
  slug: string;
  themeColor: string;
  logoUrl: string;
}

export const getChurchBySlug = async (slug: string): Promise<Church | null> => {
  // Use Admin Client to bypass RLS for public church metadata lookup
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = await createAdminClient();
      console.log(`[getChurchBySlug] Searching for slug: ${slug}`);
      const { data, error } = await supabase
        .schema('church')
        .from('churches')
        .select('*')
        .ilike('slug', slug)
        .maybeSingle();

      if (error) {
        console.error(`[getChurchBySlug] Error fetching church:`, error);
      }
      
      if (data) {
        console.log(`[getChurchBySlug] Found church:`, data.name);
        return {
          id: data.id,
          name: data.name || data.slug,
          slug: data.slug,
          themeColor: data.theme_color || 'bg-blue-600',
          logoUrl: data.logo_url || `https://picsum.photos/seed/${slug}/200/200`,
        };
      } else {
        console.warn(`[getChurchBySlug] No church found for slug: ${slug}`);
        // DEBUG: List all churches to see what's available
        const { data: allChurches } = await supabase.schema('church').from('churches').select('slug');
        console.log(`[getChurchBySlug] Available slugs in DB:`, allChurches?.map(c => c.slug).join(', ') || 'NONE');
      }
    } catch (err) {
      console.error('Supabase admin client error:', err);
    }
  }

  // If no DB match, return null. The logic in actions handles the redirect.
  return null;
};
