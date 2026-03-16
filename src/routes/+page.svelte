<script lang="ts">
  import Card from "$lib/components/ui/card/card.svelte";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import LightSwitch from "$lib/components/ui/light-switch/light-switch.svelte";

  import maplibregl from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";

  import LanguageToggle from "$lib/LanguageToggle.svelte";
  import { ModeWatcher, mode } from "mode-watcher";

  let mapContainer: HTMLDivElement | undefined = $state();
  let map: maplibregl.Map | undefined;
  let markers: maplibregl.Marker[] = [];
  let schoolLabelMarker: maplibregl.Marker | undefined;

  // import {
  //   loadObservations,
  //   loadSchoolData,
  //   type Observation,
  // } from "$lib/data/loadObservations";

  import {
    loadData,
    type Respondent,
    type RespondentLanguage,
    type Locatie,
  } from "$lib/data/loadRespondents";
  import Button from "$lib/components/ui/button/button.svelte";

  type Stadsdeel = {
    id: number;
    naam: string;
    centroid: [number, number];
  };

  let locale = $state("nl");

  let stadsdelen: Stadsdeel[] = $state([]);
  let locaties: Locatie[] = $state([]);
  let respondents = $state<Respondent[]>([]);

  let languageFilters = $state({
    homeLanguage: false,
    proficient: false,
  });

  let hoveredStadsdeelId = $state<number | null>(null);
  let selectedStadsdeelId = $state<number | null>(null);

  let hoveredLocatieId = $state<number | null>(null);
  let selectedLocatieId = $state<number | null>(null);

  let showLocaties = $state(true);
  let showLabels = $state(true);

  let showStadsdelen = $state(true);
  let showScholen = $state(true);
  let showBibliotheken = $state(true);

  let locationMarkers = $state<maplibregl.Marker[]>([]);
  let stadsdeelMarkers = $state<maplibregl.Marker[]>([]);

  function clearMarkers() {
    locationMarkers.forEach((m) => m.remove());
    locationMarkers = [];
  }

  function addLabelMarkers(geojson: GeoJSON.FeatureCollection) {
    stadsdeelMarkers.forEach((m) => m.remove());
    stadsdeelMarkers = [];
    geojson.features.forEach((feature) => {
      const name = feature.properties?.Stadsdeel;
      const centroid = feature.properties?.Centroid;
      if (!name || !centroid) return;

      let [lng, lat] = centroid as [number, number];

      const el = document.createElement("div");
      el.className = "stadsdeel-label";
      el.textContent = name;

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map!);
      stadsdeelMarkers.push(marker);
    });
  }

  function addLocationMarkers() {
    locationMarkers.forEach((m) => m.remove());
    locationMarkers = [];

    locaties.forEach((l) => {
      const el = document.createElement("div");
      el.className = "school-label-permanent";
      el.textContent = l.naam;

      if (l.coordinaten.some((coord) => isNaN(coord))) {
        console.warn(`Ongeldige coördinaten voor ${l.naam}:`, l.coordinaten);
        return;
      }
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([l.coordinaten[1], l.coordinaten[0]])
        .addTo(map!);

      el.style.display = showLabels && showLocaties ? "block" : "none";
      locationMarkers.push(marker);
    });
  }

  $effect(() => {
    console.log(showScholen);
    map?.setLayoutProperty(
      "locatie-circles",
      "visibility",
      showScholen ? "visible" : "none",
    );
  });

  $effect(() => {
    console.log(showStadsdelen);
    map?.setLayoutProperty(
      "stadsdelen-fill",
      "visibility",
      showStadsdelen ? "visible" : "none",
    );
    map?.setLayoutProperty(
      "stadsdelen-outline",
      "visibility",
      showStadsdelen ? "visible" : "none",
    );
  });

  $effect(() => {
    const selectedStadsdeel = stadsdelen.find(
      (s) => s.id === selectedStadsdeelId,
    );

    locationMarkers.forEach((marker, index) => {
      const l = locaties[index];
      const el = marker.getElement();

      if (selectedLocatieId !== null) {
        el.style.display = l.id === selectedLocatieId ? "block" : "none";
      } else if (selectedStadsdeelId !== null) {
        el.style.display =
          l.stadsdeel === selectedStadsdeel?.naam ? "block" : "none";
      } else {
        el.style.display = "none";
      }
    });
  });

  function showSchoolLabel(name: string, lngLat: maplibregl.LngLat) {
    hideSchoolLabel();
    const el = document.createElement("div");
    el.className = "school-label";
    el.textContent = name;
    schoolLabelMarker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat(lngLat)
      .addTo(map!);
  }

  function hideSchoolLabel() {
    schoolLabelMarker?.remove();
    schoolLabelMarker = undefined;
  }

  function getBoundingBox(feature: any): [[number, number], [number, number]] {
    const coords = feature.geometry.coordinates.flat(2);
    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;

    for (let i = 0; i < coords.length; i += 2) {
      const lng = coords[i];
      const lat = coords[i + 1];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return [
      [minLng, minLat],
      [maxLng, maxLat],
    ];
  }

  function updateHighlightSource() {
    const src = map?.getSource("stadsdelen-highlight") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;

    const activeId = selectedStadsdeelId ?? hoveredStadsdeelId;

    if (activeId === undefined) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const feature = cachedGeojson?.features.find((f) => f.id === activeId);
    if (!feature) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    src.setData({
      type: "FeatureCollection",
      features: [
        {
          ...feature,
          properties: {
            ...feature.properties,
            _selected: selectedStadsdeelId === activeId,
          },
        },
      ],
    });
  }

  let cachedGeojson: GeoJSON.FeatureCollection | undefined;

  $effect(() => {
    if (selectedStadsdeelId && map && cachedGeojson) {
      const feature = cachedGeojson.features.find(
        (f) => f.id === selectedStadsdeelId,
      );
      if (!feature) return;
      const bbox = Array.isArray(feature.geometry.coordinates[0])
        ? getBoundingBox(feature)
        : null;

      if (bbox) {
        map.fitBounds(bbox, { padding: 50, duration: 500 });
      }
    }
  });

  let isInitializing = false;

  const lightStyle =
    "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
  const darkStyle =
    "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

  $effect(() => {
    const isDark = mode.current === "dark";
    if (!map) return;

    map.setStyle(isDark ? darkStyle : lightStyle);
  });

  $effect(() => {
    if (!mapContainer) return;

    map = new maplibregl.Map({
      container: mapContainer,
      style: mode.current === "dark" ? darkStyle : lightStyle,
      center: [4.9041, 52.3676],
      zoom: 11,
    });

    async function setupMapLayers() {
      if (!map || isInitializing || map.getSource("stadsdelen")) return;
      isInitializing = true;

      try {
        const data = await loadData();
        respondents = data.respondents;
        locaties = data.locations;
        const locations = data.locations;

        const res = await fetch("./stadsdelen.json");
        const geojson: GeoJSON.FeatureCollection = await res.json();
        cachedGeojson = geojson;

        stadsdelen = geojson.features.map((f) => ({
          id: f.id as number,
          naam: f.properties?.Stadsdeel,
          centroid: f.properties?.Centroid as [number, number],
        }));

        const locatiesGeojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: locations.map((l) => ({
            type: "Feature",
            id: l.id,
            properties: {
              id: l.id,
              naam: l.naam,
              type: l.type,
              buurt: l.stadsdeel,
            },
            geometry: {
              type: "Point",
              coordinates: [l.coordinaten[1], l.coordinaten[0]],
            },
          })),
        };

        map!.addSource("stadsdelen", { type: "geojson", data: geojson });
        map!.addSource("stadsdelen-highlight", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map!.addSource("locaties", {
          type: "geojson",
          data: locatiesGeojson,
          promoteId: "id",
        });

        map!.addLayer({
          id: "stadsdelen-fill",
          type: "fill",
          source: "stadsdelen",
          paint: { "fill-color": "#00aa00", "fill-opacity": 0.1 },
        });

        map!.addLayer({
          id: "stadsdelen-outline",
          type: "line",
          source: "stadsdelen",
          paint: { "line-color": "#00aa00", "line-width": 1.5 },
        });

        map!.addLayer({
          id: "stadsdelen-highlight-fill",
          type: "fill",
          source: "stadsdelen-highlight",
          paint: {
            "fill-color": [
              "case",
              ["boolean", ["get", "_selected"], false],
              "#005500",
              "#00aa00",
            ],
            "fill-opacity": [
              "case",
              ["boolean", ["get", "_selected"], false],
              0.3,
              0.2,
            ],
          },
        });

        map!.addLayer({
          id: "stadsdelen-highlight-outline",
          type: "line",
          source: "stadsdelen-highlight",
          paint: {
            "line-color": "#007700",
            "line-width": [
              "case",
              ["boolean", ["get", "_selected"], false],
              3,
              2.5,
            ],
          },
        });

        map.addLayer({
          id: "locatie-circles",
          type: "circle",
          source: "locaties",
          paint: {
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "hovered"], false],
              8,
              5,
            ],
            "circle-color": [
              "match",
              ["get", "type"],
              "school",
              "#ff4444",
              "bibliotheek",
              "#4444ff",
              "cultureel",
              "#ff9900",
              "#ffffff",
            ],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffffbb",
            "circle-opacity": [
              "case",
              ["boolean", ["feature-state", "hovered"], false],
              1,
              0.85,
            ],
          },
        });

        map!.addLayer(
          {
            id: "extra-dimmer",
            type: "background",
            paint: {
              "background-color":
                mode.current === "dark" ? "#000000" : "#ffffff",
              "background-opacity": 0.5,
            },
          },
          "stadsdelen-fill",
        );

        addLabelMarkers(geojson);
        addLocationMarkers();
      } finally {
        isInitializing = false;
      }
    }

    map.on("styledata", () => {
      setupMapLayers();
    });

    let lastHoveredLocatieId: number | null = null;

    map!.on("mousemove", "locatie-circles", (e) => {
      if (!e.features?.length) return;

      const f = e.features[0];
      const id = f.id;

      if (typeof id !== "number") return;

      if (lastHoveredLocatieId !== null && lastHoveredLocatieId !== id) {
        map!.setFeatureState(
          { source: "locaties", id: lastHoveredLocatieId },
          { hovered: false },
        );
        hideSchoolLabel();
      }

      hoveredLocatieId = id;
      lastHoveredLocatieId = id;

      map!.setFeatureState({ source: "locaties", id }, { hovered: true });

      showSchoolLabel(f.properties!.naam, e.lngLat);
    });

    map!.on("mouseleave", "locatie-circles", () => {
      map!.getCanvas().style.cursor = "";

      if (hoveredLocatieId !== null) {
        map!.setFeatureState(
          { source: "locaties", id: hoveredLocatieId },
          { hovered: false },
        );
      }

      hoveredLocatieId = null;
      hideSchoolLabel();
    });

    map!.on("mousemove", "stadsdelen-fill", (e) => {
      if (hoveredLocatieId !== null) return;

      if (!e.features?.length) return;
      const id = e.features[0].id;

      hoveredStadsdeelId = id as number;
      updateHighlightSource();
    });

    map!.on("mouseleave", "stadsdelen-fill", () => {
      hoveredStadsdeelId = null;
      updateHighlightSource();
      map!.getCanvas().style.cursor = "";
    });

    map!.on("click", (e) => {
      const locaties = map!.queryRenderedFeatures(e.point, {
        layers: ["locatie-circles"],
      });

      if (locaties.length > 0) {
        const feature = locaties[0];
        const id = feature.properties?.id ?? feature.id;

        if (id !== undefined && id !== null) {
          selectedLocatieId = Number(id);
          selectedStadsdeelId = null;
          updateHighlightSource();
          return;
        }
      }

      const stadsdelen = map!.queryRenderedFeatures(e.point, {
        layers: ["stadsdelen-fill"],
      });

      if (stadsdelen.length > 0) {
        const id = stadsdelen[0].id;
        if (id !== undefined) {
          selectedStadsdeelId = id as number;
          selectedLocatieId = null;
          updateHighlightSource();
          return;
        }
      }

      selectedLocatieId = null;
      selectedStadsdeelId = null;
      updateHighlightSource();
    });

    return () => {
      clearMarkers();
      hideSchoolLabel();
      map?.remove();
    };
  });

  let showLangStatistics = $state(true);
