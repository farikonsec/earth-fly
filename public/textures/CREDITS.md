# Asset credits

## Summit imagery (Flight Lab 0.10)

Summit regions include NASA GIBS Blue Marble regional imagery plus 63 finer NASA GIBS **Landsat WELD True Color Global Annual v3.1** tiles for the seven non-Antarctic destinations. The selected service epoch is **2000-12-01**, an historic annual composite, not current glacier/snow/weather imagery. Nominal Landsat source sampling is 30 m; displayed tile sampling varies with latitude and does not create finer source detail. Vinson retains coarse Blue Marble imagery because this WELD product excludes Antarctica.

Sources: [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/), [NASA GWELD catalog](https://data.nasa.gov/dataset/nasa-global-web-enabled-landsat-data-annual-global-30-m-v031-37b9c), [NASA/USGS GWELD guide](https://lpdaac.usgs.gov/documents/2086/GWELD_User_Guide_V32.pdf). NASA/USGS Landsat science teams and NASA MEaSUREs WELD project. Tile URLs and SHA-256 hashes are in `../imagery/summits-manifest.json`; regional Blue Marble assets are in `../terrain/summits-manifest.json`. Texture-edge feathering and near-black no-data fallback are rendering modifications. No generated mountain photographs are substituted for geographic data.

- `earth.jpg`: NASA Blue Marble Next Generation, July 2004, 5400 × 2700. NASA Earth Observatory, Reto Stöckli and Robert Simmon / NASA Goddard Space Flight Center and the MODIS science teams. Downloaded from https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74092/world.200407.3x5400x2700.jpg . NASA imagery information: https://visibleearth.nasa.gov/collection/1484/blue-marble . Used as a global colour texture; not an elevation dataset.
- `clouds.webp`: the alpha channel of `fair_clouds_4k.png`, distributed with Bjørn Sandvik's WebGL Earth example: https://github.com/turban/webgl-earth/tree/master/images , stored as greyscale cloud cover (WebP quality 90). This is static imagery, not current cloud cover.
- `water.webp`: `water_4k.png`, from the same WebGL Earth example (lossless WebP). Used to classify water contact and derive a surface roughness map.
- Spacecraft and RAHIMLI STENCIL typeface: adapted from the user's Pathfinder Mars game, https://github.com/farikonsec/pathfinder-mars . Vehicle lettering updated to ESV-01 / EARTH.
- Three.js: https://github.com/mrdoob/three.js , MIT license. Its full license is included in the installed dependency.
- Atmosphere, star field and UI are generated in code. No AI-generated assets or Scenario services were used.

The cloud and water assets retain their upstream provenance. Review upstream image terms before any public or commercial release.

## Flight Lab 0.2 additions

- Global relief and local Alpine terrain: Mapzen Terrain Tiles, accessed 2026-10-18 from https://registry.opendata.aws/terrain-tiles/ . Source attribution is retained in `../terrain/ATTRIBUTION.md`. Terrarium decoding follows https://github.com/tilezen/joerd/blob/master/docs/formats.md . The coarse global grid is resampled from zoom 2; local/streamed detail uses zoom 9. Negative elevations are clamped to sea level for this game.
- Regional imagery: NASA GIBS `BlueMarble_NextGeneration` / `GoogleMapsCompatible_Level8`. API: https://nasa-gibs.github.io/gibs-api-docs/ . The Alpine reference tiles are bundled locally; other regions stream on demand.
- Solar coordinates: approximate equatorial algorithm consistent with https://aa.usno.navy.mil/faq/sun_approx . Lunar visual uses a mean orbit and is not a precise ephemeris.
- Atmosphere: standard layer equations with an exponential extension above 86 km. Air-property background: https://www.grc.nasa.gov/WWW/K-12/BGP/sound.html . Aerodynamic coefficients and propulsion remain game-tuned.

## Flight Lab 0.3 additions

Mapped Alpine water areas, river centre lines and forest boundaries: © OpenStreetMap contributors, ODbL 1.0. Derived database: `/scenery/alps.json`. Source query, derivation and license information are in `../scenery/README.md`. Procedural conifer placement and water/ground shaders are authored in code; individual trees are not surveyed objects.

## Dombay and Caspian extension

The milestone 0.11 regional bundle extends existing NASA Blue Marble and Landsat WELD true-color imagery to Dombay-Ulgen and the Absheron/Caspian coast. WELD remains the historic 2000 annual composite, not current conditions. Source URLs and SHA-256 hashes are recorded in ../terrain/regions-manifest.json; the existing NASA imagery credits apply.

## Flight Lab 0.17 additions

Night-side city lights: NASA GIBS `VIIRS_CityLights_2012` (Earth at Night 2012, NASA Earth Observatory / NOAA NGDC, Suomi NPP VIIRS), streamed at runtime at zoom 4 and not bundled. API: https://nasa-gibs.github.io/gibs-api-docs/ . Static 2012 composite. Volumetric clouds, stars and the Milky Way band are generated in code; cloud coverage reuses `clouds.png`.
