---
layout: post
title: "Sendable Migration in a Large Codebase: Mental Models That Actually Help"
date: 2026-04-26
description: "Sendable migration in a real production iOS codebase isn't a checklist — it's a cascade. Here are the mental models that helped me move faster and make fewer mistakes."
tags: [ios, swift, concurrency, sendable, swift6]
cover_image: "https://images.unsplash.com/photo-1644088379091-d574269d422f?auto=format&fit=crop&w=1200&q=80"
cover_image_alt: "Abstract blue network visualization with interconnected nodes and lines"
cover_image_credit: "Conny Schneider"
cover_image_credit_url: "https://unsplash.com/@choys_"
---

You fix the error. Five more appear. You fix those. The file count in your PR is now twelve. You started this morning thinking it was a one-hour task.

That's what Sendable migration actually looks like in a large codebase — not a checklist, not a refactor, a cascade. And the frustrating part is that every individual fix is correct. The errors just keep moving.

I've been through this with a production iOS codebase. Not a toy project, not a tutorial app. A real codebase with layers of legacy decisions, protocols shared across modules, ViewModels that grew organically, and service classes that nobody wants to touch because they work. Getting that codebase Sendable-compliant was one of the more frustrating engineering exercises I've had in recent memory — and also one of the more clarifying ones.

This post is not a Sendable explainer. Plenty of those exist. This is about the *decisions* — the moments where the compiler fires an error and you have to choose a path, knowing that each choice has downstream consequences. The mental models I'll share are the ones I kept returning to, the ones that helped me move faster and make fewer mistakes.

---

## The Foundation: Isolation Domains

Before the mental models, one question worth sitting with: what problem does Swift concurrency actually solve that GCD didn't? Most answers focus on syntax — async/await is cleaner, structured concurrency is more readable. Fair. But the real shift is that for the first time, the compiler has an opinion about your concurrency. With GCD, data races were entirely your problem — you could write racy code, ship it, and meet the consequences in a crash report three weeks later from a user in a different time zone. Swift concurrency's bet is that the type system can catch a meaningful class of these errors before any code runs. Sendable is how that bet gets enforced. Swift 6 makes it non-negotiable.

Understanding this reframes the migration. You're not fighting the compiler. You're surfacing real problems that existed before — problems your GCD synchronization was masking through discipline and convention, not structure.

With that in mind, the mental model underneath all of Sendable is *isolation domains*.

Swift concurrency organizes execution into isolated units. The main thread is one domain. Each actor instance is its own domain. A global actor like `@MainActor` defines a shared, named domain — everything annotated with it runs on the same serial executor. When you mark something `nonisolated`, you're explicitly opting out of any domain.

The key question Sendable answers is: **what can safely cross a boundary between two domains?**

When data transfers across isolation boundaries, Swift needs a guarantee that no two domains will concurrently mutate it. Without that guarantee, you have a potential data race — two threads accessing the same memory, at least one of them writing, with no synchronization between them.

Sendable is a marker protocol that provides that guarantee. It doesn't perform the safety work; it *declares* that the safety work has been done, either structurally or manually.

```swift
// Sendable is a protocol with no requirements
// It's purely a compile-time signal to the concurrency system
public protocol Sendable {}
```

With that foundation in place, let's talk about where the actual decisions happen.

---

## Mental Model 1: Know Your Type Category Before You Do Anything

The first mistake people make is treating all Sendable errors the same way. They see an error, they slap on a conformance or an annotation, and they move on. That's how you end up with `@unchecked Sendable` everywhere and a false sense of security.

Before touching a type, categorize it:

**Value types (structs, enums)** — Swift already handles these. If all stored properties are themselves Sendable, the struct gets implicit conformance. Primitive types like `Int`, `String`, `Bool` already conform. Most internal structs get Sendable for free without a single annotation. If you're spending significant time on value types, you're probably solving the wrong problem.

**Reference types (classes, closures)** — No implicit conformance, by design. Sharing a class instance between isolation domains is exactly the scenario Sendable is guarding against. The compiler won't assume it's safe.

**Actors** — Reference types that provide their own Sendable context through serial execution. All access to mutable state is serialized, which satisfies the Sendable guarantee structurally.

The value type layer is nearly free. The work — and every interesting decision — lives in the reference type layer.

---

## Mental Model 2: The Module Boundary Changes the Rules

Here's something that surprised me early in the migration: an internal struct is handled differently from a public one, even if the struct itself is identical.

For an internal struct where all properties are Sendable, Swift grants implicit Sendable conformance. The compiler can inspect the full type definition and verify the guarantee.

