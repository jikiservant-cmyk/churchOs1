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
      const canonical = slug.toLowerCase().trim();
      // Strict canonical slug check: reject wildcards, special characters, and non-canonical strings
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(canonical)) {
        return null;
      }

      const supabase = await createAdminClient();
      const { data, error } = await supabase
        .schema('church')
        .from('churches')
        .select('id, name, slug, theme_color, logo_url')
        .eq('slug', canonical)
        .maybeSingle();

      if (error) {
        console.error(`[getChurchBySlug] Error fetching church:`, error);
      }
      
      if (data) {
        return {
          id: data.id,
          name: data.name || data.slug,
          slug: data.slug,
          themeColor: data.theme_color || 'bg-blue-600',
          logoUrl: data.logo_url || `https://picsum.photos/seed/${slug}/200/200`,
        };
      } else {
        console.warn(`[getChurchBySlug] No church found for slug: ${slug}`);
      }
    } catch (err) {
      console.error('Supabase admin client error:', err);
    }
  }

  // If no DB match, return null. The logic in actions handles the redirect.
  return null;
};