</script>

<ModeWatcher />

<header
  class="flex items-center justify-between px-6 pt-6 pb-8 border-b border-gray-300 dark:border-gray-700 overflow-visible"
>
  <h1
    class="relative inline-block text-xl font-bold bg-purple-600/25 rounded-md px-4 py-2 drop-shadow-lg
  after:content-[''] after:absolute after:bottom-[-20px] after:left-6 after:w-0 after:h-0
  after:border-l-[20px] after:border-l-transparent
  after:border-t-[20px] after:border-t-purple-600/25
  after:border-r-[4px] after:border-r-transparent"
  >
    {locale === "nl" ? "Talenkaart Amsterdam" : "Language Map Amsterdam"}
  </h1>

  <div class="flex items-center gap-2">
    <LanguageToggle
      onclick={() => (locale = locale === "nl" ? "en" : "nl")}
      {locale}
    />
    <LightSwitch />
  </div>
</header>

<div class="max-w-[1200px] mx-auto">
  <Card class="m-8 p-0 relative">
    <div bind:this={mapContainer} class="w-full h-[600px] rounded-lg" />
    <div
      class="absolute bottom-4 left-4 bg-white dark:bg-gray-800 p-2 rounded-lg shadow-md"
    >
      <ul class="text-[13px] font-[600] text-gray-700 dark:text-gray-300">
        <li class="p-0.5">
          <Checkbox bind:checked={showStadsdelen} class="inline mr-2"
          ></Checkbox>
          <span style:color="#44ff44">--</span>
          {locale === "nl" ? `Stadsdelen` : `Districts`}
        </li>
        <li class="p-0.5">
          <Checkbox bind:checked={showScholen} class="inline mr-2"></Checkbox>
          <span style:color="#ff4444">●</span>
          {locale === "nl" ? `Scholen` : `Schools`}
        </li>
        <li class="p-0.5">
          <Checkbox bind:checked={showBibliotheken} class="inline mr-2"
          ></Checkbox>
          <span style:color="#4444ff">●</span>
          {locale === "nl" ? `Bibliotheken` : `Libraries`}
        </li>
      </ul>
    </div>
  </Card>

  {#if respondents}
    {@const selectedStadsdeel = stadsdelen.find(
      (s) => s.id == selectedStadsdeelId,
    )}
    {@const selectedLocatie = locaties.find((l) => l.id == selectedLocatieId)}

    {@const res = respondents.filter((r) => {
      if (selectedLocatie) return r.locationName == selectedLocatie.naam;
      if (selectedStadsdeel) return r.stadsdeel == selectedStadsdeel.naam;
      return true;
    })}

    {@const langs = res
      .flatMap((r) => r.languages)
      .reduce(
        (acc, { code, nameNL, nameEN }) => {
          acc[code] = { nameNL, nameEN };
          return acc;
        },
        {} as Record<string, { nameNL: string; nameEN: string }>,
      )}

    {@const occurrences = res
      .flatMap((r) => r.languages)
      .reduce(
        (acc, l) => {
          if (!acc[l.code])
            acc[l.code] = { total: 0, homeLanguage: 0, proficient: 0 };
          acc[l.code].total += 1;
          if (l.homeLanguage) acc[l.code].homeLanguage += 1;
          if (l.proficient) acc[l.code].proficient += 1;
          return acc;
        },
        {} as Record<
          string,
          { total: number; homeLanguage: number; proficient: number }
        >,
      )}

    {@const cooccurrences = res.reduce(
      (acc, respondent) => {
        const codes = respondent.languages
          .filter(
            (l) =>
              (!languageFilters.homeLanguage || l.homeLanguage) &&
              (!languageFilters.proficient || l.proficient),
          )
          .map((l) => l.code);

        codes.forEach((codeA) => {
          if (!acc[codeA]) acc[codeA] = {};
          codes.forEach((codeB) => {
            if (codeA !== codeB) {
              acc[codeA][codeB] = (acc[codeA][codeB] || 0) + 1;
            }
          });
        });
        return acc;
      },
      {} as Record<string, Record<string, number>>,
    )}

    {@const checkedLangs = Array(occurrences.length).fill(false)}
    <Card class="m-8 p-10">
      <h2 class="text-xl font-semibold">
        <span
          class="rounded-l cursor-pointer"
          onclick={() => {
            selectedLocatieId = null;
            selectedStadsdeelId = null;
          }}>Amsterdam</span
        >
        {#if !selectedStadsdeelId && !selectedLocatieId}
          <span class="opacity-50 text-lg"
            >&rarr; {locale === "nl"
              ? `Selecteer een stadsdeel of locatie op de kaart...`
              : `Select a district or location on the map...`}</span
          >
        {/if}
        {#if selectedStadsdeelId}
          &rarr; {selectedStadsdeel.naam}
        {/if}
        {#if selectedLocatieId}
          &rarr; {selectedLocatie?.stadsdeel}
          &rarr; {selectedLocatie.naam}
          (<i>{selectedLocatie?.type}</i>)
        {/if}
      </h2>

      {#if res.length == 0}
        <p class="opacity-50">Geen data over dit gebied...</p>
      {:else}
        <div>
          {@html locale === "nl"
            ? `Onder de <span class='underline'>${res.length}</span> ondervraagden
          worden de volgende talen`
            : `Among the <span class='underline'>${res.length}</span> respondents,
          the following languages are spoken`}
          <ul>
            <li class="p-1">
              <Checkbox
                bind:checked={languageFilters.proficient}
                class="inline relative top-[1px]"
              />
              <span style:opacity={languageFilters.proficient ? 1 : 0.5}
                >{locale === "nl" ? `vloeiend 💯` : `fluent 💯`}</span
              >
              <span
                style:opacity={languageFilters.homeLanguage &&
                languageFilters.proficient
                  ? 1
                  : 0.5}>en/of</span
              >
            </li>
            <li class="p-1">
              <Checkbox
                bind:checked={languageFilters.homeLanguage}
                class="inline relative top-[1px]"
              />
              <span style:opacity={languageFilters.homeLanguage ? 1 : 0.5}
                >{locale === "nl" ? `thuis 🏠` : `at home 🏠`}</span
              >
            </li>
          </ul>
          {#if locale == "nl"}
            gesproken:
          {/if}
        </div>
        <ul>
          {#each Object.entries(occurrences)
            .filter(([, o]) => (!languageFilters.homeLanguage || o.homeLanguage > 0) && (!languageFilters.proficient || o.proficient > 0))
            .sort((a, b) => b[1].total - a[1].total) as [code, o]}
            {@const count = languageFilters.homeLanguage
              ? o.homeLanguage
              : languageFilters.proficient
                ? o.proficient
                : o.total}

            {@const topCooc = Object.entries(cooccurrences[code] ?? {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)}

            <li class="p-2 odd:bg-gray-500/10 rounded-lg">
              <Checkbox class="inline mr-1" />
              <span
                class="underline cursor-pointer"
                onclick={() => (showLangStatistics = !showLangStatistics)}
                >{locale === "nl"
                  ? langs[code].nameNL
                  : langs[code].nameEN},</span
              >
              <span class="text-sm">
                {count}
                {locale === "nl"
                  ? count > 1
                    ? "sprekers"
                    : "spreker"
                  : count > 1
                    ? "speakers"
                    : "speaker"}
                <b>({((count / res.length) * 100).toFixed(1)}%)</b>
              </span>

              {#if showLangStatistics}
                <ul class="text-xs text-gray-500 mt-1 ml-4">
                  {#if !languageFilters.homeLanguage && !languageFilters.proficient}
                    <li>
                      {locale === "nl" ? `Vloeiend` : `Fluent`}
                      ({o.proficient}x) ({(
                        (o.proficient / o.total) *
                        100
                      ).toFixed(1)}%)
                    </li>
                    <li>
                      {locale === "nl" ? `Thuistaal` : `Home language`}
                      ({o.homeLanguage}x) ({(
                        (o.homeLanguage / o.total) *
                        100
                      ).toFixed(1)}%)
                    </li>
                  {/if}
                  {#if topCooc.length > 0}
                    {#each topCooc as [coocCode, coocCount]}
                      <li>
                        + {locale === "nl"
                          ? langs[coocCode]?.nameNL
                          : langs[coocCode]?.nameEN}
                        ({coocCount}x) ({(
                          (coocCount / res.length) *
                          100
                        ).toFixed(1)}%)
                      </li>
                    {/each}
                  {/if}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  {/if}
</div>

<style>
  @import url("https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Teko:wght@300..700&display=swap");

  :global(.stadsdeel-label) {
    font-family: "Open Sans", serif;
    font-size: 14px;
    font-weight: 600;
    color: #eeffee;
    text-shadow: 1px 2px 0px #000;
    pointer-events: none;
    white-space: nowrap;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  :global(.school-label) {
    font-family: "Bebas Neue", serif;
    font-size: 16px;
    color: #331100;
    background: rgba(255, 255, 255, 0.92);
    padding: 2px 4px;
    border-radius: 4px;
    white-space: nowrap;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    pointer-events: none;
    margin-bottom: -100px;
  }

  :global(.school-label-permanent) {
    font-family: "Bebas Neue", serif;
    font-size: 12px;
    color: #331100;
    background: rgba(255, 255, 255, 0.85);
    padding: 0px 3px;
    border-radius: 4px;
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);

    pointer-events: none;
    margin-top: -10px;
  }
</style>
