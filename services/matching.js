// Resource Rescue Engine - deterministic matching. (Rules written; code comes in build step 3.)
//
// This is a RULES-BASED algorithm, not artificial intelligence. The same inputs always
// produce the same plan, and every choice comes with a reason.
//
// Scope: a request is matched ONLY against listings in the SAME organization, from
// DIFFERENT units. Nothing outside the organization is ever considered.
//
// STEP 1 - Hard eligibility (a listing that fails ANY rule is excluded, never ranked)
//   H1. Same organization as the request.
//   H2. Listing is approved.
//   H3. It has stock left: quantity_total - quantity_reserved > 0.
//   H4. It belongs to a different unit than the requesting unit.
//   H5. Right kind of item:
//         exact      - it has an identity tag equal to request.need_tag
//         substitute - request.accepts_substitutes is true AND it has a substitute tag
//                      equal to request.need_tag (see STEP 3: substitutes only fill a shortfall)
//   H6. Dates: the listing's availability window overlaps [today, request.needed_by].
//   H7. Hand-off feasibility: some date in that overlap falls on a weekday that BOTH the
//       listing's pickup days and the request's days allow (empty = any day), and the two
//       time windows overlap (null = any time).
//   Every exclusion records its reason, shown in the plan's collapsed "Why not these?" list.
//
// STEP 2 - Ranking (only among listings that passed STEP 1)
//   R1. Exact matches before substitutes.
//   R2. Better condition first: new > good > fair > worn (worn items are never excluded).
//   R3. Larger available quantity first, so fewer separate hand-offs are needed.
//   R4. Lowest listing id, so ties break the same way every time.
//
// STEP 3 - Combining
//   a) Walk the ranked EXACT matches and take min(available, still-needed) from each.
//   b) If a shortfall remains and the request accepts substitutes, the engine SUGGESTS the
//      ranked substitute listings. The requester ticks which to include; the server then
//      fills the shortfall from the ticked ones in rank order. Nothing is added unless ticked.
//   c) If a shortfall still remains, the plan may be submitted only when the request allows
//      partial plans; the plan states "covers N of M".
//
// STEP 4 - Explaining
//   Each plan line carries a plain-English reason naming the rules it satisfied
//   (match type, condition, location, the pickup window that works).
//
// SUBMITTING (services/reservations.js)
//   The server recomputes the plan and compares it with the one the requester saw. If it
//   differs (stock changed), NOTHING is reserved: the updated plan is returned for the
//   requester to confirm. Only an unchanged plan is reserved, inside one transaction.
//
// Return shape (implemented in step 3):
//   {
//     requestId, requested, covered, shortfall,
//     lines:       [{ resourceId, unitName, locationName, quantity, matchType, reason, handoff }],
//     suggestions: [{ resourceId, unitName, available, condition, reason }],  // substitutes to tick
//     excluded:    [{ resourceId, name, unitName, why }]
//   }

export function buildFulfillmentPlan(_request, _selectedSubstituteIds = []) {
  throw new Error('buildFulfillmentPlan is not implemented yet.');
}
