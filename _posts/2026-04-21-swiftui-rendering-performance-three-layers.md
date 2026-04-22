---
layout: post
title: "SwiftUI Rendering Performance: What Nobody Tells You About the Three Layers of Cost"
date: 2026-04-21
description: "I thought I understood how SwiftUI optimized rendering. Turns out, I only understood one third of the picture."
tags: [ios, swiftui, performance, rendering, equatable]
---

> *I recently had a conversation that challenged one of my core assumptions about SwiftUI performance. I thought I understood how SwiftUI optimized rendering. Turns out, I only understood one third of the picture. This post is about all three thirds.*

---

## The Assumption I Was Running With

When developers come from UIKit, we carry a scar — the pain of calling `reloadData()` and watching the entire table re-render, even when only one cell changed. So when we learn SwiftUI, we feel relieved: *"SwiftUI is smart. It only re-renders what changed."*

And that's true. But the question worth asking is: **what exactly does "re-render" mean?**

For a long time, I had a mental model like this:

- SwiftUI creates views cheaply (structs, stack-allocated)
- SwiftUI compares old and new state
- SwiftUI only pushes visual changes to the screen

This is correct. But it's incomplete in a way that matters at scale.

---

## There Are Actually Three Layers of Cost

Once I broke this down properly, the picture got clearer:

```
Level 1: View struct instantiation      →  CHEAPEST  (just stack memory)
Level 2: body evaluation                →  MEDIUM    (your Swift code actually runs)
Level 3: Render commit (CALayer/UIView) →  MOST EXPENSIVE (layout, drawing, GPU)
```

My original mental model was focused entirely on Level 3. And yes — SwiftUI handles Level 3 automatically and brilliantly. It only commits render changes to the underlying layer when something visually changed. You don't have to do anything for this.

**But Level 2 is your responsibility. And SwiftUI does NOT optimize it automatically.**

---

## Why Level 2 Actually Matters

Let's make this concrete. Imagine a feed of 50 cards:

```swift
struct CardView: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            Text(subtitle).font(.subheadline)
            HeavyChartView()        // expensive to compute
            ComplexGradientView()   // expensive to compute
        }
        .padding()
    }
}

struct FeedView: View {
    @StateObject var viewModel: FeedViewModel

    var body: some View {
        ScrollView {
            LazyVStack {
                ForEach(viewModel.cards) { card in
                    CardView(title: card.title, subtitle: card.subtitle)
                }
            }
        }
    }
}
```

When any card's data changes — say the first card gets updated — `FeedViewModel` publishes a change. `FeedView.body` re-evaluates. And here is the part that surprised me:

**All 50 `CardView.body` properties get evaluated.**

SwiftUI then diffs the outputs and only commits the one changed render at Level 3. So the visual update is cheap. But 50 `body` computations ran. If `HeavyChartView` and `ComplexGradientView` have expensive initializers or complex layout trees, that cost adds up — and it adds up on every state change.

---

## The Fix: Make Your View Equatable

Swift structs can synthesize `Equatable` conformance automatically when all their stored properties are `Equatable`. SwiftUI can use this to skip `body` evaluation entirely.

### Step 1: Conform Your View to `Equatable`

```swift
struct CardView: View, Equatable {
    let title: String
    let subtitle: String

    // No need to write == yourself.
    // Swift auto-synthesizes it because String is already Equatable.

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            Text(subtitle).font(.subheadline)
            HeavyChartView()
            ComplexGradientView()
        }
        .padding()
    }
}
```

### Step 2: Apply `.equatable()` at the Call Site

```swift
ForEach(viewModel.cards) { card in
    CardView(title: card.title, subtitle: card.subtitle)
        .equatable() // ← This is the key
}
```

Now SwiftUI compares the old `CardView` struct instance with the new one using `==`. If they're equal, it skips `body` entirely. Not just the render — the entire body evaluation.

For 50 cards where only 1 changed: **49 body evaluations are skipped**.

---

## Alternative: `EquatableView` Wrapper

There's also an explicit wrapper form that does the same thing:

```swift
ForEach(viewModel.cards) { card in
    EquatableView(content: CardView(
        title: card.title,
        subtitle: card.subtitle
    ))
}
```

Both `.equatable()` and `EquatableView` achieve the same outcome. `.equatable()` is more idiomatic and readable in production code. `EquatableView` makes the intent more explicit, which can be useful in team settings where you want the optimization to be obvious at a glance.

---

## Custom `==` — A Hidden Power Move

What if your view has a property that isn't `Equatable` by default? You write the `==` yourself — and you get to decide what "same" means for your view:

```swift
struct CardView: View, Equatable {
    let title: String
    let analyticsMetadata: [String: Any] // Not Equatable

    static func == (lhs: CardView, rhs: CardView) -> Bool {
        // Intentionally ignoring analyticsMetadata
        // because it doesn't affect visual output
        lhs.title == rhs.title
    }

    var body: some View {
        Text(title)
    }
}
```

This is a genuinely powerful pattern. You can explicitly exclude properties that don't affect the UI from your equality check. SwiftUI will skip `body` when the visual-affecting properties haven't changed, even if other properties have.

---

