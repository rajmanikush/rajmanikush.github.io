---
layout: post
title: "Actor Isolation in Swift 6 — @preconcurrency Is Not a Migration Strategy"
date: 2026-05-01
description: "Most Swift 6 migration guides focus on fixing compiler errors. This one is about the bugs that compile cleanly, pass CI, and still break your app in production."
tags: [ios, swift, concurrency, actor-isolation, swift6]
---

> *Most Swift 6 migration guides focus on fixing compiler errors. This one is about the bugs that compile cleanly, pass CI, and still break your app in production. If your migration strategy is "make the compiler green," you will ship bugs like this.*

---

## Where We Left Off

In the previous post, we covered `Sendable` — the Swift 6 mechanism that checks whether **data** can safely cross isolation boundaries.

But there's a second layer to Swift 6 strict concurrency that's less talked about and, in my experience, more dangerous: **actor isolation** — which checks whether **code** is running in the right context.

You can fix every `Sendable` violation in your codebase and still ship a concurrency bug. `Sendable` protects data movement. Actor isolation governs where code is allowed to execute. The failure mode is subtle: your code compiles, passes review, and fails only under production timing.

That's exactly what happened to us.

---

## The Bug That Passed CI

During our Swift 6 migration, we marked our navigation layer `@MainActor` — which is correct. Navigation is a UI concern. UI is main-thread-bound.

```swift
@MainActor
class AppNavigator {
    weak var rootViewController: UINavigationController?

    func navigate(to route: Route) {
        rootViewController?.pushViewController(
            route.viewController,
            animated: true
        )
    }
}
```

Then we hit the expected wall: hundreds of isolation violations across call sites. Instead of fixing them immediately, we introduced `@preconcurrency` to unblock the build. We chose `@preconcurrency` because fixing hundreds of call sites would have blocked the migration for weeks — a trade-off that felt reasonable at the time.

```swift
@preconcurrency
protocol NavigationHandling {
    @MainActor func navigate(to route: Route)
}
```

Build went green. Migration looked done. It wasn't.

We shipped a regression where navigation appeared to work, but intermittently failed under production load — exactly the kind of bug that evades QA and erodes user trust. Some flows would push a view controller but the animation would glitch. Occasionally a screen wouldn't appear at all. No reproducible crash. No clear signal.

The root cause:

```swift
// The bug — simplified
networkService.fetchRegistryDetails(id: registryId) { [weak navigator] result in
    // ⚠️ This closure runs on a background thread
    // @preconcurrency suppressed the compile-time error
    // But navigate() is @MainActor — runtime violation
    switch result {
    case .success:
        navigator?.navigate(to: .registryConfirmation)
    case .failure:
        navigator?.navigate(to: .errorScreen)
    }
}
```

The compiler should have rejected this. `@preconcurrency` suppressed that check. We ended up with compile-time silence, runtime undefined behavior, and production-only symptoms.

The question that naturally follows: **if this was always wrong, why did it work before?**

---

## "But Why Did It Work Before?"

The honest answer: **it didn't work. It just didn't fail loudly enough to notice.**

### UIKit's Lenient Threading Contract

UIKit has always required UI updates to happen on the main thread. But UIKit's enforcement of that contract is inconsistent. Calling UIKit from a background thread is **undefined behavior** — which means:

- Sometimes it works perfectly — UIKit's internal queuing picks it up at the right moment
- Sometimes it glitches — animation artifacts, screens that don't appear correctly
- Sometimes it crashes — but only under specific timing conditions that are hard to reproduce in testing

```swift
// This was always wrong — but UIKit wouldn't always tell you
networkService.fetch { result in
    navigator?.navigate(to: .confirmation) // background thread — undefined behavior
    // Works in development. Fails under production load.
}
```