For a public struct, Swift refuses implicit conformance — even if the properties look Sendable from the outside. The reason: in library evolution mode (how frameworks with binary compatibility are compiled), a non-frozen public type hides its stored property layout from consuming modules. The compiler genuinely cannot inspect whether all properties are Sendable, because that layout could change in a future version of the library. So it defaults to no conformance.

Two ways to restore it:

```swift
// Option 1: Explicitly declare conformance
public struct UserProfile: Sendable {
    public let id: String
    public let name: String
}

// Option 2: Mark @frozen — committing that the stored layout will never change
@frozen public struct UserProfile {
    public let id: String
    public let name: String
}
// @frozen types get implicit Sendable because the compiler can now trust the layout
```

For most app developers working in a single-module codebase and not shipping frameworks with library evolution enabled, this distinction rarely surfaces. But if you're working on a multi-module architecture or SDK code, it matters more than you'd expect. The rule is: when a public type loses implicit Sendable, don't add conformance blindly — understand which of these two patterns fits your type's contract.

---

## Mental Model 3: Ask Before You Mark — The Class Decision Tree

Reference type errors are where the real thinking happens. When you see a class flagged for Sendable, resist the reflex to immediately reach for `@unchecked Sendable`. Instead, run through this decision tree:

**Can this be a struct?**
The cleanest solution is often to question whether the type needs to be a class at all. If the class doesn't rely on reference semantics — identity, shared mutation, inheritance — restructuring it as a struct eliminates the problem structurally.

**Is this class main-thread only?**
Many classes in an iOS app — ViewModels, coordinators, UI-adjacent services — are realistically only ever accessed from the main thread. For these, `@MainActor` is often the honest and correct answer.

```swift
@MainActor
final class DashboardViewModel: ObservableObject {
    var items: [Item] = []
    // Now safely accessed from MainActor isolation
}
```

This isn't a shortcut — it's a declaration of intent. You're saying: this type belongs to the main thread, and the compiler should enforce that.

**Does this class need to support subclassing?**
Non-final classes cannot conform to `Sendable`. The reason is structural: even if your class is safe today, a subclass can introduce mutable stored properties tomorrow, silently breaking the Sendable contract. Swift enforces `final` as a requirement because it's the only way to close that hole.

If you need both a Sendable class and a class hierarchy, the pattern is *class decomposition* — extract the Sendable-compatible state into a separate final class, and use it as a component rather than a superclass.

**Can this be an actor?**
Actors provide Sendable conformance structurally, through their serial execution guarantee. If the class manages shared mutable state accessed from multiple contexts, an actor is often the right long-term home.

---

## Mental Model 4: Rewrite vs. Escape Hatch — A Real Decision

Consider a class that's already manually synchronized:

```swift
final class BankAccount {
    private var balance: Int = 0
    private let lock = NSLock()

    func deposit(amount: Int) {
        lock.lock()
        balance += amount
        lock.unlock()
    }

    func withdraw(amount: Int) {
        lock.lock()
        if balance >= amount { balance -= amount }
        lock.unlock()
    }

    func getBalance() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return balance
    }
}
```

This is correct code. The synchronization is real. The class is, in practice, thread-safe. The compiler just can't verify that.

You have three options:

**Rewrite to actor:**
```swift
actor BankAccount {
    private var balance: Int = 0

    func deposit(amount: Int) {
        balance += amount
    }

    func withdraw(amount: Int) {
        if balance >= amount { balance -= amount }
    }

    func getBalance() -> Int {
        return balance
    }
}
```

Structurally correct. Compiler-verified. But every call site now requires `await`. In a codebase where this class has dozens of callers, that's a significant ripple.

**Rewrite to `Mutex` (Swift 6):**
`Mutex` is a new synchronization primitive in Swift 6's standard library. Unlike actors, it provides synchronous access — no `await` required. If your consumers are synchronous and you don't want to force async on them, this is worth considering.

**`@unchecked Sendable` as a transitional state:**
```swift
final class BankAccount: @unchecked Sendable {
    private var balance: Int = 0
    private let lock = NSLock()
    // ... same implementation
}
```

This silences the compiler and preserves the existing API. The compiler now trusts you. The risk: if someone removes the lock later — during a refactor, during a "simplification" — the compiler still trusts you. The protection is gone but the false confidence remains. Runtime data races, non-reproducible crashes.

**The honest rule for `@unchecked Sendable`:** treat it as a temporary marker, not a solution. When you use it, leave a comment explaining the synchronization mechanism and the migration path. The long-term destination should almost always be an actor.

---

## Mental Model 5: `nonisolated` and `nonisolated(unsafe)` — Precision Tools

