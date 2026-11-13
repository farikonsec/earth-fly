# Autonomous UK ground traffic · 0.27

## Playing

Traffic starts automatically below 10 km altitude in the UK coverage area. The population follows the aircraft: up to 720 road vehicles spawn within 3 km and 32 rail consists within 6 km. Old distant vehicles retire as new mapped areas stream in. Dense city coverage can reach the cap; rural areas may have fewer. Pausing freezes traffic. Simulation time acceleration also advances traffic, with bounded integration.

Road models: hatchback, saloon, estate, SUV, taxi, van, double-decker bus, articulated lorry. Rail: five-car passenger trains, six-car freight, six-car Tube, four-car Overground-style commuter trains, two-section light rail. Procedural models share instanced geometry, with individual paint, windows, wheels, headlights and brake lights.

Radar → Contacts → Road vehicles / Trains & Underground lists speed and movement state. Select a surface contact to target it using the existing weapon controls. Guns use swept oriented boxes to hit small vehicles; missile direct hits and 35 m gameplay blasts destroy nearby vehicles. A destroyed carriage disables its whole consist. Wrecks stop, darken, smoke, block following traffic and retire after 100 simulation seconds. Civilian traffic carries no score. Underground vehicles are terrain-occluded and not direct radar weapon targets, but nearby blasts can reach shallow tunnels. The cutaway button reveals trains and tunnel lines through terrain.

## Movement

The directed graph uses real mapped road and track polylines. One-way roads, left-side lane offsets, bridge/tunnel layers and separate road/rail connectivity are retained. Bridge portals connect only at aligned endpoints, avoiding false junctions at overpasses. Deterministic seeded choices select successive road branches; rail routing favours through tracks. Vehicle profiles supply acceleration, braking, size and desired speed. An intelligent-driver following model, junction reservations, synthetic alternating traffic signals and lane-gap checks govern stopping and motorway overtaking. Station arrivals brake and dwell for 20–35 seconds. Buses have synthetic 12-second stops approximately every 110 seconds.

Coordinates use the game's rotating spherical Earth; render and weapon targets use the same transformed positions. Existing modelled bridges supply deck heights. Terrain corrections seat vehicles on the displayed mesh.

## Sources and refresh

- © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
- OpenMapTiles transportation and POI schema: https://openmaptiles.org/schema/
- OpenFreeMap vector tiles: https://openfreemap.org/
- Powered by TfL Open Data: https://tfl.gov.uk/info-for/open-data-users
- TfL API line and station identities: https://api.tfl.gov.uk/

The bundled central-London network contains 16 zoom-14 transportation/railway-POI tiles, retrieved 12 November 2026. Elsewhere the existing world-detail tile stream supplies the graph. TfL's 19 line records supply station locations and names, including the six named Overground lines. These are not live vehicle positions, and station-to-station straight lines are not used as track geometry. Run `bun run traffic:refresh` to rebuild the bundled snapshots. Refresh requires network access.

## Limits

This is a bounded local traffic simulation, not every vehicle in Britain running continuously. Mapped coverage streams with the aircraft and needs network access outside the bundled London area. Graph junctions and available station positions inherit vector-tile simplification. Traffic signals, speeds, bus stops, train routing and schedules are synthetic; it does not reproduce complete official TfL service patterns or real-time traffic. Generic bridges without an existing 3D bridge model use terrain height; tunnels use approximate depths. Cars have visual lane shifts but no full road-vehicle rigid-body collision solver. Busy single-track/dead-end sections can queue. No pedestrians, interiors, modelled tunnel walls, live timetables or full nationwide offscreen persistence are included.

## Validation

Twelve dedicated tests cover one-way/grade-separated routing, left-hand placement, acceleration, following behind wrecks, deterministic pause/replay, motorway overtaking, station arrival/departure, London population, oriented hitboxes, terrain-clipped gunfire, blast damage, portal continuation, signal conflicts and missile interception of a moving train. Browser checks covered London, the M25, Manchester and Edinburgh, surface consists, Underground cutaway, gun destruction and moving-train missile destruction. A ten-minute simulation remained bounded with both moving and queued traffic.
