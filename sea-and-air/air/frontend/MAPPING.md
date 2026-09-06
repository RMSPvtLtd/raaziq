# Geographic data

Maps use MapLibre GL JS and OpenFreeMap styles. Override `VITE_MAP_STYLE_URL` and
`VITE_MAP_DARK_STYLE_URL` with approved MapLibre-compatible styles.

The small offline gazetteer resolves the existing example lanes at city precision.
Coordinates are GeoNames city centroids, verified 5 September 2026:

- [Lahore](https://www.geonames.org/advanced-search.html?q=Lahore): 31.557996, 74.350713
- [Dubai](https://www.geonames.org/advanced-search.html?q=Dubai): 25.07725, 55.309275
- [Karachi](https://www.geonames.org/search.html?country=PK): 24.8608, 67.0104
- [London](https://www.geonames.org/2643743/london.html): 51.50853, -0.12574

GeoNames data is attributed under CC BY. These points must not be presented as
airport, terminal, or vehicle locations.

Additional places use `VITE_GEOCODER_URL`, an approved endpoint accepting `name`
and `count`, returning `{ results: [{ longitude, latitude }] }`. Optional
`VITE_GEOCODER_API_KEY` must be a public browser credential, never a secret.
Successful lookups are cached locally. Configure a commercially licensed service
or an internal proxy before production use; no public free geocoder is enabled
automatically. Unresolved names retain the full route text.

Air routes never infer aircraft position from stage. Sea reported positions must
be explicitly supplied and geographically resolvable; terminal codes are not
treated as coordinates. All maps retain an accessible text alternative.
