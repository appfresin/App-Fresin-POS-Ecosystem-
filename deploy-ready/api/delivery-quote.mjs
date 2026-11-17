import publicMapKey from "../delivery/geoapify-map-key.js";

const outlet = { latitude: 5.3722219, longitude: 95.9585189 };
const baseDistanceMeters = 4000;
const baseFee = 10000;
const extraFeePerKm = 2500;
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
  url.searchParams.set("mode", "scooter");
  url.searchParams.set("units", "metric");
  url.searchParams.set("apiKey", process.env.GEOAPIFY_ROUTING_API_KEY || publicMapKey);

  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(6500) });
    if (!result.ok) return json({ error: unavailable }, 503);
    const route = await result.json();
    const distanceMeters = route.features?.[0]?.properties?.distance;
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return json({ error: unavailable }, 503);
    const extraKm = Math.max(0, Math.ceil((distanceMeters - baseDistanceMeters) / 1000));
    return json({ distanceMeters, fee: baseFee + extraKm * extraFeePerKm });
  } catch {
    return json({ error: unavailable }, 503);
  }
}
