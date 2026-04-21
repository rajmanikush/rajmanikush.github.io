---
layout: post
title: "Welcome to My Blog"
date: 2026-04-21
description: "A quick introduction to why I'm starting to write, what I'll cover, and how this blog is set up."
tags: [meta, ios, swift]
published: false
---

After years of building iOS apps at scale — millions of users, tight latency budgets, and plenty of production fires — I figured it's time to start writing things down. Not just for posterity, but because the act of explaining something is the best way I know to find out if I actually understand it.

## What I'll Write About

Most posts will revolve around iOS and Swift: architecture patterns, tricky concurrency problems, performance wins I've found in the wild. Some will be more general engineering — team dynamics, code review culture, the slow art of making a codebase easier to work in.

Occasionally I'll write about something that has nothing to do with code.

## A Full-Width Image

Here's how a full-width image looks — great for hero shots or wide diagrams:

{% include image.html
   src="/images/fotis-fotopoulos-6sAl6aQ4OWI-unsplash.jpg"
   alt="Code on a screen"
   size="full"
   caption="The usual view from my desk at 11pm"
   credit="Fotis Fotopoulos"
   credit_url="https://unsplash.com/@ffstop" %}

## A Medium Image with Credit

Medium size (640px wide) is good for screenshots, diagrams, or photos that don't need the full width:

{% include image.html
   src="/images/Rajmani-Kushwaha.jpeg"
   alt="Rajmani Kushwaha"
   size="medium"
   credit="Personal photo" %}

## A Small Image

Small (380px) is useful for device mockups, icons, or UI detail shots:

{% include image.html
   src="/images/Rajmani-Kushwaha.jpeg"
   alt="Profile"
   size="small"
   caption="Small size — good for portraits or tight UI shots" %}

## Why Markdown?

Writing in Markdown keeps me focused on the content. No fiddling with a rich-text editor, no accidental formatting, just text. The `{% include image.html %}` shorthand above handles the one thing Markdown can't do well: sized images with captions and attribution.

Here's a quick reference for future me:

```liquid
{% raw %}{% include image.html
   src="/images/posts/my-post/screenshot.png"
   alt="Descriptive alt text"
   size="medium"          <!-- small | medium | large | full -->
   caption="What this shows"
   credit="Photographer Name"
   credit_url="https://source-url.com" %}{% endraw %}
```

Only `src` and `alt` are required. Everything else is optional.

## What's Next

The next post will be a real technical one. Until then — welcome, and thanks for reading.