In a small codebase, this is survivable. In a large team with many engineers, async boundaries everywhere, and no compiler-level enforcement — undefined behavior isn't a rare edge case. **It's a statistical certainty.** Async boundaries are cross-cutting. No single engineer owns them. That's why these bugs survive. Thread Sanitizer helps — but only when the timing window is hit during a test run, which in production is never guaranteed.

### What `@MainActor` Actually Changed

Before `@MainActor`, the threading contract was **implicit** — documented, expected, but not enforced by anything except developer discipline:

```swift
// Before @MainActor — implicit contract
class AppNavigator {
    func navigate(to route: Route) {
        // "Please call me on the main thread" — comment in documentation
        // Nothing stops you from calling this from anywhere
        rootViewController?.push(route.viewController, animated: true)
    }
}
```

After `@MainActor`, the contract becomes **explicit and compiler-enforced**:

```swift
// After @MainActor — explicit contract, compiler guarantee
@MainActor
class AppNavigator {
    func navigate(to route: Route) {
        // This code executes in the main actor context. Always.
        // Not a guideline. A guarantee.
        rootViewController?.push(route.viewController, animated: true)
    }
}
```

That guarantee only holds if you don't disable it. `@preconcurrency` disables it.

### The Real Story of Swift 6

> Swift 6 doesn't make your code wrong. It makes existing violations non-ignorable. `@preconcurrency` gives you a way to delay that reality — but if you rely on it long enough, you're back where you started: undefined behavior, intermittent bugs, no enforcement. The difference is now you chose it.

With that understanding as foundation, let's go deeper into how actor isolation actually works.

---

## Actor Isolation Is an Ownership Model

Most explanations frame actor isolation as a threading rule. That's incomplete.

**Actor isolation is fundamentally about ownership of mutable state.**

```
@MainActor    → UI owns this state — always executes on main thread context
Custom actor  → this component owns this state — serialized, any thread
Nonisolated   → no ownership guarantee — cooperative thread pool
```

Crossing an isolation boundary isn't just "switching threads." It's crossing an ownership boundary — asking "who owns this mutation, and who owns consistency?" That's why Swift requires `await` — not for performance, but for correctness.

Once you frame isolation as ownership, violations are no longer "threading bugs." They're ownership leaks. And ownership leaks don't stay local — they propagate across layers.

In most iOS codebases, 80–90% of isolation decisions come down to two questions:

1. Should this be `@MainActor` — owned by the UI layer?
2. Or should this be nonisolated async work — owned by no specific context?

Custom actors are real but strategic — used for shared mutable state that doesn't belong to the UI layer, like a cache or a data store.

### The Three Isolation Domains

**`@MainActor` — UI ownership**

```swift
@MainActor
class RegistryViewModel: ObservableObject {
    @Published var registries: [Registry] = []

    func updateUI() {
        registries = [] // ✅ Same domain — synchronous access fine
    }
}
```

**Custom Actor — component ownership**

```swift
actor RegistryCache {
    private var cache: [String: Registry] = [:]

    func store(_ registry: Registry) {
        cache[registry.id] = registry // ✅ Actor-isolated — safe
    }

    func retrieve(id: String) -> Registry? {
        cache[id] // ✅ Actor-isolated — safe
    }
}
```

**Nonisolated — no ownership**

```swift
// Runs wherever it's called from — no isolation guarantee
func processRegistryData(_ raw: [RawData]) -> [Registry] {
    raw.map { Registry($0) }
}
```

---

## What Swift 6 Actually Checks

Swift 6 doesn't introduce new rules. It enforces the ones you were already violating — at every call site.

```swift
// This was always wrong — Swift 6 just makes it a compile error
@MainActor
func loadItems() {
    let id = store.selectedId // ⛔ store is a custom actor — synchronous cross-boundary access
}

// The fix — explicit boundary crossing
func loadItems() async {
    let id = await store.selectedId // ✅
}
```

Any code that crossed isolation boundaries without `await` was technically wrong before Swift 6. The compiler now refuses to look away.

---

## The Most Common Isolation Errors

