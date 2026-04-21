// POST /api/likes?slug=<post-slug>
// Body: { action: "like" | "unlike" }
// Toggles the like counter. Client tracks state in localStorage.
export async function onRequestPost(context) {
  const { env, request } = context;
  const slug = new URL(request.url).searchParams.get('slug');

  if (!slug) {
    return Response.json({ error: 'Missing slug' }, { status: 400 });
  }

  if (!env.BLOG_STATS) {
    return Response.json({ likes: 0 });
  }

  let action = 'like';
  try {
    const body = await request.json();
    action = body.action === 'unlike' ? 'unlike' : 'like';
  } catch (_) {}

  const key = `likes:${slug}`;
  const current = parseInt(await env.BLOG_STATS.get(key) || '0');
  const updated = action === 'unlike' ? Math.max(0, current - 1) : current + 1;
  await env.BLOG_STATS.put(key, String(updated));

  return Response.json({ likes: updated });
}