These two are related but solve different problems.

### `nonisolated`

When you have an actor or `@MainActor` type, all of its methods and properties are isolated by default — callers need to `await`. But sometimes a method genuinely doesn't need that protection, because it doesn't touch any mutable state.

```swift
actor UserSession {
    private var authToken: String = ""
    let userId: String  // immutable — set at init, never changes

    // No mutable state touched — nonisolated is correct and honest
    nonisolated func buildAnalyticsTag() -> String {
        return "user-\(userId)"
    }

    // ❌ Won't compile — mutable state accessed from nonisolated context
    nonisolated func getToken() -> String {
        return authToken  // error: actor-isolated property cannot be referenced here
    }
}
```

In practice, `nonisolated` is most useful for methods that format, log, or tag — anything that derives output purely from immutable state. Analytics tag builders, log formatters, display name formatters, and debug description methods are all natural fits. These are the methods that would otherwise force callers to `await` for something that has no business needing a queue.

`nonisolated` is *not* "no restrictions." It's opt-out of isolation with a compiler-enforced constraint: you cannot access any of the actor's mutable state from a nonisolated method. The compiler enforces this strictly.

**Mental model:** "I'm stepping off the actor's queue for this method, which means I can't touch anything that needs the queue."

Use `nonisolated` to keep synchronous APIs clean for callers when the method genuinely has no isolation needs.

### `nonisolated(unsafe)`

A property-level annotation introduced in Swift 5.10. It tells the compiler: stop checking concurrency safety for this specific stored property. You are fully responsible for synchronizing access.

```swift
class LegacyCache: Sendable {
    nonisolated(unsafe) var entries: [String: Data] = [:]
    // compiler will not check 'entries' for concurrent access
    // you must synchronize externally
}
```

Think of it as `@unchecked Sendable` scoped to a single property rather than the whole type. This is useful when one problematic property on an otherwise clean type would otherwise force you to mark the entire type as `@unchecked Sendable`.

The danger is subtlety. `@unchecked Sendable` on a type is at least visible in the type declaration — any reviewer scanning the class will see it. `nonisolated(unsafe)` on a property can be missed. Document it. Treat it with the same caution as `@unchecked Sendable`.

{% include image.html
   src="/images/blog/sendable-migration-large-codebase-mental-models/decision-ladder.png"
   alt="The decision ladder when Sendable conformance is genuinely difficult — four steps from nonisolated to actor migration"
   size="full"
   caption="The decision ladder when Sendable conformance is genuinely difficult" %}

---

## Mental Model 6: The Cascade — What Nobody Warns You About

This is the one that will test your patience in a large codebase. A single Sendable error is almost never just one error. Each fix shifts the boundary, and the error moves to the next type.

Here's an abstract but representative chain:

```swift
// You start here: a service class flagged as non-Sendable
class AnalyticsService {
    var events: [String] = []

    func track(_ event: String) {
        events.append(event)
    }
}
```

**Error 1:** `AnalyticsService` is captured in a `@Sendable` closure — not Sendable.

You add `@unchecked Sendable` (with a lock protecting `events`). Fixed.

```swift
// But AnalyticsService lives in a ViewModel
@MainActor
class DashboardViewModel: ObservableObject {
    let analytics: AnalyticsService

    func userDidTap() {
        Task.detached {
            self.analytics.track("tap")
        }
    }
}
```

**Error 2:** `self` is captured in a detached Task, and `DashboardViewModel` is not Sendable.

You confirm that `@MainActor` isolation handles this. Fixed.

```swift
// But DashboardViewModel conforms to a protocol
protocol ViewModelProtocol: AnyObject {
    func userDidTap()
}
```

**Error 3:** The protocol doesn't carry `@MainActor`. Every conforming type across the module now generates warnings. Adding `@MainActor` to the protocol is the correct fix — but it cascades into every conformance.

```swift
// One of those conformances has a closure
class OnboardingViewModel: ViewModelProtocol {
    var onComplete: (() -> Void)?

    @MainActor func userDidTap() {
        Task {
            onComplete?()  // non-@Sendable closure called from async context
        }
    }
}
```

**Error 4:** `onComplete` needs to be `(@Sendable () -> Void)?`. But the closure is set by a coordinator that captures `self` — and that coordinator isn't Sendable.

And so it continues.

Sendable errors don't disappear. They migrate.

Each individual fix is correct. Each fix is local and makes sense in isolation. And yet, the system is still broken. The errors keep walking outward, toward the edges of your module graph.

**The strategy that actually helps:** work inward-out, not outward-in.

