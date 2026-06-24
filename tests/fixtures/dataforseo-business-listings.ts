/**
 * Real (trimmed) DataForSEO response shapes captured live on 2026-06-24 (SEO Decision
 * Engine P7 — GBP + reviews local layer). GROUND TRUTH for the parsers — field names are
 * validated, not guessed (the P6 lesson: a paid integration built on guessed field names is
 * the #1 bug class in this repo).
 *
 * Two data paths exist for review data:
 *
 *  1. FREE — the `local_pack` items returned by `serp/google/organic/live/advanced` (which
 *     `getLocalVisibility` ALREADY fetches today) carry `rating: { value, votes_count, rating_max }`.
 *     The current `extractLocalPackItems` parser DROPS these — `LocalVisibilityBusinessResult`
 *     has no rating/reviewCount field. Extracting them is zero new endpoint cost (P3-style).
 *
 *  2. PAID — `business_data/business_listings_search` returns the full category landscape in one
 *     call: each `business_listing` carries `rating: { value, votes_count }` (star + review count),
 *     `rating_distribution`, `place_id`/`cid`/`domain`/`feature_id` (client-vs-competitor match keys),
 *     GBP `attributes` (completeness), `total_photos`, claimed status, and a `people_also_search`
 *     competitor set. Sort by `rating.votes_count,desc` to get the review leaders directly.
 *
 * Key shape facts the parser depends on:
 *  - rating MAY be `{ rating_type: 'Max5' }` ALONE when a business has zero reviews — `value` and
 *    `votes_count` are ABSENT, not 0. Treat missing as "no reviews yet" (undefined), never coerce to 0.
 *  - review count = `rating.votes_count`; star rating = `rating.value`.
 *  - client-vs-competitor match: prefer `place_id`/`cid`, fall back to `domain`.
 */

/** PAID: `business_data/business_listings_search` (categories:['Dentist'], SF coords). */
export const BUSINESS_LISTINGS_SEARCH = {
  items: [
    {
      type: 'business_listing',
      title: 'Bridges Thomas C DDS',
      category: 'Dentist',
      category_ids: ['dentist'],
      cid: '1000516232650939037',
      feature_id: '0x8085808ecf6e6c73:0xde28c366f2bda9d',
      address: '450 Sutter St, San Francisco, CA 94108',
      address_info: { borough: 'Union Square', address: '450 Sutter St', city: 'San Francisco', zip: '94108', region: 'California', country_code: 'US' },
      place_id: 'ChIJc2xuz46AhYARndorbzaM4g0',
      phone: '+1415-387-1010',
      // NOTE: no `domain`/`url` on this one (unclaimed-ish); present on others below.
      total_photos: 1,
      latitude: 37.789,
      longitude: -122.408,
      attributes: {
        available_attributes: {
          accessibility: ['has_wheelchair_accessible_entrance', 'has_wheelchair_accessible_restroom'],
          amenities: ['has_restroom'],
          planning: ['recommends_appointment'],
          payments: ['pay_credit_card', 'pay_debit_card'],
        },
      },
      // A business WITH reviews: value + votes_count present.
      rating: { rating_type: 'Max5', value: 5, votes_count: 1 },
      rating_distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
      people_also_search: [
        { cid: '13262219612302700883', title: 'Bridges Dental', rating: { rating_type: 'Max5', value: 5, votes_count: 3 } },
        // A business with ZERO reviews: rating is `{ rating_type }` ONLY — value/votes_count ABSENT.
        { cid: '3303512502471122876', title: "Day's Dental Office", rating: { rating_type: 'Max5' } },
      ],
      check_url: 'https://www.google.com/maps?cid=1000516232650939037&hl=en&gl=US',
      last_updated_time: '2026-04-06 05:34:25 +00:00',
      first_seen: '2024-07-15 05:30:42 +00:00',
    },
    {
      type: 'business_listing',
      title: 'Chan Siu Wan DDS',
      category: 'Dentist',
      cid: '10006378208112126546',
      place_id: 'ChIJrVqv-36HhYARUqq71vbL3Yo',
      address: '2323 Noriega St Ste 208, San Francisco, CA 94122',
      address_info: { borough: 'Sunset District', address: '2323 Noriega St Ste 208', city: 'San Francisco', zip: '94122', region: 'California', country_code: 'US' },
      phone: '+1415-759-7888',
      url: 'http://www.sfdentalgroup.com/',
      domain: 'www.sfdentalgroup.com',
      total_photos: 1,
      attributes: { available_attributes: { accessibility: ['has_wheelchair_accessible_entrance'], payments: ['pay_credit_card'] } },
      // A claimed business that has NO aggregate rating block at all (field absent).
      check_url: 'https://www.google.com/maps?cid=10006378208112126546&hl=en&gl=US',
      last_updated_time: '2026-04-11 14:36:46 +00:00',
      first_seen: '2024-07-29 14:18:36 +00:00',
    },
  ],
};

/** FREE: `local_pack` items from `serp/google/organic/live/advanced` ("dentist san francisco"). */
export const LOCAL_PACK_WITH_RATINGS = {
  items: [
    {
      type: 'local_pack',
      rank_group: 1,
      rank_absolute: 1,
      title: 'Folsom Street Dental',
      description: '1130 Folsom St · (415) 552-7874 \nOpen · Closes 7 PM \n',
      domain: 'folsomstreetdental.com',
      phone: '(415) 552-7874',
      url: 'http://folsomstreetdental.com/',
      // The rating the current parser DROPS: star value + review count are right here, free.
      rating: { rating_type: 'Max5', value: 4.9, votes_count: 987, rating_max: 5 },
      cid: '18296760864901093605',
    },
    {
      type: 'local_pack',
      rank_group: 2,
      rank_absolute: 2,
      title: 'The Dentist Group',
      domain: 'www.thedentistgroup.com',
      phone: '(415) 706-7687',
      url: 'http://www.thedentistgroup.com/',
      rating: { rating_type: 'Max5', value: 4.7, votes_count: 258, rating_max: 5 },
      cid: '5094846003686125696',
    },
    {
      type: 'local_pack',
      rank_group: 3,
      rank_absolute: 3,
      title: 'Young Dental SF Group',
      domain: 'youngdentalsf.com',
      phone: '(415) 392-8611',
      url: 'https://youngdentalsf.com/?utm_source=GBPYDEprompt',
      rating: { rating_type: 'Max5', value: 4.8, votes_count: 903, rating_max: 5 },
      cid: '876487852680128443',
    },
  ],
};