Rather than cataloguing every error pattern, here's the one real-world anti-pattern that covers most cases: **a ViewModel doing both networking and UI updates without clear isolation boundaries.**

```swift
// Common mistake — unclear isolation
class RegistryViewModel: ObservableObject {
    @Published var items: [Registry] = []

    func loadItems() async {
        // Which context is this running in? Unclear.
        let data = try? await registryService.fetch()
        // ⚠️ Updating @Published from unknown context
        self.items = data ?? []
    }
}
```

Swift 6 forces you to answer the question you were avoiding:

```swift
// ✅ Explicit — ViewModel owns UI state, @MainActor enforces it
@MainActor
class RegistryViewModel: ObservableObject {
    @Published var items: [Registry] = []

    func loadItems() async {
        // If isolation isn't correct at the service layer,
        // your ViewModel isolation is only partially correct.
        let data = try? await registryService.fetch()
        // Returns to @MainActor context — safe to update @Published
        self.items = data ?? []
    }
}
```

The pattern applies everywhere: **make isolation explicit, then let the compiler enforce it.**

---

## `@preconcurrency` — What It Actually Does

`@preconcurrency` is often misunderstood as a migration helper. What it actually does is simpler — and more dangerous:

**It tells the compiler to stop enforcing isolation for a piece of code.**

It does not change execution context. It does not insert hops to the correct actor. It does not make unsafe code safe. It only removes visibility of the problem.

### The Organizational Risk

`@preconcurrency` is not just a technical escape hatch — it's an organizational one.

Once introduced, it will spread. It becomes the default way to unblock builds. It creates a false signal that migration is complete. The end state is a codebase that "looks" migrated but behaves like pre-Swift 6. The real risk isn't that it exists. **The risk is that it scales.**

> `@preconcurrency` doesn't reduce migration cost. It defers it — usually into production.

In a large team, without explicit policy, `@preconcurrency` accumulates the same way technical debt does — invisibly, until something breaks.

### The Rules We Converged On

These are the policies that would have saved us time. We enforced them via code review guidelines and lint checks — otherwise rules like these remain aspirational:

1. `@preconcurrency` is only permitted at **external module boundaries** — third-party SDKs, system frameworks not yet Swift 6 compatible
2. Never allowed on **app-layer types** — ViewModels, Navigators, Coordinators
3. Every usage must include a **tracking ticket** for removal
4. Prefer fixing call sites over suppressing errors
5. Treat every isolation error as a **design question**, not a syntax issue

This turns `@preconcurrency` from a shortcut into a deliberate, time-bounded decision.

### Auditing Your Usage

Before calling your migration complete:

```swift
// These need fixing — your own types
@preconcurrency protocol NavigationHandling { ... }
@preconcurrency class AppNavigator { ... }

// These are acceptable — external dependencies
@preconcurrency import LegacyAnalyticsSDK
```

A Swift 6 migration is not complete when the project compiles and warnings are gone. It's complete when isolation boundaries are explicit, no internal code relies on `@preconcurrency`, and actor hops are intentional and minimal.

---

## The Right Fix for Each Case

### `await` — Standard boundary crossing

```swift
// Before — synchronous cross-boundary access
let id = store.selectedId

// After
let id = await store.selectedId
```

### `Task { @MainActor in }` — Explicit hop to correct context

```swift
// Before — closure on background thread calling MainActor code
networkService.fetch { result in
    navigator?.navigate(to: .confirmation) // ⚠️ wrong context
}

// After — explicitly hop to MainActor
networkService.fetch { result in
    Task { @MainActor in
        navigator?.navigate(to: .confirmation) // ✅ correct context
    }
}
```

**Important trade-off:** A common overcorrection is wrapping everything in `Task { @MainActor in }`. Every hop to `@MainActor` is a scheduling decision — excessive hopping increases latency and fragments execution across the cooperative thread pool. Under load, this shows up as delayed UI updates and frame drops. Use it to bridge boundaries intentionally, not as a default pattern.

