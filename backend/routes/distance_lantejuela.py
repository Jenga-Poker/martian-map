import math
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(tags=["distance"])

# Lantejuela, Seville (Spain)
LANTEJUELA_LAT = 37.3536
LANTEJUELA_LON = -5.2247

AU_KM = 149_597_870.7
EARTH_RADIUS_KM = 6371.0
MARS_RADIUS_KM = 3389.5

# Obliquities (deg, approximate)
EARTH_OBLIQUITY_DEG = 23.439281
MARS_OBLIQUITY_DEG = 25.19


class MarsPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Latitude of the point on Mars (degrees)")
    lon: float = Field(..., ge=-180, le=180, description="Longitude of the point on Mars (degrees)")
    height_km: float = Field(0.0, description="Height above the surface of Mars in km")


class DistanceToLantejuelaRequest(BaseModel):
    point: MarsPoint = Field(..., description="Origin point on Mars")
    mars_time: str = Field(
        ...,
        min_length=1,
        description="Time for the orbital calculation (ISO 8601 UTC, e.g. 2026-11-15T12:00:00Z)",
    )


def _parse_time(value: str) -> datetime:
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    # Allow unix timestamp
    try:
        if v.replace(".", "", 1).isdigit() or (v.startswith("-") and v[1:].replace(".", "", 1).isdigit()):
            ts = float(v)
            return datetime.fromtimestamp(ts, tz=timezone.utc)
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(v)
    except ValueError as exc:
        raise ValueError(
            "Invalid time format. Use ISO 8601 UTC (e.g. 2026-11-15T12:00:00Z) or a Unix timestamp."
        ) from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _julian_date(dt: datetime) -> float:
    # Algorithm valid for Gregorian calendar dates
    y = dt.year
    m = dt.month
    d = (
        dt.day
        + (dt.hour + (dt.minute + (dt.second + dt.microsecond / 1e6) / 60.0) / 60.0) / 24.0
    )
    if m <= 2:
        y -= 1
        m += 12
    a = y // 100
    b = 2 - a + a // 4
    jd = math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + b - 1524.5
    return jd


def _deg2rad(d: float) -> float:
    return d * math.pi / 180.0


def _normalize_deg(d: float) -> float:
    d = d % 360.0
    return d + 360.0 if d < 0 else d


def _kepler_E(M_rad: float, e: float) -> float:
    # Solve Kepler's equation M = E - e*sin(E)
    M = M_rad % (2 * math.pi)
    E = M if e < 0.8 else math.pi
    for _ in range(50):
        f = E - e * math.sin(E) - M
        fp = 1 - e * math.cos(E)
        dE = -f / fp
        E += dE
        if abs(dE) < 1e-12:
            break
    return E


def _heliocentric_ecliptic(a_au, e, I_deg, L_deg, lon_peri_deg, lon_node_deg, d):
    # JPL low-precision elements: rates per century d
    I = _deg2rad(I_deg)
    L = _deg2rad(_normalize_deg(L_deg))
    lon_peri = _deg2rad(_normalize_deg(lon_peri_deg))
    lon_node = _deg2rad(_normalize_deg(lon_node_deg))
    M = L - lon_peri
    w = lon_peri - lon_node

    E = _kepler_E(M, e)
    x_orb = a_au * (math.cos(E) - e)
    y_orb = a_au * (math.sqrt(1 - e * e) * math.sin(E))

    cos_w, sin_w = math.cos(w), math.sin(w)
    cos_O, sin_O = math.cos(lon_node), math.sin(lon_node)
    cos_I, sin_I = math.cos(I), math.sin(I)

    x_ecl = (cos_w * cos_O - sin_w * sin_O * cos_I) * x_orb + (-sin_w * cos_O - cos_w * sin_O * cos_I) * y_orb
    y_ecl = (cos_w * sin_O + sin_w * cos_O * cos_I) * x_orb + (-sin_w * sin_O + cos_w * cos_O * cos_I) * y_orb
    z_ecl = (sin_w * sin_I) * x_orb + (cos_w * sin_I) * y_orb
    return x_ecl * AU_KM, y_ecl * AU_KM, z_ecl * AU_KM


