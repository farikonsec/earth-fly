# Living skies — 0.25

This update adds three independently simulated populations and the player's radar. It builds on 0.24's terrain, London scenery, aircraft and flight systems.

## Play

Open http://127.0.0.1:5178/. Radar is visible on the right. Red diamonds are hostile aircraft; mint triangles are civilian airliners; blue squares are spacecraft. Click a return to track it. Choose a range from 5 to 50,000 km. The sensor is heading-up, uses slant distance, and rejects contacts behind the spherical Earth. Contacts opens a searchable browser with position, altitude, route/phase, orbital speed and element epoch. A catalog track below the horizon is explicitly distinguished from a radar return.

Enemy patrols start automatically: 24 aircraft, compared with the former maximum of eight. They fly moving patrol stations without player input and engage nearby airborne players. They evade locks, obey terrain lookahead, and replenish losses after a delay. Aircraft use different fictional cannon, rocket and seeker loadouts, with differing cadence, damage, speed and turn limits. Jets do not inherit the player's supercruise speed. Dogfight still starts the optional timed scoring challenge, now with 11–16 opponents. Close the challenge to resume persistent patrols. F fires the gun, T cycles lock candidates, Enter launches a missile after lock dwell. Civil traffic is not part of the target pool.

For a spacecraft, search its name or NORAD number. Select it, then use **Rendezvous · match orbit** to place the player 1 km behind it with matched velocity at current UTC. Nearby spacecraft can be locked and destroyed with the existing weapons. Destruction affects only the current game session; it does not alter the catalog. Docked entries sharing exactly the station's orbital elements remain searchable but are represented by one physical assembly.

## Civil traffic

18 airliners cover six silhouettes: Airbus A320, A321, A330, A350, Boeing 777 and 747. Flights connect Heathrow and Gatwick with Birmingham, Manchester, Edinburgh, Glasgow and Paris CDG. Each has a callsign, outbound and return leg, taxi, takeoff, climb, cruise, descent, approach, landing and turnaround. A deterministic four-hour repeating timetable reserves runway movement events at least 150 seconds apart. Routes advance on simulation UTC, including time acceleration, and freeze when the simulation is paused.

This is synthetic game traffic. Aircraft types are representative silhouettes, not licensed liveries. Routes and taxi paths are simplified, not actual airline schedules, SIDs/STARs, clearance procedures or an ATC simulation. There is no traffic-to-traffic collision or live ADS-B feed. Real runway endpoints come from [OurAirports' public-domain data](https://github.com/davidmegginson/ourairports-data), retrieved November 11, 2026. Terrain seating uses the current surface near the player, and published field elevations elsewhere.

## Orbit data and accuracy

The bundled snapshot has **16,903 entries**, retrieved **2026-11-11 12:31 UTC**, from [CelesTrak's active GP group](https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json). See `public/orbits/source.json` and the complete `public/orbits/active.json` list. The public active grouping is not a verified list of every functioning spacecraft: it includes separately cataloged station components and does not guarantee operational status or completeness. Some objects are not publicly tracked.

[Satellite.js 7.1.0](https://github.com/shashwatak/satellite-js), MIT licensed, propagates OMM mean elements using SGP4/SDP4. JSON supports six-digit NORAD IDs, unlike legacy TLE identifiers. Propagation uses the same UTC as the Sun and Moon. The default flight starts at current UTC; daylight presets and saved flights can use another date. **Use current UTC** resynchronizes the scene clock. Each object's element epoch is shown; elements more than seven days from scene time are labeled old.

SGP4 outputs are estimates, not live measured coordinates. Maneuvers, stale elements and model error reduce accuracy. WGS84 geographic latitude, longitude and altitude are mapped onto the game's mean-radius sphere; displayed orbital speed remains the physical TEME speed. A central-difference Jacobian maps velocity into the game's coordinate frame for rendezvous and relative projectile collision. This spherical rendering is not precision navigation.

The full catalog propagates in a worker, roughly once a second of wall time. Near and selected objects receive exact per-frame propagation; distant contacts interpolate for at most two simulated seconds, then propagate from their own elements. Radar/rendering consider the nearest 511 catalog candidates plus the selected object, while name/ID search covers the entire catalog. Only nearby objects get detailed generic models (ISS has its own truss/panels silhouette); spacecraft meshes are not individual engineering reconstructions. Physical models, particles, projectile counts and caches are bounded.

Refresh deliberately, with one provider request:

```sh
cd earth-fly
bun run orbits:refresh
```

This validates the response before replacing the snapshot. It is not a background polling service. Respect [CelesTrak's usage policy](https://celestrak.org/NORAD/elements/).

## Verification

`bun run check` runs the existing flight/terrain suites plus `tests/traffic.test.ts`: catalog integrity, ISS height/speed/frame conversion, full-catalog finite propagation, deterministic complete routes, runway reservation spacing, continuous gate transitions, pause behavior, autonomous patrol flight beyond 90 seconds, distinct ordnance release, orbital target destruction, and Earth occlusion.

Browser evidence and QA scripts are in `work/milestone-25/`. Visual checks include Heathrow takeoff, climb over Hounslow, the radar/catalog, and an ISS rendezvous. A real F-key gun run destroyed the simulated ISS assembly with eight hits, removed its 11 co-located catalog components and awarded one kill. The actual catalog remains unchanged.
