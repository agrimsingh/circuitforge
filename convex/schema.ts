import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  errorSamples: defineTable({
    createdAt: v.number(),
    categories: v.array(v.string()),
    diagnosticsCount: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  errorCategoryStats: defineTable({
    category: v.string(),
    countTotal: v.number(),
    ewmaScore: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_ewmaScore", ["ewmaScore"]),
});
