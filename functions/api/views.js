// POST /api/views?slug=<post-slug>
// Increments the view counter. Client deduplicates per session.
export async function onRequestPost(context) {
  const { env, request } = context;
  const slug = new URL(request.url).searchParams.get('slug');

  if (!slug) {
    return Response.json({ error: 'Missing slug' }, { status: 400 });
  }

  if (!env.BLOG_STATS) {
    return Response.json({ views: 0 });
  }

  const key = `views:${slug}`;
  const current = parseInt(await env.BLOG_STATS.get(key) || '0');
  const updated = current + 1;
  await env.BLOG_STATS.put(key, String(updated));

  return Response.json({ views: updated });
}
