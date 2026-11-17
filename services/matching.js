// The rescue engine: given a request, it builds a plan from other units' listings.
// It's plain rules, not AI, so the same stock and the same request always give the same plan.
//
// A listing is only considered if it's approved, has stock left, belongs to a different unit in the
// same organization, matches the item (the exact tag, or a substitute tag when the request allows
// substitutes), overlaps the needed-by date, and shares a pickup day and time window with the request.
// Look-alikes that fail one of those go in the "why not these" list, with the reason.
//
// Ranking: exact before substitute, then better condition, then more stock, then lowest id.
// Exact matches fill the request first. Substitutes are only suggested for what's still missing, and
// only used if the requester ticks them. A partial plan can only be submitted if the request allows it.
//
// This file only reads the database. reservations.js rebuilds the plan before reserving anything and
// compares signatures, so a stale plan never gets reserved.
import
{
  db
} from '../database/db.js';
import
{
  WEEKDAYS
} from './requests.js';
import
{
  humanizeTag
} from './tags.js';
import
{
  isoDateFromToday
} from './validation.js';

const CONDITION_RANK =
{
  new: 0,
  good: 1,
  fair: 2,
  worn: 3
};
const DAY_LABEL =
{
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun'
};
const MAX_SEARCH_DAYS = 400; // upper bound when looking for a hand-off date

// Small helpers
const splitDays = (text) => (text ? text.split(',') : []);
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function parseDate(iso)
{
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}
const toIso = (date) => date.toLocaleDateString('en-CA');
const weekdayOf = (iso) => WEEKDAYS[(parseDate(iso).getDay() + 6) % 7]; // JS: 0 = Sunday -> our Mon..Sun

