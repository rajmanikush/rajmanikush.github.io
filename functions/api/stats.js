// GET /api/stats?slug=<post-slug>
// Returns both view count and like count in one request.
export async function onRequestGet(context) {
  const { env, request } = context;
  const slug = new URL(request.url).searchParams.get('slug');

  if (!slug) {
    return Response.json({ error: 'Missing slug' }, { status: 400 });
  }

  if (!env.BLOG_STATS) {
    // KV not bound (local dev without wrangler) — return zeros gracefully
    return Response.json({ views: 0, likes: 0 });
  }

  const [views, likes] = await Promise.all([
    env.BLOG_STATS.get(`views:${slug}`),
    env.BLOG_STATS.get(`likes:${slug}`),
  ]);

  return Response.json({
    views: parseInt(views || '0'),
    likes: parseInt(likes || '0'),
  });
}
