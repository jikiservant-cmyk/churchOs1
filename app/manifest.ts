import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'pastorOs',
    short_name: 'pastorOs',
    description: 'Management platform for pastors',
    start_url: '/',
    display: 'standalone',
    background_color: '#F0E6D3',
    theme_color: '#1E1208',
    icons: [
      {
        src: 'https://picsum.photos/seed/pastoros-icon-192/192/192',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: 'https://picsum.photos/seed/pastoros-icon-512/512/512',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
