import { createAdminClient } from './supabase/server';

export interface Church {
  id: string;
  name: string;
  slug: string;
  themeColor: string;
  logoUrl: string;
}

export const getChurchBySlug = async (slug: string): Promise<Church | null> => {
  if (!slug) return null;

  // Use Admin Client to bypass RLS for public church metadata lookup
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const canonical = slug.toLowerCase().trim();
      // Strict canonical slug check: reject wildcards, special characters, and non-canonical strings
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(canonical)) {
        return null;
      }

      const supabase = await createAdminClient();
      
      // 1. First attempt: Query with select('*') and case-insensitive ilike
      // select('*') never fails on missing optional columns like logo_url
      let { data, error } = await supabase
        .schema('church')
        .from('churches')
        .select('*')
        .ilike('slug', canonical)
        .maybeSingle();

      // 2. Fallback attempt: In case ilike has permission or collation issues, try exact eq
      if (!data && !error) {
        const eqResult = await supabase
          .schema('church')
          .from('churches')
          .select('*')
          .eq('slug', slug.trim())
          .maybeSingle();
        data = eqResult.data;
        error = eqResult.error;
      }

      // 3. Fallback attempt: If select('*') ever fails with missing column (42703), fetch explicit core columns
      if (error && (error as any).code === '42703') {
        console.warn(`[getChurchBySlug] Column error detected, falling back to core columns:`, (error as any).message);
        const coreResult = await supabase
          .schema('church')
          .from('churches')
          .select('id, name, slug')
          .ilike('slug', canonical)
          .maybeSingle();
        data = coreResult.data as any;
        error = coreResult.error;
      }

      if (error) {
        console.error(`[getChurchBySlug] Error fetching church:`, error);
      }
      
      if (data) {
        return {
          id: data.id,
          name: data.name || data.slug,
          slug: data.slug,
          themeColor: (data as any).theme_color || 'bg-blue-600',
          logoUrl: (data as any).logo_url || `https://picsum.photos/seed/${data.slug}/200/200`,
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