Start from your leaf types — models, value objects, utilities with no dependencies on other custom types. These are almost always cheap to fix. Once the foundation is clean, move up:

{% include image.html
   src="/images/blog/sendable-migration-large-codebase-mental-models/inward-out-migration-order.png"
   alt="The Inward-Out Migration Order — concentric circles showing Models at the core, then ViewModels, Services, Feature layer, and Closures at the outermost ring"
   size="full"
   caption="Stabilize the core first. Let fixes naturally propagate outward." %}

If you start at the ViewModel layer and work backwards, you'll chase errors in circles. The cascade runs from the inside out — your fixes should too.

---

## Mental Model 7: `@unchecked Sendable` Is a Conversation With the Next Developer

The last thing I want to say is about intent. When you write `@unchecked Sendable`, you're not just telling the compiler something — you're telling the next developer who reads this code that you've thought about thread safety here and made a deliberate choice.

That conversation can go well or badly depending on what you leave behind.

**Bad:**
```swift
final class UserCache: @unchecked Sendable {
    var cache: [String: User] = [:]
}
```

Nobody knows why this is unchecked. Nobody knows how `cache` is protected. This is a trap.

**Better:**
```swift
/// Thread safety: `cache` is protected by `cacheLock` (NSLock).
/// Migration path: candidate for actor refactor in Q3.
/// Owner: @yourname
final class UserCache: @unchecked Sendable {
    private let cacheLock = NSLock()
    private var cache: [String: User] = [:]

    func user(for id: String) -> User? {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        return cache[id]
    }
}
```

Document the mechanism. Document the intent. Leave a migration path. `@unchecked Sendable` is a loan, not a gift — eventually someone has to pay it back. Make sure they know what they're inheriting.

---

## Mental Model 8: Correctness Has a Cost — Know What You're Trading

This one doesn't come up in most Sendable guides, but senior engineers will feel its absence. Every choice in this migration is not just about safety — it's about what you're giving up to get there.

**Actors add suspension points.** When you rewrite a class to an actor, every call into it from outside its isolation requires `await`. That's not free. Suspension points mean context switches, and context switches have overhead. In hot paths — think tight loops, scroll performance, rendering — `await` on an actor can introduce latency that's measurable. Actors are the right long-term answer for shared mutable state, but be deliberate about which paths are actually concurrent and which are just "might be accessed from multiple places."

**`@MainActor` can serialize too much.** It's tempting to reach for `@MainActor` broadly because it silences a lot of errors and is correct for UI work. The risk: you can end up running work on the main thread that has no business being there. Heavy computation, network processing, data transformation — if these are `@MainActor` when they don't need to be, you're serializing work that could run concurrently. The result is a technically correct, but slower, app.

**`@unchecked Sendable` preserves performance but concentrates risk.** Keeping your existing NSLock-based synchronization means zero overhead change — your GCD patterns are battle-tested. But the compiler is now blind to that code. Every future change in that file is one refactor away from a silent regression.

**`Mutex` is the underappreciated middle ground.** For synchronous, high-frequency access patterns where you don't want actor overhead and don't want `@unchecked Sendable` risk, `Mutex` from Swift 6's standard library gives you structured synchronization without async propagation. It's worth reaching for before defaulting to either extreme.

The trade-off table, roughly:

| Choice | Safety | Performance | API disruption |
|---|---|---|---|
| Actor | ✅ Structural | ⚠️ Suspension overhead | High — callers need `await` |
| Mutex | ✅ Structural | ✅ Synchronous | Low — API stays sync |
| `@MainActor` | ✅ When correct | ⚠️ Serializes everything | Medium |
| `@unchecked Sendable` | ⚠️ Manual | ✅ No change | None |

There's no universally correct choice. The right one depends on call frequency, whether callers are already async, and how stable the type is. What matters is that you're making the trade-off consciously, not accidentally.

---

## Closing Thought

Swift 6's strict concurrency mode will surface real problems that existed before. Sendable is not bureaucracy — it's the type system asking you to make your concurrency assumptions explicit, so they can be verified rather than hoped for.

The migration is frustrating precisely because it's honest. Every cascade you fight through, every protocol you need to annotate, every closure you need to mark `@Sendable` — these represent real threading assumptions that were implicit before and are now explicit. That's a net gain, even when it doesn't feel like one.

The mental models above are not rules. They're questions that help you make the right call at the right moment, under pressure, in a real codebase where the ideal answer is rarely available and the pragmatic answer needs to be good enough to build on.

And once you see those assumptions — really see them — you can finally change them.

---

*Part of an ongoing series on Swift 6 migration in production codebases.*
