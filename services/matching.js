// Resource Rescue Engine - deterministic matching.
//
// This is a RULES-BASED algorithm, not artificial intelligence. The same
// inputs always produce the same plan, and every choice comes with a reason.
//
// Given a request, the engine works in four steps.
//
// STEP 1 - Hard eligibility (a resource that fails ANY rule is discarded, never ranked)
//   H1. Listing is approved.
//   H2. It has remaining stock: quantity_total - quantity_reserved > 0.
//   H3. It belongs to a DIFFERENT organization than the requester.
//   H4. Its availability window covers the request's needed_by date.
//   H5. It is the right kind of thing:
//         exact      - it has an identity tag equal to request.need_tag
//         substitute - request.accepts_substitutes is true AND it has a
//                      substitute tag equal to request.need_tag
//   H6. Pickup is feasible before the deadline (see pickup rules; TBD with the team).
//
// STEP 2 - Ranking (only among resources that passed STEP 1)
//   R1. Exact matches before substitutes.
//   R2. Better condition first: new > good > fair > worn.
//   R3. Closer to the requester first (straight-line distance from coordinates).
//   R4. Larger available quantity first (fewer pickups).
//   R5. Lowest resource id, so ties break the same way every time.
//
// STEP 3 - Combining
//   Walk the ranked list and take min(available, still-needed) from each
//   resource until the request is filled or the list runs out.
//
// STEP 4 - Explaining
//   Each plan line carries a plain-English reason that names the rules it
//   satisfied. If stock runs short, the plan reports the shortfall.
//
// Return shape (implemented later):
//   {
//     requestId, requested, fulfilled, shortfall,
//     lines: [{ resourceId, organizationName, quantity, matchType, reason, pickupNote }],
//     rejected: [{ resourceId, why }]   // optional: shows judges what was filtered out
//   }

export function buildFulfillmentPlan(_requestId) {
  throw new Error('buildFulfillmentPlan is not implemented yet.');
}