## Let's Measure It — Runnable Benchmark

Theory is good. Numbers are better. Here's a self-contained SwiftUI snippet you can drop into an Xcode project and run. It counts how many times `body` is evaluated with and without `.equatable()`, then shows you the difference:

```swift
import SwiftUI

// Shared counter to track body evaluations
class BodyEvalCounter: ObservableObject {
    var withoutEquatable: Int = 0
    var withEquatable: Int = 0
}

let counter = BodyEvalCounter()

// MARK: - View WITHOUT Equatable

struct CardViewNormal: View {
    let title: String
    let id: Int

    var body: some View {
        let _ = { counter.withoutEquatable += 1 }()
        Text(title)
            .padding(4)
    }
}

// MARK: - View WITH Equatable

struct CardViewEquatable: View, Equatable {
    let title: String
    let id: Int

    var body: some View {
        let _ = { counter.withEquatable += 1 }()
        Text(title)
            .padding(4)
    }
}

// MARK: - Benchmark Host

struct BenchmarkView: View {
    @State private var trigger = false
    @State private var result = ""

    // 50 cards, only index 0 changes
    let cards = (0..<50).map { i in (id: i, title: "Card \(i)") }

    var body: some View {
        VStack(spacing: 20) {
            Text("SwiftUI body Evaluation Benchmark")
                .font(.headline)

            Button("Trigger State Change") {
                counter.withoutEquatable = 0
                counter.withEquatable = 0

                trigger.toggle()

                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    result = """
                    Without .equatable(): \(counter.withoutEquatable) body calls
                    With    .equatable(): \(counter.withEquatable) body calls
                    """
                }
            }
            .buttonStyle(.borderedProminent)

            if !result.isEmpty {
                Text(result)
                    .font(.system(.body, design: .monospaced))
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(10)
            }

            ScrollView {
                VStack {
                    Text("Without .equatable()").font(.caption).foregroundColor(.secondary)
                    ForEach(cards, id: \.id) { card in
                        CardViewNormal(
                            title: card.id == 0 ? (trigger ? "Updated Card 0" : "Card 0") : card.title,
                            id: card.id
                        )
                    }

                    Divider().padding(.vertical)

                    Text("With .equatable()").font(.caption).foregroundColor(.secondary)
                    ForEach(cards, id: \.id) { card in
                        CardViewEquatable(
                            title: card.id == 0 ? (trigger ? "Updated Card 0" : "Card 0") : card.title,
                            id: card.id
                        )
                        .equatable()
                    }
                }
            }
        }
        .padding()
    }
}

#Preview {
    BenchmarkView()
}
```

### What You Should See

When you tap the button, the result will look something like:

```
Without .equatable():  50 body calls
With    .equatable():   1 body calls
```

One state change, 50 cards. Without `.equatable()` — all 50 bodies run. With `.equatable()` — only the 1 card that actually changed runs its body. The other 49 are skipped entirely at Level 2.

Run this yourself and see what you get.

---

## A Word on Level 3 Optimization

Since we covered Level 2 in depth, here's a directional hint on Level 3 — the actual render commit phase.

Even when SwiftUI correctly decides to re-render a view, how that render is committed to the screen matters. A few practical levers:

**`drawingGroup()`** — Rasterizes a complex view hierarchy into a single offscreen Metal texture. Useful when you have many layered views, complex gradients, or heavy blend modes that are expensive to composite in real-time.

```swift
CardView(title: card.title, subtitle: card.subtitle)
    .drawingGroup() // Composites to a single Metal layer
```

**`GeometryReader` sparingly** — `GeometryReader` breaks SwiftUI's layout pass and can trigger cascading re-layouts. Avoid it inside high-frequency-update views.

**`LazyVStack` / `LazyHStack`** — Don't underestimate these. Lazy stacks defer view instantiation until scroll position brings them into view, which means Level 1, 2, and 3 costs are deferred entirely for off-screen content.

**Avoid unnecessary `AnyView` wrapping** — `AnyView` erases type information and forces SwiftUI to treat the wrapped view as a new view on every render, bypassing structural identity entirely. Prefer `@ViewBuilder` with conditional logic instead.

Level 3 optimization is a separate post on its own — but the above four are the ones that move the needle most in production.

---

## Takeaway

Here's the mental model I now carry:

| Layer | What it is | Who optimizes it |
|---|---|---|
| Level 1 | Struct instantiation | Swift (it's free) |
| Level 2 | `body` evaluation | **You** — via `Equatable` + `.equatable()` |
| Level 3 | Visual render commit | SwiftUI (automatic diffing) |

SwiftUI handles the hard part — the actual pixels. But it trusts you to tell it when body computation can be skipped. `Equatable` is how you make that contract explicit.

The benchmark numbers don't lie. 50 body calls vs 1. At scale, across a complex app, that difference is the gap between a smooth 60fps experience and subtle jank that's hard to trace in Instruments.

---

*If you found this useful, I write about iOS engineering, architecture, and the things I'm learning on the job at Target. Feel free to connect on [LinkedIn](https://linkedin.com/in/rajmanikush) or reach out [directly](mailto:rajmanikush@gmail.com).*