### `nonisolated` — Deliberate opt-out

```swift
actor RegistryProcessor {
    // Doesn't access actor state — opt out of isolation
    nonisolated func formatTitle(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespaces).capitalized
    }
}
```

---

## What We'd Do Differently — A Migration Playbook

**1. Audit before you annotate**

Map async boundaries before adding a single annotation. Identify which types own UI state, which own data, which are stateless utilities. Isolation decisions made without this map lead directly to `@preconcurrency` spread.

```swift
// Ask these questions for every type:
// Owns UI state?             → @MainActor
// Owns shared mutable state? → actor
// Stateless?                 → nonisolated, no annotation needed
```

**2. Fix the service layer first**

Most teams annotate ViewModels first because they're visible. The harder and more important work is the service layer — network clients, repositories, data processors. If isolation isn't correct at the source, nothing downstream is fully correct.

**3. Use `@preconcurrency` deliberately, not defensively**

When you must use it, make it visible and time-bounded:

```swift
// @preconcurrency: tracked in TICKET-1234 for removal by Q2
@preconcurrency protocol NavigationHandling {
    @MainActor func navigate(to route: Route)
}
```

Without a ticket, `@preconcurrency` becomes invisible debt that no one owns.

**4. Validate beyond the compiler**

A green build is not a complete migration:

- Enable Thread Sanitizer in CI — catches runtime violations the compiler won't
- Audit every `@preconcurrency` on your own types — each is an open isolation question
- Review every `Task { @MainActor in }` — confirm it's a deliberate bridge, not a workaround

**5. Treat isolation errors as design questions**

```
Isolation error appears
        ↓
Don't ask: "What annotation makes this compile?"
Do ask:   "Who should own this state?"
        ↓
Answer that → the right annotation follows naturally
```

---

## Closing the Story — The Fixed Navigation Layer

```swift
// Navigation layer — isolation contract restored
@MainActor
class AppNavigator: NavigationHandling {
    weak var rootViewController: UINavigationController?

    func navigate(to route: Route) {
        rootViewController?.pushViewController(
            route.viewController,
            animated: true
        )
    }
}

// Protocol — no @preconcurrency needed when callers are fixed
protocol NavigationHandling {
    @MainActor func navigate(to route: Route)
}

// ✅ Fixed call site — explicit hop to MainActor
networkService.fetchRegistryDetails(id: registryId) { [weak navigator] result in
    Task { @MainActor [weak navigator] in
        switch result {
        case .success:
            navigator?.navigate(to: .registryConfirmation)
        case .failure:
            navigator?.navigate(to: .errorScreen)
        }
    }
}
```

No `@preconcurrency`. No suppressed warnings. The isolation contract is explicit, and the compiler enforces it.

---

## The Mental Model That Scales

For every call site, ask two questions. If you can't answer them quickly, your architecture is already unclear:

```
What isolation domain am I in?
What isolation domain is the callee in?
        ↓
Same domain?
→ Synchronous call is fine ✅

Different domain?
→ Can I make the caller async? → use await
→ Need to bridge a closure?   → Task { @MainActor in }
→ Method needs no isolation?  → nonisolated
→ Using @preconcurrency?      → you're hiding a bug, not fixing it
```

> Swift 6 gives you enforcement. `@preconcurrency` lets you opt out. After that, the bugs are no longer accidental.

---

## What's Next

The most common isolation domain decision in a SwiftUI codebase is `@MainActor` — when to annotate a class, when to annotate individual methods, when to use `nonisolated` as an escape hatch, and what happens when your ViewModel does work that shouldn't be on the main thread.

That's the next post.

---

*I write about iOS engineering, architecture decisions, and the things I'm learning building at scale at Target. If you've hit similar `@preconcurrency` traps during your Swift 6 migration — I'd genuinely like to hear how you resolved them.*
