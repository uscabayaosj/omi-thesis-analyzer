// Basemap for every Leaflet surface in the app (MeetingMap, LocationPicker).
//
// Tiles stay on stock OpenStreetMap. Darkening happens in CSS instead, via a
// filter scoped to `.leaflet-tile-pane` in globals.css — see the note there.
//
// Why not a dark tile provider: the obvious candidates all want an API key.
// CARTO's `dark_all` was tried here first and now serves tiles with an
// "API KEY REQUIRED" watermark burned into the image; Stadia and Mapbox are
// keyed too. A key is a deployment secret, a rate limit, and a thing that can
// be revoked — for a single-user personal tool whose whole point is that it
// keeps working offline and unattended, that is a poor trade for a colour
// change we can make locally. The filter costs nothing, cannot expire, and
// leaves OSM's attribution requirements exactly as they were.
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
