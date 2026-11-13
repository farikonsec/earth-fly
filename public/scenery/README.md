# Alpine reference scenery

`alps.json` is a derived OpenStreetMap database distributed under the Open Database License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/ . © OpenStreetMap contributors. Attribution and source information: https://www.openstreetmap.org/copyright . The data is available directly at `/scenery/alps.json` in the local/static game.

Retrieved on 2026-10-18 via the Overpass API. Requested bounds: south 46.55°, west 7.8°, north 46.85°, east 8.2°. Complete lake relations may extend beyond the requested bounds.

Included features: mapped `natural=water` areas, `waterway=river` centre lines, and closed `landuse=forest` / `natural=wood` ways. Relation outer/inner ways are assembled into rings. Coordinates are rounded to six decimal places; forest polygons smaller than 4,000 m² are omitted. OSM identifiers, mapped names, and tagged water elevations are retained. Source query and preparation scripts remain under `work/milestone-03/`.

The visual trees are procedural conifers distributed within mapped forest boundaries, excluding water, high elevations and steep slopes. They are not individually surveyed trees. Terrain imagery and elevation have separate provenance. Untagged water elevations are approximated from nearby terrain; river ribbons and water rendering are visual approximations, not a hydrological simulation.

Scenery coverage is regional. No global forest/river completeness is implied.

## Caspian Sea — separate Natural Earth data

`caspian.json` is a generalized polygon extracted from Natural Earth's 1:10m geography marine polygons. Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/ . Source URL and pinned hash are in ../terrain/regions-manifest.json. It is separate from the Alpine ODbL database above. The game assigns a fixed historical approximation of −28 m MSL; neither the polygon nor level represents current measurements. Preparation: scripts/prepare-regions.ts.

## Absheron detailed coastline — 0.14

© OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright . The source database snapshot is absheron-osm-source.json; the derived combined water polygon is absheron.json, with its manifest in absheron-manifest.json. Source query and timestamp remain in these files. The unchanged Natural Earth base remains caspian.json. Regenerate the derivative locally with bun scripts/prepare-absheron.ts. This detailed peninsula coastline and islands are combined with the public-domain Natural Earth outline; the derivative is distributed under ODbL. The fixed −28 m water level is still an educational reference, not a current gauge measurement.

## Central London buildings — 0.19

© OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright . `london.bin` is a derived database of building and `building:part` footprints between 51.485°–51.525° N and 0.155°–0.005° W, retrieved through the Overpass API; timestamp, source hash and counts are in `london-manifest.json`. Regenerate with `bun scripts/prepare-london.ts --refetch` (raw tiles land in `work/london/`, outside the bundle).

Heights come from `height` or `building:levels` where mapped (about half the features). Other buildings receive a plausible height from their type and footprint, so the skyline away from mapped landmarks is indicative, not surveyed. Roof shapes are reduced to flat, pyramid and dome. Facade colours, windows and night lighting are procedural. The London Eye is hand-modelled at its mapped position. Ground under the city is regraded to street level because the elevation source includes rooftops.

## Thames and Docklands water — 0.20

© OpenStreetMap contributors, ODbL 1.0. `london-water.json` holds the tidal Thames (multipolygon relations 28934, 70347, 11511596), its creeks and the Docklands basins as sea-level water polygons; park ponds and canals above sea level are left to the imagery. Source snapshots stay in `work/london/`. Regenerate with `bun scripts/prepare-london-water.ts`. The water surface is a visual approximation at a fixed 0 m, not a tide model.

## Streamed buildings and airfields — 0.21

Outside the bundled central-London set, buildings, runways, taxiways and aprons are streamed while you fly from OpenFreeMap's public vector tiles (https://openfreemap.org , OpenMapTiles schema, © OpenMapTiles, data © OpenStreetMap contributors, ODbL). Only zoom-14 tiles around the aircraft are requested, they are held in memory for the session and nothing is bulk-downloaded or redistributed. Building heights use the tiles' `render_height`; where the map has none, a height is estimated from the footprint, and small footprints get a hipped house roof. Runway and taxiway widths are fixed (50 m and 22 m) and the markings are procedural, not surveyed. Without a network connection this layer is simply absent.

## Streamed roads, water, trees and place names — 0.22

The same OpenFreeMap tiles (OpenMapTiles schema, © OpenMapTiles, data © OpenStreetMap contributors, ODbL) now also supply roads by class (motorway, trunk/A road, primary to service), railways, rivers, canals, lakes, woods, parks and place names. Road widths and lane markings are procedural per class, not surveyed lane counts. Trees are scattered procedurally inside mapped woods and parks and along residential streets; they are not individually surveyed. A close-range Esri World Imagery patch at zoom 18 (about 0.35 m per pixel in the UK) is streamed under the aircraft below 1.8 km.
