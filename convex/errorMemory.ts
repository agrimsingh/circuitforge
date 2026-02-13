import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SAMPLES = 100;

function uniqueSortedCategories(categories: string[]) {
  return [...new Set(categories.map((c) => c.trim()).filter(Boolean))].sort();
}

function getHintForCategory(category: string) {
  if (category.includes("trace")) {
    return "prioritize channel separation and avoid crossing/overlapping routes around dense pins.";
  }
  if (category.includes("via_clearance") || category.includes("via")) {
    return "spread different-net vias apart and avoid placing multiple vias at the same fanout choke point.";
  }
  if (category.includes("clearance")) {
    return "increase spacing around this area and reduce local routing density.";
  }
  if (category.includes("compile")) {
    return "re-check pin labels, selector syntax, and only use valid tscircuit footprint strings.";
  }
  return "treat this as a hotspot and keep the local layout less dense.";
}

export const recordSample = mutation({
  args: {
    categories: v.array(v.string()),
    diagnosticsCount: v.number(),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const createdAt = args.createdAt ?? Date.now();
    const categories = uniqueSortedCategories(args.categories);
    if (categories.length === 0) return { ok: true, persisted: false };

    await ctx.db.insert("errorSamples", {
      createdAt,
      categories,
      diagnosticsCount: args.diagnosticsCount,
    });

    for (const category of categories) {
      const existing = await ctx.db
        .query("errorCategoryStats")
        .withIndex("by_category", (q) => q.eq("category", category))
        .unique();

      if (!existing) {
        await ctx.db.insert("errorCategoryStats", {
          category,
          countTotal: 1,
          ewmaScore: 1,
          lastSeenAt: createdAt,
        });
        continue;
      }

      const elapsed = Math.max(0, createdAt - existing.lastSeenAt);
      const decay = Math.exp(-elapsed / HALF_LIFE_MS);
      const nextEwmaScore = existing.ewmaScore * decay + 1;

      await ctx.db.patch(existing._id, {
        countTotal: existing.countTotal + 1,
        ewmaScore: nextEwmaScore,
        lastSeenAt: createdAt,
      });
    }

    const oldestToTrim = await ctx.db
      .query("errorSamples")
      .withIndex("by_createdAt")
      .order("asc")
      .take(MAX_SAMPLES + 25);

    const overflow = oldestToTrim.length - MAX_SAMPLES;
    if (overflow > 0) {
      for (const sample of oldestToTrim.slice(0, overflow)) {
        await ctx.db.delete(sample._id);
      }
    }

    return { ok: true, persisted: true };
  },
});

export const getAdaptiveGuardrails = query({
  args: {
    maxCategories: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxCategories = Math.min(Math.max(args.maxCategories ?? 3, 1), 8);
    const recentSamples = await ctx.db
      .query("errorSamples")
      .withIndex("by_createdAt")
      .order("desc")
      .take(MAX_SAMPLES);

    if (recentSamples.length < 2) {
      return { guardrails: "", sampleCount: recentSamples.length };
    }

    const stats = await ctx.db
      .query("errorCategoryStats")
      .withIndex("by_ewmaScore")
      .order("desc")
      .take(20);

    const top = stats
      .filter((s) => s.countTotal >= 2)
      .slice(0, maxCategories);

    if (top.length === 0) {
      return { guardrails: "", sampleCount: recentSamples.length };
    }

    const lines = top.map(
      (entry) =>
        `- ${entry.category}: seen ${entry.countTotal} times; ${getHintForCategory(entry.category)}`
    );

    return {
      guardrails: [
        `Adaptive guardrails from recent failed attempts (${recentSamples.length} samples):`,
        ...lines,
      ].join("\n"),
      sampleCount: recentSamples.length,
    };
  },
});