function niceDate(iso)
{
  return parseDate(iso).toLocaleDateString('en-US',
  {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function niceTime(time)
{
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US',
  {
    hour: 'numeric',
    minute: '2-digit'
  });
}
const dayList = (days) => (days.length ? days.map((day) => DAY_LABEL[day]).join(', ') : 'any day');

function timeRange(start, end)
{
  return start ? `${niceTime(start)} to ${niceTime(end)}` : 'any time';
}

/** The time window both sides allow, or null if they do not overlap. A missing window means "any time". */
function overlapTimes(aStart, aEnd, bStart, bEnd)
{
  const start = [aStart, bStart].filter(Boolean).sort().at(-1) ?? null;
  const end = [aEnd, bEnd].filter(Boolean).sort()[0] ?? null;
  if (start && end && start >= end) return null;
  return (
    {
      start,
      end
    }
  );
}

// H6 and H7: can the two sides actually meet?
// Finds the first day and time that works for both sides, or says why there is none.
function checkHandoff(listing, request, today)
{
  const from = listing.available_from > today ? listing.available_from : today;
  const until = listing.available_until < request.needed_by ? listing.available_until : request.needed_by;
  if (from > until)
  {
    return (
      {
        ok: false,
        why: `It is available ${niceDate(listing.available_from)} to ${niceDate(listing.available_until)}, which does not overlap with today through your needed-by date of ${niceDate(request.needed_by)}.`,
      }
    );
  }

  const listingDays = splitDays(listing.pickup_days);
  const requestDays = splitDays(request.pickup_days);
  const shared = WEEKDAYS.filter((day) =>
    (listingDays.length === 0 || listingDays.includes(day)) && (requestDays.length === 0 || requestDays.includes(day)));
  if (shared.length === 0)
  {
    return (
      {
        ok: false,
        why: `No shared day: it can be collected ${dayList(listingDays)}, and your unit is available ${dayList(requestDays)}.`,
      }
    );
  }

  const times = overlapTimes(listing.pickup_time_start, listing.pickup_time_end, request.pickup_time_start, request.pickup_time_end);
  if (!times)
  {
    return (
      {
        ok: false,
        why: `The times do not overlap: it can be collected ${timeRange(listing.pickup_time_start, listing.pickup_time_end)}, and your unit is available ${timeRange(request.pickup_time_start, request.pickup_time_end)}.`,
      }
    );
  }

  const cursor = parseDate(from);
  for (let step = 0; step < MAX_SEARCH_DAYS; step++)
  {
    const iso = toIso(cursor);
    if (iso > until) break;
    if (shared.includes(weekdayOf(iso)))
    {
      return (
        {
          ok: true,
          handoff:
          {
            date: iso,
            timeStart: times.start,
            timeEnd: times.end
          }
        }
      );
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return (
    {
      ok: false,
      why: `None of the days it can be collected (${dayList(shared)}) fall between ${niceDate(from)} and ${niceDate(until)}.`,
    }
  );
}

function handoffSummary(listing, request, handoff)
{
  const when = `${niceDate(handoff.date)}, ${handoff.timeStart ? `${niceTime(handoff.timeStart)} to ${niceTime(handoff.timeEnd)}` : 'any time that day'}`;
  return request.fulfillment_method === 'delivery' ?
    `Delivered to ${request.deliver_to_location_name} (${when}).` :
    `Pick up at ${listing.location_name} (${when}).`;
}

// The plan
/** Order used everywhere: exact first, then condition, then bigger stock, then lowest id. */
function byRank(a, b)
{
  return (a.matchType === 'exact' ? 0 : 1) - (b.matchType === 'exact' ? 0 : 1) ||
    CONDITION_RANK[a.listing.condition] - CONDITION_RANK[b.listing.condition] ||
    b.available - a.available ||
    a.listing.id - b.listing.id;
}

function lineReason(candidate, quantity, position, total, need)
{
  const
  {
    listing,
    available,
    matchType
  } = candidate;
  const kind = matchType === 'exact' ?
    `Exact match for ${need}.` :
    `Substitute for ${need}, included because you chose it to cover the shortfall.`;
  const rank = total > 1 ? ` Ranked ${position} of ${total} ${matchType === 'exact' ? 'exact matches' : 'substitutes'} (better condition first, then larger stock).` : '';
  return `${kind} ${cap(listing.condition)} condition. Taking ${quantity} of ${available} available.${rank}`;
}

// Builds the plan for one request. Reads the database but changes nothing. `today` can be passed in for tests.
export function buildFulfillmentPlan(request, selectedSubstituteIds = [], today = isoDateFromToday(0))
{
  const need = humanizeTag(request.need_tag);
  const selected = new Set(selectedSubstituteIds.filter(Number.isInteger));

  // H1 + H2: this organization's approved listings that match the item by tag (exact or stand-in).
  const rows = db.prepare(
    `SELECT r.*, u.name AS unit_name, l.name AS location_name,
            MAX(CASE WHEN t.kind = 'identity' THEN 1 ELSE 0 END) AS is_exact
     FROM resources r
     JOIN resource_tags t ON t.resource_id = r.id AND t.tag = :tag
     JOIN units u ON u.id = r.unit_id
     JOIN locations l ON l.id = r.location_id
     WHERE r.organization_id = :org AND r.status = 'approved'
     GROUP BY r.id
     ORDER BY r.id`).all(
  {
    tag: request.need_tag,
    org: request.organization_id
  });

  const eligible = [];
  const excluded = [];
  for (const listing of rows)
  {
    const matchType = listing.is_exact === 1 ? 'exact' : 'substitute';
    const available = listing.quantity_total - listing.quantity_reserved;
    const ruled = (why) => excluded.push(
    {
      resourceId: listing.id,
      name: listing.name,
      unitName: listing.unit_name,
      why
    });

    if (listing.unit_id === request.unit_id)
    {
      ruled("It belongs to your own unit, so it is not available to share with you.");
      continue;
    } // H4
    if (available <= 0)
    {
      ruled('None left: everything listed is already reserved.');
      continue;
    } // H3
    if (matchType === 'substitute' && !request.accepts_substitutes)
    { // H5
      ruled(`It can only stand in for ${need}, and this request needs the exact item.`);
      continue;
    }
    const meet = checkHandoff(listing, request, today); // H6 + H7
    if (!meet.ok)
    {
      ruled(meet.why);
      continue;
    }
    eligible.push(
    {
      listing,
      matchType,
      available,
      handoff: meet.handoff
    });
  }
  eligible.sort(byRank);
  excluded.sort((a, b) => a.resourceId - b.resourceId);

  const exact = eligible.filter((candidate) => candidate.matchType === 'exact');
  const substitutes = eligible.filter((candidate) => candidate.matchType === 'substitute');
  const lines = [];
  let remaining = request.quantity;

  const addLine = (candidate, position, total) =>
  {
    const quantity = Math.min(candidate.available, remaining);
    remaining -= quantity;
    lines.push(
    {
      resourceId: candidate.listing.id,
      name: candidate.listing.name,
      unitId: candidate.listing.unit_id,
      unitName: candidate.listing.unit_name,
      locationName: candidate.listing.location_name,
      quantity,
      available: candidate.available,
      condition: candidate.listing.condition,
      matchType: candidate.matchType,
      reason: lineReason(candidate, quantity, position, total, need),
      handoff:
      {
        ...candidate.handoff,
        summary: handoffSummary(candidate.listing, request, candidate.handoff)
      },
      valueCents: quantity * candidate.listing.replacement_value_cents,
    });
  };

  // STEP 3a: exact matches in rank order.
  exact.forEach((candidate, index) =>
  {
    if (remaining > 0) addLine(candidate, index + 1, exact.length);
  });

  // STEP 3b: substitutes are only suggested for a shortfall, and only the ticked ones are used.
  const shortfallBeforeSubstitutes = remaining;
  const suggestions = [];
  if (shortfallBeforeSubstitutes > 0 && request.accepts_substitutes)
  {
    substitutes.forEach((candidate, index) =>
    {
      const chosen = selected.has(candidate.listing.id);
      if (chosen && remaining > 0) addLine(candidate, index + 1, substitutes.length);
      suggestions.push(
      {
        resourceId: candidate.listing.id,
        name: candidate.listing.name,
        unitName: candidate.listing.unit_name,
        locationName: candidate.listing.location_name,
        available: candidate.available,
        condition: candidate.listing.condition,
        selected: chosen,
        quantity: lines.find((line) => line.resourceId === candidate.listing.id)?.quantity ?? 0,
        reason: `Can stand in for ${need}. ${cap(candidate.listing.condition)} condition, ${candidate.available} available. ${handoffSummary(candidate.listing, request, candidate.handoff)}`,
      });
    });
  }

  // STEP 3c: partial plans only when the request allows them.
  const covered = request.quantity - remaining;
  const complete = remaining === 0;
  const partialAllowed = request.accepts_partial === 1;
  const canSubmit = lines.length > 0 && (complete || partialAllowed);
  let blockedReason = null;
  if (!canSubmit)
  {
    blockedReason = lines.length === 0 ?
      'Nothing available can fill this request right now.' :
      `The plan covers ${covered} of ${request.quantity}. This request does not allow a partial plan, so it cannot be submitted. You can edit the request to allow partial plans.`;
  }

  return (
    {
      requestId: request.id,
      requested: request.quantity,
      covered,
      shortfall: remaining,
      complete,
      canSubmit,
      blockedReason,
      lines,
      suggestions,
      excluded,
      totalValueCents: lines.reduce((sum, line) => sum + line.valueCents, 0),
      // Changes whenever what would be reserved changes. The server compares this at submit time.
      signature: signatureOf(lines),
    }
  );
}

/** A short fingerprint of what a plan would reserve: which listing, how many, in which order. */
export function signatureOf(lines)
{
  return lines.map((line) => `${line.resourceId}:${line.quantity}:${line.matchType}`).join('|') || 'empty';
}

/** The request row the engine needs, including the delivery location's name. */
export function loadRequestForPlan(requestId, organizationId)
{
  return db.prepare(
    `SELECT r.*, dl.name AS deliver_to_location_name
     FROM requests r LEFT JOIN locations dl ON dl.id = r.deliver_to_location_id
     WHERE r.id = ? AND r.organization_id = ?`).get(requestId, organizationId) ?? null;
}