def _earth_heliocentric_km(d):
    # Elements and rates (deg/century) approximate
    a = 1.00000261 + 0.00000562 * d
    e = 0.01671123 - 0.00004392 * d
    I = -0.00001531 - 0.01294681 * d
    L = 100.46457166 + 35999.37244981 * d
    lon_peri = 102.93768193 + 0.32327364 * d
    lon_node = 0.0
    return _heliocentric_ecliptic(a, e, I, L, lon_peri, lon_node, d)


def _mars_heliocentric_km(d):
    a = 1.52371034 + 0.00001847 * d
    e = 0.09339410 + 0.00007882 * d
    I = 1.84969142 - 0.00813131 * d
    L = -4.55343205 + 19140.30268499 * d
    lon_peri = -23.94362959 + 0.44441088 * d
    lon_node = 49.55953891 - 0.29257343 * d
    return _heliocentric_ecliptic(a, e, I, L, lon_peri, lon_node, d)


def _rotate_z(v, angle_rad):
    x, y, z = v
    ca, sa = math.cos(angle_rad), math.sin(angle_rad)
    return (ca * x - sa * y, sa * x + ca * y, z)


def _rotate_x(v, angle_rad):
    x, y, z = v
    ca, sa = math.cos(angle_rad), math.sin(angle_rad)
    return (x, ca * y - sa * z, sa * y + ca * z)


def _earth_surface_ecliptic(lat_deg, lon_deg, height_km, jd, d):
    # Earth rotation angle (approx GMST-based inertial longitude)
    theta = _deg2rad(_normalize_deg(280.46061837 + 360.98564736629 * (jd - 2451545.0)))
    lat = _deg2rad(lat_deg)
    lon = _deg2rad(lon_deg)
    r = EARTH_RADIUS_KM + height_km
    # body-fixed (equatorial)
    x_eq = r * math.cos(lat) * math.cos(lon + theta)
    y_eq = r * math.cos(lat) * math.sin(lon + theta)
    z_eq = r * math.sin(lat)
    # equatorial -> ecliptic
    eps = _deg2rad(EARTH_OBLIQUITY_DEG)
    v_ecl = _rotate_x((x_eq, y_eq, z_eq), eps)
    center = _earth_heliocentric_km(d)
    return (center[0] + v_ecl[0], center[1] + v_ecl[1], center[2] + v_ecl[2])


def _mars_surface_ecliptic(lat_deg, lon_deg, height_km, jd, d):
    # Mars prime meridian angle W at time t (approx, Allison & McEwen / IAU)
    # t in days from J2000
    t_days = jd - 2451545.0
    W = _deg2rad(_normalize_deg(176.630 + 350.89198226 * t_days))
    lat = _deg2rad(lat_deg)
    lon = _deg2rad(lon_deg)
    r = MARS_RADIUS_KM + height_km
    x_eq = r * math.cos(lat) * math.cos(lon + W)
    y_eq = r * math.cos(lat) * math.sin(lon + W)
    z_eq = r * math.sin(lat)
    eps = _deg2rad(MARS_OBLIQUITY_DEG)
    v_ecl = _rotate_x((x_eq, y_eq, z_eq), eps)
    center = _mars_heliocentric_km(d)
    return (center[0] + v_ecl[0], center[1] + v_ecl[1], center[2] + v_ecl[2])


@router.post("/distance-to-lantejuela")
async def distance_to_lantejuela(request: DistanceToLantejuelaRequest):
    """Computes the distance in space between a point on Mars and Lantejuela (Seville) at a given time."""
    try:
        dt = _parse_time(request.mars_time)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    jd = _julian_date(dt)
    d = (jd - 2451545.0) / 36525.0  # centuries since J2000

    earth_pos = _earth_heliocentric_km(d)
    mars_pos = _mars_heliocentric_km(d)
    p_mars = _mars_surface_ecliptic(
        request.point.lat, request.point.lon, request.point.height_km, jd, d
    )
    p_earth = _earth_surface_ecliptic(LANTEJUELA_LAT, LANTEJUELA_LON, 0.0, jd, d)

    dx = p_mars[0] - p_earth[0]
    dy = p_mars[1] - p_earth[1]
    dz = p_mars[2] - p_earth[2]
    distance_km = math.sqrt(dx * dx + dy * dy + dz * dz)

    return {
        "distance_km": distance_km,
    }
