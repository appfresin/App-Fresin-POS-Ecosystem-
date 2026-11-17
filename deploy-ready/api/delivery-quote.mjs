import publicMapKey from "../delivery/geoapify-map-key.js";

const outlet = { latitude: 5.3722219, longitude: 95.9585189 };
const minimumFee = 10000;
const feePerKm = 2500;
const feeRoundingIncrement = 500;
const unavailable = "Rute motor belum bisa dihitung. Coba lagi.";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function validCoordinate(value, limit) {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

export async function POST(request) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return json({ error: "Permintaan tidak diizinkan." }, 403);
  }
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return json({ error: "Format permintaan tidak valid." }, 415);
  }

  let pin;
  try {
    const body = await request.text();
    if (body.length > 256) return json({ error: "Permintaan terlalu besar." }, 413);
    pin = JSON.parse(body);
  } catch {
    return json({ error: "Pin lokasi tidak valid." }, 400);
  }
  const { latitude, longitude } = pin || {};
  if (!validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)) {
    return json({ error: "Pin lokasi tidak valid." }, 400);
  }

  const url = new URL("https://api.geoapify.com/v1/routing");
  url.searchParams.set("waypoints", `${outlet.latitude},${outlet.longitude}|${latitude},${longitude}`);
  // Scooter/moped routing can take detours that do not apply to delivery motorcycles.
  url.searchParams.set("mode", "motorcycle");
  url.searchParams.set("type", "balanced");
  url.searchParams.set("units", "metric");
  url.searchParams.set("apiKey", process.env.GEOAPIFY_ROUTING_API_KEY || publicMapKey);

  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(6500) });
    if (!result.ok) return json({ error: unavailable }, 503);
    const route = await result.json();
    const distanceMeters = route.features?.[0]?.properties?.distance;
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return json({ error: unavailable }, 503);
    // Price at two decimal kilometers while retaining the original route distance.
    const billableDistanceMeters = Math.round(distanceMeters / 10) * 10;
    const proportionalFee = billableDistanceMeters * feePerKm / 1000;
    const fee = Math.max(minimumFee, Math.round(proportionalFee / feeRoundingIncrement) * feeRoundingIncrement);
    return json({ distanceMeters, fee });
  } catch {
    return json({ error: unavailable }, 503);
  }
}
