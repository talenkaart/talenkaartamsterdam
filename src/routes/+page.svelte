<script lang="ts">
  import Card from "$lib/components/ui/card/card.svelte";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import LightSwitch from "$lib/components/ui/light-switch/light-switch.svelte";
  import { X } from "lucide-svelte";

  import maplibregl from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";

  import LanguageToggle from "$lib/LanguageToggle.svelte";
  import { ModeWatcher, mode } from "mode-watcher";

  let mapContainer: HTMLDivElement | undefined = $state();
  let map: maplibregl.Map | undefined;
  let mapLoaded: boolean = $state(false);
  let schoolLabelMarker: maplibregl.Marker | undefined;

  import {
    loadData,
    type Respondent,
    type RespondentLanguage,
    type Locatie,
  } from "$lib/data/loadRespondents";

  type Stadsdeel = {
    id: number;
    naam: string;
    centroid: [number, number];
  };

  let locale = $state("nl");

  let stadsdelen: Stadsdeel[] = $state.raw([]);
  let locaties: Locatie[] = $state.raw([]);
  let respondents = $state.raw<Respondent[]>([]);

  let hoveredStadsdeelId = $state<number | null>(null);
  let selectedStadsdeelId = $state<number | null>(null);

  let hoveredLocatieId = $state<number | null>(null);
  let selectedLocatieId = $state<number | null>(null);

  let filteredRes = $derived.by(() => {
    const stadsdeel = stadsdelen.find((s) => s.id === selectedStadsdeelId);
    const locatie = locaties.find((l) => l.id === selectedLocatieId);

    const f = respondents.filter((r) => {
      if (locatie) return r.locationName === locatie.naam;
      if (stadsdeel) return r.stadsdeel === stadsdeel.naam;
      return true;
    });
    return f;
  });

  let [languageOccurences, languageNames, languageSelected] = $derived.by(
    () => {
      const occ = {};
      const names = {};
      const selected = $state({});

      for (const r of filteredRes) {
        for (const l of r.languages) {
          if (!occ[l.code]) {
            occ[l.code] = { total: 0, homeLanguage: 0, proficient: 0 };
            names[l.code] = { nameNL: l.nameNL, nameEN: l.nameEN };
            selected[l.code] = false;
          }
          occ[l.code].total++;
          if (l.homeLanguage) occ[l.code].homeLanguage++;
          if (l.proficient) occ[l.code].proficient++;
        }
      }
      return [occ, names, selected];
    },
  );

  let cooccurrences = $derived.by(() => {
    const acc = {};
    for (const r of filteredRes) {
      const codes = r.languages
        .filter(
          (l) =>
            (!languageFilters.homeLanguage || l.homeLanguage) &&
            (!languageFilters.proficient || l.proficient),
        )
        .map((l) => l.code);

      for (let i = 0; i < codes.length; i++) {
        const a = codes[i];
        if (!acc[a]) acc[a] = {};
        for (let j = 0; j < codes.length; j++) {
          if (i !== j) {
            const b = codes[j];
            acc[a][b] = (acc[a][b] || 0) + 1;
          }
        }
      }
    }
    return acc;
  });

  let sortedLangs = $derived.by(() => {
    const { occ } = languageOccurences;
    return Object.entries(occ)
      .filter(
        ([, o]) =>
          (!languageFilters.homeLanguage || o.homeLanguage > 0) &&
          (!languageFilters.proficient || o.proficient > 0),
      )
      .sort((a, b) => b[1].total - a[1].total);
  });

  let selectedStadsdeel = $derived(
    stadsdelen.find((s) => s.id == selectedStadsdeelId),
  );
  let selectedLocatie = $derived(
    locaties.find((l) => l.id == selectedLocatieId),
  );

  let showLocaties = $state(true);
  let showLabels = $state(true);

  let showStadsdelen = $state(true);
  let showScholen = $state(true);
  let showBibliotheken = $state(true);

  let locationMarkers = $state<maplibregl.Marker[]>([]);
  let stadsdeelMarkers = $state<maplibregl.Marker[]>([]);

  let languageFilters = $state({
    homeLanguage: false,
    proficient: false,
  });

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
    if (!mapLoaded) return;

    const visibility = showStadsdelen ? "visible" : "none";

    map!.setLayoutProperty("stadsdelen-fill", "visibility", visibility);
    map!.setLayoutProperty("stadsdelen-outline", "visibility", visibility);

    stadsdeelMarkers.forEach((marker) => {
      const el = marker.getElement();
      el.style.display = showStadsdelen ? "block" : "none";
    });
  });

  $effect(() => {
    if (!mapLoaded) return;

    const typeFilter = ["any"];
    if (showScholen) typeFilter.push(["==", ["get", "type"], "school"]);
    if (showBibliotheken)
      typeFilter.push(["==", ["get", "type"], "bibliotheek"]);

    const finalFilter =
      typeFilter.length > 1 ? typeFilter : ["==", ["get", "id"], -1];
    map!.setFilter("locatie-circles", finalFilter);

    const currentStadsdeel = stadsdelen.find(
      (s) => s.id === selectedStadsdeelId,
    );

    locationMarkers.forEach((marker, index) => {
      const l = locaties[index];
      const el = marker.getElement();

      const typeIsVisible =
        (l.type === "school" && showScholen) ||
        (l.type === "bibliotheek" && showBibliotheken);

      let selectionMatch = false;
      if (selectedLocatieId !== null) {
        selectionMatch = l.id === selectedLocatieId;
      } else if (selectedStadsdeelId !== null) {
        selectionMatch = l.stadsdeel === currentStadsdeel?.naam;
      }

      if (typeIsVisible && showLabels && selectionMatch) {
        el.style.display = "block";
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

  let isInitializing = $state(false);

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
      minZoom: 9,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      }),
      "top-right",
    );

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
          paint: { "fill-color": "#008800", "fill-opacity": 0.1 },
        });

        map!.addLayer({
          id: "stadsdelen-outline",
          type: "line",
          source: "stadsdelen",
          paint: { "line-color": "#008800", "line-width": 1.5 },
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
            "circle-stroke-color": "#ddddddbb",
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
              "background-opacity": mode.current === "dark" ? 0.5 : 0.33,
            },
          },
          "stadsdelen-fill",
        );

        addLabelMarkers(geojson);
        addLocationMarkers();
      } finally {
        isInitializing = false;
        mapLoaded = true;
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
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - 5, e.point.y - 5],
        [e.point.x + 5, e.point.y + 5],
      ];

      const clickedLocaties = map!.queryRenderedFeatures(bbox, {
        layers: ["locatie-circles"],
      });

      if (clickedLocaties.length > 0) {
        const feature = clickedLocaties[0];
        const id = feature.properties?.id ?? feature.id;

        if (id !== undefined && id !== null) {
          selectedLocatieId = Number(id);
          selectedStadsdeelId = null;
          updateHighlightSource();
          return;
        }
      }

      const clickedStadsdelen = map!.queryRenderedFeatures(e.point, {
        layers: ["stadsdelen-fill"],
      });

      if (clickedStadsdelen.length > 0) {
        const newId = clickedStadsdelen[0].id as number;

        if (selectedStadsdeelId === newId) {
          selectedStadsdeelId = null;
        } else {
          selectedStadsdeelId = newId;
          selectedLocatieId = null;
        }

        updateHighlightSource();
        return;
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
  class="flex items-center justify-between h-16 px-6 pt-6 pb-8 border-b border-gray-300 dark:border-gray-700 overflow-visible"
>
  <h1
    class="relative top-1 inline-block text-md sm:text-xl md:text-text-lg font-bold border-2 border-purple-500/33 rounded-md px-4 py-2
  after:content-[''] after:absolute after:bottom-[-22px] after:left-6 after:w-0 after:h-0
  after:border-l-[20px] after:border-l-transparent
  after:border-t-[20px] after:border-t-purple-500/33
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
  <Card class="m-4 sm:m-8 p-0 relative">
    <div
      bind:this={mapContainer}
      class="w-full h-[400px] md:h-[600px] rounded-lg"
    ></div>
    <div
      class="absolute bottom-4 left-4 bg-white dark:bg-gray-800 p-2 rounded-lg shadow-md"
    >
      <ul class="text-[13px] font-[600] text-gray-700 dark:text-gray-300">
        <li class="p-0.5">
          <Checkbox bind:checked={showStadsdelen} class="inline mr-2"
          ></Checkbox>
          <span style:color="#44ff44">--</span>
          {locale === "nl" ? `Stadsdelen` : `Districts`}
          ({stadsdelen.length})
        </li>
        <li class="p-0.5">
          <Checkbox bind:checked={showScholen} class="inline mr-2"></Checkbox>
          <span style:color="#ff4444">●</span>
          {locale === "nl" ? `Scholen` : `Schools`}
          ({locaties.filter((l) => l.type === "school").length})
        </li>
        <li class="p-0.5">
          <Checkbox bind:checked={showBibliotheken} class="inline mr-2"
          ></Checkbox>
          <span style:color="#4444ff">●</span>
          {locale === "nl" ? `Bibliotheken` : `Libraries`}
          ({locaties.filter((l) => l.type === "bibliotheek").length})
        </li>
      </ul>
    </div>
  </Card>

  {#if respondents}
    <Card class="m-4 sm:m-8 p-4 md:p-10 sm:p-6 ">
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

      {#if selectedLocatieId || selectedStadsdeelId}
        <div
          class="underline text-xs relative -top-3 opacity-75 cursor-pointer"
          onclick={() => {
            selectedLocatieId = null;
            selectedStadsdeelId = null;
          }}
        >
          &#8592; {locale === "nl"
            ? `Terug naar alle ondervraagden`
            : `Back to all respondents`} ({respondents.length})
        </div>
      {/if}

      {#if filteredRes.length == 0}
        <p class="opacity-50">Geen data over dit gebied...</p>
      {:else}
        <div>
          {@html locale === "nl"
            ? `Onder de <span class='underline'>${filteredRes.length}</span> ondervraagden 
            ${selectedStadsdeelId ? `in het stadsdeel <span class="underline">${selectedStadsdeel.naam}</span>` : ``}
            ${selectedLocatieId ? `op de locatie <span class="underline">${selectedLocatie.naam}</span>` : ``}
          worden de volgende talen`
            : `Among the <span class='underline'>${filteredRes.length}</span> respondents 
            ${selectedStadsdeelId ? `in the district <span class="underline">${selectedStadsdeel.naam}</span>` : ``}
            ${selectedLocatieId ? `at the location <span class="underline">${selectedLocatie.naam}</span>` : ``},
          the following languages are spoken`}
          <ul>
            <li class="p-1">
              <Checkbox
                bind:checked={languageFilters.proficient}
                class="inline "
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
                class="inline"
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

        {#if Object.values(languageSelected).includes(true)}
          {@const langsSelected = Object.keys(languageSelected).filter(
            (k) => languageSelected[k] === true,
          )}
          {@const langNames = langsSelected.map(
            (code) =>
              languageNames[code][locale === "nl" ? "nameNL" : "nameEN"],
          )}
          {@const langCombination = filteredRes.filter((r) =>
            langsSelected.every((code) =>
              r.languages.some(
                (l) =>
                  l.code === code &&
                  (!languageFilters.homeLanguage || l.homeLanguage) &&
                  (!languageFilters.proficient || l.proficient),
              ),
            ),
          )}
          <div class="bg-gray-500/10 p-2 rounded-lg">
            <X
              onclick={() =>
                Object.keys(languageSelected).forEach(
                  (k) => (languageSelected[k] = false),
                )}
              class="inline size-4 opacity-50 cursor-pointer mr-1"
            ></X>
            {#if !langCombination.length}
              {locale == "nl" ? `Geen van de ` : `None of the `}
            {:else}
              <span class="underline">{langCombination.length}</span>
              {locale == "nl" ? `van de` : `of the`}
            {/if}
            {locale == "nl" ? `ondervraagden ` : `respondents `}
            {#if langCombination.length}
              (<b class="text-sm"
                >{((langCombination.length / filteredRes.length) * 100).toFixed(
                  1,
                )}%</b
              >)
            {/if}
            {locale == "nl" ? `spreken` : `speak`}
            {#if langNames.length > 1}
              {@html langNames.slice(0, -1).join(", ") +
                (locale == "nl" ? " <b>en</b> " : " <b>and</b> ") +
                langNames.slice(-1)[0]}
            {:else}
              {langNames[0]}
            {/if}
          </div>
        {:else}
          <div class="bg-gray-500/10 p-2 text-sm text-gray-300 rounded-lg">
            {locale == "nl"
              ? `Selecteer één of meerdere van de onderstaande talen om te zien hoeveel ondervraagden
            deze combinatie spreken.`
              : `Select one or more languages below to see how many of the respondents speak this combination of languages.`}
          </div>
        {/if}
        <ul>
          {#each Object.entries(languageOccurences)
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
              <Checkbox
                class="inline mr-1"
                bind:checked={languageSelected[code]}
              />
              <span
                class="underline cursor-pointer"
                onclick={() => (showLangStatistics = !showLangStatistics)}
                >{locale === "nl"
                  ? languageNames[code].nameNL
                  : languageNames[code].nameEN},</span
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
                <b>({((count / filteredRes.length) * 100).toFixed(1)}%)</b>
              </span>

              {#if showLangStatistics}
                <ul class="text-[13px] text-gray-500 mt-1 ml-4">
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
                          ? languageNames[coocCode]?.nameNL
                          : languageNames[coocCode]?.nameEN}
                        ({coocCount}x) ({(
                          (coocCount / filteredRes.length) *
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

<footer class="bg-gray-500/10 p-6 text-center">
  <h3>
    © <b>Talenkaart Amsterdam</b>, Universiteit van Amsterdam, 2025.
  </h3>
  <br />
  Data verzameld via enquêtes op scholen en in stadsdelen in Amsterdam. Respondenten
  zijn anoniem; er worden geen persoonsgegevens opgeslagen.
  <br /><br />
  <a class="underline" href="https://github.com/talenkaart/talenkaartamsterdam"
    >GitHub repository &rarr;</a
  >
  <br />
  <a
    class="underline"
    href="https://creativecommons.org/licenses/by/4.0/deed.nl"
  >
    CC BY 4.0
  </a>
</footer>

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
