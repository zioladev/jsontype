// A deliberately messy API response that exercises every inference rule:
// nulls, keys missing from some array items, an empty array, mixed arrays.
export const SAMPLE = `{
  "id": "ord_8f2k1x",
  "created_at": "2026-09-24T17:45:03Z",
  "status": "shipped",
  "total": 184.5,
  "currency": "USD",
  "gift": false,
  "coupon": null,
  "customer": {
    "id": 30142,
    "name": "Ada Park",
    "email": "ada@example.com",
    "phone": null,
    "address": {
      "line1": "88 Harbor St",
      "city": "Portland",
      "postal-code": "97209",
      "geo": { "lat": 45.53, "lng": -122.68 }
    }
  },
  "items": [
    { "sku": "MUG-01", "title": "Stoneware mug", "qty": 2, "price": 24, "tags": ["kitchen", "gift"] },
    { "sku": "TEE-M", "title": "Logo tee", "qty": 1, "price": 32, "tags": [], "size": "M" },
    { "sku": "BAG-XL", "title": "Tote", "qty": 1, "price": 40.5, "tags": ["canvas"], "discount": { "code": "FALL10", "pct": 10 } }
  ],
  "shipments": [
    { "carrier": "UPS", "tracking": "1Z999AA10123456784", "events": [
      { "at": "2026-09-24T19:00:00Z", "where": "Portland, OR", "note": null },
      { "at": "2026-09-25T08:12:00Z", "where": "Sacramento, CA", "note": "Arrived at facility" }
    ] }
  ],
  "notes": [],
  "metadata": { "source": "web", "ab": ["checkout_v2", 7, true] }
}
`;
