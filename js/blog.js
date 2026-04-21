document.addEventListener('DOMContentLoaded', () => {
  // ── Copy buttons ──────────────────────────────────────────────────
  document.querySelectorAll('.post-body pre').forEach(pre => {
    const langWrapper = pre.closest('[class*="language-"]');
    const hasLanguage = langWrapper && !langWrapper.classList.contains('language-plaintext');
    const isMultiLine = pre.textContent.trim().split('\n').length > 1;

    if (!hasLanguage || !isMultiLine) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');

    btn.addEventListener('click', () => {
      const text = (pre.querySelector('code') || pre).textContent.trim();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => showCopied(btn));
      } else {
        const range = document.createRange();
        range.selectNodeContents(pre.querySelector('code') || pre);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.execCommand('copy');
        window.getSelection().removeAllRanges();
        showCopied(btn);
      }
    });

    wrapper.appendChild(btn);
  });

  function showCopied(btn) {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  }

  // ── View count + likes ────────────────────────────────────────────
  const article = document.querySelector('article[data-slug]');
  if (!article) return;

  const slug = article.dataset.slug;
  const viewsEl = document.getElementById('post-views');
  const likeBtn = document.getElementById('like-btn');
  const likeCountEl = document.getElementById('like-count');
  const likeLabelEl = document.getElementById('like-label');

  const likedKey = `liked:${slug}`;
  let isLiked = localStorage.getItem(likedKey) === 'true';

  // Format large numbers: 1200 → "1.2k"
  function fmt(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  // Load initial stats
  fetch(`/api/stats?slug=${encodeURIComponent(slug)}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data) return;

      if (viewsEl) {
        viewsEl.textContent = `${fmt(data.views)} ${data.views === 1 ? 'view' : 'views'}`;
        viewsEl.classList.remove('opacity-0');
      }

      if (likeCountEl) {
        likeCountEl.textContent = fmt(data.likes);
      }

      if (likeLabelEl) {
        updateLikeLabel(data.likes);
      }

      applyLikedState();
    })
    .catch(() => {});

  // Track view once per session (not per refresh)
  const sessionKey = `viewed:${slug}`;
  if (!sessionStorage.getItem(sessionKey)) {
    sessionStorage.setItem(sessionKey, '1');
    fetch(`/api/views?slug=${encodeURIComponent(slug)}`, { method: 'POST' }).catch(() => {});
  }

  // Like button
  if (likeBtn) {
    applyLikedState();

    likeBtn.addEventListener('click', () => {
      const action = isLiked ? 'unlike' : 'like';
      isLiked = !isLiked;
      localStorage.setItem(likedKey, String(isLiked));

      applyLikedState();
      triggerPop();

      fetch(`/api/likes?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          if (likeCountEl) likeCountEl.textContent = fmt(data.likes);
          updateLikeLabel(data.likes);
        })
        .catch(() => {});
    });
  }

  function applyLikedState() {
    if (!likeBtn) return;
    likeBtn.classList.toggle('liked', isLiked);
    likeBtn.setAttribute('aria-pressed', String(isLiked));
  }

  function updateLikeLabel(count) {
    if (!likeLabelEl) return;
    if (count === 0) {
      likeLabelEl.textContent = 'Be the first to like this';
    } else {
      likeLabelEl.textContent = isLiked ? 'You liked this' : `${fmt(count)} ${count === 1 ? 'like' : 'likes'}`;
    }
  }

  function triggerPop() {
    if (!likeBtn) return;
    likeBtn.classList.remove('popping');
    void likeBtn.offsetWidth; // reflow to restart animation
    likeBtn.classList.add('popping');
    likeBtn.addEventListener('animationend', () => likeBtn.classList.remove('popping'), { once: true });
  }
});
