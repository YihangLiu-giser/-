// script.js (V5.1 - Focus on Legend and Logging)

// Ensure core libraries are loaded
if (typeof deck === 'undefined' || (typeof maplibregl === 'undefined' && typeof mapboxgl === 'undefined')) {
    const message = "CRITICAL ERROR: Required mapping libraries not loaded.";
    console.error(message); alert(message); throw new Error(message);
}

const mapLibrary = typeof maplibregl !== 'undefined' ? maplibregl : mapboxgl;
const { GeoJsonLayer, IconLayer } = deck;

// --- Configuration Constants ---
const GEOJSON_PATH_TEMPLATE = 'shenzhen_h3_access_pandana_res{resolution}.geojson';
const STATIONS_GEOJSON_PATH = 'shenzhen_subway_stations.geojson';
const DEFAULT_H3_RESOLUTION = 7;
const AVAILABLE_H3_RESOLUTIONS = [5, 6, 7, 8, 9, 10];
const MAPTILER_API_KEY = 'k84VW61MLYmoOFVcnsZK';

const BASEMAP_STYLES = {
    satellite: `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_API_KEY}`,
    streets: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`,
    topo: `https://api.maptiler.com/maps/topo-v2/style.json?key=${MAPTILER_API_KEY}`,
    dark: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_API_KEY}`,
};
const DEFAULT_BASEMAP_ID = 'streets';

const INITIAL_VIEW_STATE = {
    longitude: 114.0579, latitude: 22.5431, zoom: 10.5,
    pitch: 55, bearing: -20, minZoom: 8, maxZoom: 18
};

// --- Style and Helper Constants ---
const ALPHA = 200;
const COLOR_SCALE_CONFIG = [
    { limit: 2.5,  color: [252, 255, 164, ALPHA] }, { limit: 5,    color: [245, 219, 75, ALPHA]  },
    { limit: 7.5,  color: [252, 173, 18, ALPHA]  }, { limit: 10,   color: [247, 131, 17, ALPHA]  },
    { limit: 12.5, color: [230, 93, 47, ALPHA]   }, { limit: 15,   color: [203, 65, 73, ALPHA]   },
    { limit: 17.5, color: [169, 46, 94, ALPHA]   }, { limit: 20,   color: [133, 33, 107, ALPHA]  },
    { limit: 22.5, color: [96, 19, 110, ALPHA]   }, { limit: 25,   color: [58, 9, 99, ALPHA]    },
    { limit: 27.5, color: [20, 11, 53, ALPHA]   }, { limit: Infinity, color: [0, 0, 4, ALPHA] }
];
const NO_DATA_COLOR = [200, 200, 200, Math.max(0, ALPHA - 80)];
const MAX_ELEVATION_METERS = 4500;
const MAX_WALK_TIME_FOR_LOWEST_HEIGHT = 30;
const EMPHASIS_FACTOR = 2.3;
const MIN_BAR_HEIGHT = 15;

const STATIONS_ICON_URL = 'metro_icon.png';
const STATIONS_ICON_MAPPING = { // Adjust width/height to your actual icon file dimensions
    marker: { x: 0, y: 0, width: 280, height: 280, mask: false } // Example for a 128x128 icon
};
const STATIONS_ICON_SIZE = 4; // Base size in pixels
const STATIONS_ICON_MIN_SIZE_PIXELS = 20; // Min size
const STATIONS_ICON_MAX_SIZE_PIXELS = 96; // Max size
const STATIONS_LAYER_HIGHLIGHT_COLOR = [0, 255, 255, 255];

// DOM Element Cache
let loaderElement, tooltipElement, legendDiv, mapContainerElement;
let extrusionScaleSliderElement, extrusionScaleValueElement;
let h3ResolutionSliderElement, h3ResolutionValueElement;
let basemapSelectorElement;
let toggleAccessibilityLayerCheckbox, toggleStationsLayerCheckbox;

// Map and Layer State
let mapInstance;
let deckOverlayInstance;
let currentExtrusionMultiplier = 1.0;
let currentH3Data = null;
let currentStationsData = null;
let currentlyLoadedH3Resolution = null;
let showAccessibilityLayer = true;
let showStationsLayer = true;


// --- Helper Functions ---
function getColor(walkTimeMinutes) { /* ... (same as V5) ... */ 
    if (walkTimeMinutes === null || walkTimeMinutes === undefined || isNaN(walkTimeMinutes)) return NO_DATA_COLOR;
    for (const scale of COLOR_SCALE_CONFIG) {
        if (walkTimeMinutes <= scale.limit) return scale.color;
    }
    return COLOR_SCALE_CONFIG[COLOR_SCALE_CONFIG.length - 1].color;
}
function getElevation(walkTimeMinutes) { /* ... (same as V5) ... */
    const baseMinHeight = MIN_BAR_HEIGHT;
    if (walkTimeMinutes === null || walkTimeMinutes === undefined || isNaN(walkTimeMinutes) || walkTimeMinutes < 0) {
        return baseMinHeight * currentExtrusionMultiplier;
    }
    let proportion = 0;
    if (walkTimeMinutes < MAX_WALK_TIME_FOR_LOWEST_HEIGHT && walkTimeMinutes > 0.01) {
        const timeRatio = walkTimeMinutes / MAX_WALK_TIME_FOR_LOWEST_HEIGHT;
        proportion = Math.pow(1 - timeRatio, EMPHASIS_FACTOR);
    } else if (walkTimeMinutes <= 0.01) {
        proportion = 1;
    }
    proportion = Math.max(0, Math.min(proportion, 1));
    const calculatedHeight = proportion * MAX_ELEVATION_METERS + baseMinHeight;
    return calculatedHeight * currentExtrusionMultiplier;
}

function addLegend() {
    // This function should be called AFTER legendDiv is confirmed to be valid in initializeMap
    if (!legendDiv) {
        console.error("FATAL: legendDiv is not defined when addLegend is called. This should not happen.");
        return;
    }
    console.log("addLegend called. legendDiv found:", legendDiv); // Log to confirm it's called and div exists

    let legendHTML = '<div class="legend-title">平均步行时间 (分钟)</div>';
    let lowerBound = 0;
    if (COLOR_SCALE_CONFIG && COLOR_SCALE_CONFIG.length > 0) {
        COLOR_SCALE_CONFIG.forEach(item => {
            const cssColor = `rgba(${item.color[0]}, ${item.color[1]}, ${item.color[2]}, ${(item.color[3] / 255).toFixed(2)})`;
            legendHTML += `<div class="legend-item"><span class="legend-color-box" style="background-color:${cssColor};"></span><span class="legend-text">${lowerBound === 0 ? '≤ ' : lowerBound + ' – '} ${item.limit === Infinity ? `> ${lowerBound}` : item.limit}</span></div>`;
            if (item.limit !== Infinity) lowerBound = item.limit;
        });
        const noDataCssColor = `rgba(${NO_DATA_COLOR[0]}, ${NO_DATA_COLOR[1]}, ${NO_DATA_COLOR[2]}, ${(NO_DATA_COLOR[3] / 255).toFixed(2)})`;
        legendHTML += `<div class="legend-item"><span class="legend-color-box" style="background-color:${noDataCssColor};"></span><span class="legend-text">无数据/不可达</span></div>`;
        legendDiv.innerHTML = legendHTML;
        console.log("Legend HTML generated and set.");
    } else {
        console.error("COLOR_SCALE_CONFIG is empty or undefined. Cannot generate legend items.");
        legendDiv.innerHTML = '<div class="legend-title">图例配置错误</div>';
    }
}

function createH3LayerInstance() { /* ... (same as V5) ... */
    if (!currentH3Data || !currentH3Data.features || currentH3Data.features.length === 0) return null;
    return new GeoJsonLayer({
        id: 'h3-accessibility-layer', data: currentH3Data, filled: true, extruded: true, wireframe: false,
        getFillColor: d => getColor(d.properties.avg_walk_time_min),
        getElevation: d => getElevation(d.properties.avg_walk_time_min),
        elevationScale: 1.0, pickable: true, autoHighlight: true, highlightColor: [255, 255, 0, 180],
        onHover: info => {
            if (!tooltipElement) return;
            if (info.object) {
                const props = info.object.properties;
                tooltipElement.style.display = 'block';
                tooltipElement.style.left = `${info.x + 10}px`;
                tooltipElement.style.top = `${info.y + 10}px`;
                let content = `<strong>H3 ID:</strong> ${props.h3_id}<br>`;
                if (props.avg_walk_time_min !== null && props.avg_walk_time_min !== undefined) {
                    content += `<strong>平均步行时间:</strong> ${props.avg_walk_time_min.toFixed(1)} 分钟<br>`;
                    content += `<strong>平均步行距离:</strong> ${props.avg_dist_to_subway_m.toFixed(0)} 米`;
                } else { content += "无此区域可达性数据"; }
                tooltipElement.innerHTML = content;
            } else { tooltipElement.style.display = 'none'; }
        },
        updateTriggers: { getElevation: currentExtrusionMultiplier },
        visible: showAccessibilityLayer
    });
 }
function createStationsLayerInstance() { /* ... (same as V4/V5) ... */
    if (!currentStationsData || !currentStationsData.features || currentStationsData.features.length === 0) return null;
    return new IconLayer({
        id: 'subway-stations-layer',
        data: currentStationsData.features, 
        iconAtlas: STATIONS_ICON_URL,
        iconMapping: STATIONS_ICON_MAPPING,
        getIcon: d => 'marker',
        getPosition: d => d.geometry.coordinates,
        sizeScale: 1,
        getSize: d => STATIONS_ICON_SIZE,
        sizeMinPixels: STATIONS_ICON_MIN_SIZE_PIXELS,
        sizeMaxPixels: STATIONS_ICON_MAX_SIZE_PIXELS,
        pickable: true,
        autoHighlight: true, // autoHighlight for IconLayer might not change color, but can trigger hover
        onHover: info => {
            if (!tooltipElement) return;
            if (info.object) { 
                tooltipElement.style.display = 'block';
                tooltipElement.style.left = `${info.x + 10}px`;
                tooltipElement.style.top = `${info.y + 10}px`;
                let stationName = "地铁站点";
                if (info.object.properties) { 
                    stationName = info.object.properties.name || info.object.properties.Name || stationName;
                }
                tooltipElement.innerHTML = `<strong>${stationName}</strong>`;
            } else { tooltipElement.style.display = 'none'; }
        },
        visible: showStationsLayer
    });
}

function updateDeckLayers() { /* ... (same as V5) ... */ 
    if (!deckOverlayInstance) { console.warn("Deck overlay not initialized, cannot update layers."); return; }
    const layers = [];
    const h3Layer = createH3LayerInstance();
    const stationsLayer = createStationsLayerInstance();
    if (h3Layer) layers.push(h3Layer);
    if (stationsLayer) layers.push(stationsLayer);
    deckOverlayInstance.setProps({ layers });
}

function addDeckOverlayToMap() { /* ... (same as V5) ... */
    if (!mapInstance) { console.error("Map instance not available for Deck overlay."); return; }
    if (deckOverlayInstance) {
        try { mapInstance.removeControl(deckOverlayInstance); console.log("Old overlay removed.");}
        catch (e) { console.warn("Could not remove old Deck.gl overlay:", e); }
    }
    const MapboxOverlayClass = deck.MapboxOverlay;
    if (!MapboxOverlayClass) { console.error("MapboxOverlay class not found in Deck.gl."); return; }

    deckOverlayInstance = new MapboxOverlayClass({
        layers: [], interleaved: true,
        onError: (error, layer) => {
            console.error('Deck.gl Overlay Error:', error, 'Layer ID:', layer ? layer.id : 'N/A');
            if(loaderElement) loaderElement.classList.add('hidden');
        }
    });
    mapInstance.addControl(deckOverlayInstance);
    console.log("Deck.gl MapboxOverlay (re)added to map.");
    updateDeckLayers(); 
    if (!currentH3Data) {
        const initialEffectiveRes = getEffectiveH3Resolution(parseFloat(h3ResolutionSliderElement.value));
        loadAndRenderH3Data(initialEffectiveRes);
    }
    if (!currentStationsData) {
        loadStationsData();
    }
}

function loadAndRenderH3Data(resolutionToLoad) { /* ... (same as V5) ... */
    if (!loaderElement) { console.error("Loader not ready for H3 data."); return; }
    if (!AVAILABLE_H3_RESOLUTIONS.includes(resolutionToLoad)) {
        console.error(`Attempt to load unsupported H3 resolution: ${resolutionToLoad}.`); return;
    }
    const geojsonPath = GEOJSON_PATH_TEMPLATE.replace('{resolution}', resolutionToLoad);
    console.log(`Loading H3 data for res ${resolutionToLoad} from: ${geojsonPath}`);
    loaderElement.classList.remove('hidden');
    currentlyLoadedH3Resolution = resolutionToLoad;

    fetch(geojsonPath)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status} for ${geojsonPath}`);
            return response.json();
        })
        .then(geojsonData => {
            console.log(`H3 GeoJSON for res ${resolutionToLoad} parsed.`);
            currentH3Data = (geojsonData && geojsonData.features && geojsonData.features.length > 0) ? geojsonData : null;
            if (!currentH3Data) console.warn(`H3 GeoJSON for res ${resolutionToLoad} is empty or invalid.`);
            updateDeckLayers(); 
        })
        .catch(error => {
            console.error(`Error loading/processing H3 GeoJSON for res ${resolutionToLoad}:`, error);
            currentH3Data = null;
            updateDeckLayers(); 
        })
        .finally(() => { if(loaderElement) loaderElement.classList.add('hidden'); });
 }
function loadStationsData() { /* ... (same as V5) ... */
    if (!loaderElement) { console.error("Loader not ready for stations data."); return; }
    console.log(`Loading subway stations data from: ${STATIONS_GEOJSON_PATH}`);
    loaderElement.classList.remove('hidden');

    fetch(STATIONS_GEOJSON_PATH)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status} for ${STATIONS_GEOJSON_PATH}`);
            return response.json();
        })
        .then(geojsonData => {
            console.log("Subway stations GeoJSON parsed.");
            currentStationsData = (geojsonData && geojsonData.features && geojsonData.features.length > 0) ? geojsonData : null;
            if (!currentStationsData) console.warn("Subway stations GeoJSON data is empty or invalid.");
            updateDeckLayers(); 
        })
        .catch(error => {
            console.error("Error loading/processing subway stations GeoJSON:", error);
            currentStationsData = null;
            updateDeckLayers(); 
        })
        .finally(() => { if(loaderElement) loaderElement.classList.add('hidden'); });
}
function getEffectiveH3Resolution(sliderValue) { /* ... (same as V4/V5) ... */ 
    let roundedRes = Math.round(sliderValue);
    roundedRes = Math.max(AVAILABLE_H3_RESOLUTIONS[0], Math.min(roundedRes, AVAILABLE_H3_RESOLUTIONS[AVAILABLE_H3_RESOLUTIONS.length - 1]));
    if (!AVAILABLE_H3_RESOLUTIONS.includes(roundedRes)) {
        let closest = AVAILABLE_H3_RESOLUTIONS[0];
        let minDist = Math.abs(roundedRes - closest);
        for (let i = 1; i < AVAILABLE_H3_RESOLUTIONS.length; i++) {
            const dist = Math.abs(roundedRes - AVAILABLE_H3_RESOLUTIONS[i]);
            if (dist < minDist) { minDist = dist; closest = AVAILABLE_H3_RESOLUTIONS[i];}
        }
        roundedRes = closest;
    }
    return roundedRes;
}

function initializeMap() {
    console.log("DOM fully loaded. Initializing map...");
    // DOM Element Caching
    const DOMElements = {
        loader: document.getElementById('loader'),
        tooltip: document.getElementById('tooltip'),
        legend: document.getElementById('legend'), // Ensure this ID matches HTML
        mapContainer: document.getElementById('map-container'),
        extrusionScaleSlider: document.getElementById('extrusion-scale-slider'),
        extrusionScaleValue: document.getElementById('extrusion-scale-value'),
        h3ResolutionSlider: document.getElementById('h3-resolution-slider'),
        h3ResolutionValue: document.getElementById('h3-resolution-value'),
        basemapSelector: document.getElementById('basemap-selector'),
        toggleAccessibilityLayer: document.getElementById('toggle-accessibility-layer'),
        toggleStationsLayer: document.getElementById('toggle-stations-layer')
    };

    let allElementsFound = true;
    for (const key in DOMElements) {
        if (!DOMElements[key]) {
            console.error(`CRITICAL: DOM element for '${key}' (ID: ${DOMElements[key]?.id || document.getElementById(key)?.id || 'unknown'}) not found.`);
            allElementsFound = false;
        }
    }
    if (!allElementsFound) {
        alert("页面初始化错误：一个或多个必要的页面组件未找到。请检查HTML ID和浏览器控制台。");
        return;
    }
    // Assign to global variables
    loaderElement = DOMElements.loader;
    tooltipElement = DOMElements.tooltip;
    legendDiv = DOMElements.legend; // legendDiv is now assigned here
    mapContainerElement = DOMElements.mapContainer;
    extrusionScaleSliderElement = DOMElements.extrusionScaleSlider;
    extrusionScaleValueElement = DOMElements.extrusionScaleValue;
    h3ResolutionSliderElement = DOMElements.h3ResolutionSlider;
    h3ResolutionValueElement = DOMElements.h3ResolutionValue;
    basemapSelectorElement = DOMElements.basemapSelector;
    toggleAccessibilityLayerCheckbox = DOMElements.toggleAccessibilityLayer;
    toggleStationsLayerCheckbox = DOMElements.toggleStationsLayer;

    // Initialize visibility states AFTER DOM elements are confirmed
    showAccessibilityLayer = toggleAccessibilityLayerCheckbox.checked;
    showStationsLayer = toggleStationsLayerCheckbox.checked;

    // Event Listeners (same as V5)
    toggleAccessibilityLayerCheckbox.addEventListener('change', (event) => { /* ... updateDeckLayers() */ 
        showAccessibilityLayer = event.target.checked;
        console.log("Accessibility layer visibility changed to:", showAccessibilityLayer);
        updateDeckLayers();
    });
    toggleStationsLayerCheckbox.addEventListener('change', (event) => { /* ... updateDeckLayers() */ 
        showStationsLayer = event.target.checked;
        console.log("Stations layer visibility changed to:", showStationsLayer);
        updateDeckLayers();
    });
    extrusionScaleSliderElement.addEventListener('input', (event) => { /* ... updateDeckLayers() */
        currentExtrusionMultiplier = parseFloat(event.target.value);
        extrusionScaleValueElement.textContent = `${currentExtrusionMultiplier.toFixed(1)}x`;
        updateDeckLayers();
     });
    extrusionScaleValueElement.textContent = `${parseFloat(extrusionScaleSliderElement.value).toFixed(1)}x`;
    currentExtrusionMultiplier = parseFloat(extrusionScaleSliderElement.value);

    h3ResolutionSliderElement.addEventListener('input', (event) => { /* ... loadAndRenderH3Data() -> updateDeckLayers() */
        const sliderRawValue = parseFloat(event.target.value);
        const effectiveRes = getEffectiveH3Resolution(sliderRawValue);
        h3ResolutionValueElement.textContent = effectiveRes;
        if (effectiveRes !== currentlyLoadedH3Resolution) {
            currentH3Data = null; 
            updateDeckLayers(); 
            loadAndRenderH3Data(effectiveRes);
        }
    });
    const initialSliderValue = parseFloat(h3ResolutionSliderElement.value);
    const initialEffectiveRes = getEffectiveH3Resolution(initialSliderValue);
    h3ResolutionValueElement.textContent = initialEffectiveRes;
    
    basemapSelectorElement.addEventListener('change', (event) => { /* ... addDeckOverlayToMap() */ 
        const selectedBasemapId = event.target.value;
        const styleUrl = BASEMAP_STYLES[selectedBasemapId];
        if (mapInstance && styleUrl) {
            console.log(`Changing basemap to: ${selectedBasemapId}`);
            const {lng, lat} = mapInstance.getCenter(); 
            const zoom = mapInstance.getZoom();
            const pitch = mapInstance.getPitch();
            const bearing = mapInstance.getBearing();
            mapInstance.setStyle(styleUrl); 
            mapInstance.once('styledata', () => { 
                console.log("New basemap style loaded. Restoring view & DeckGL overlay.");
                mapInstance.setCenter([lng, lat]); 
                mapInstance.setZoom(zoom);
                mapInstance.setPitch(pitch);
                mapInstance.setBearing(bearing);
                addDeckOverlayToMap(); 
            });
        } else { console.error(`Invalid basemap ID or style URL for: ${selectedBasemapId}`);}
    });

    // Initialize Map Instance
    const initialMapStyleUrl = BASEMAP_STYLES[DEFAULT_BASEMAP_ID];
    try {
        mapInstance = new mapLibrary.Map({
            container: mapContainerElement, style: initialMapStyleUrl,
            center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
            zoom: INITIAL_VIEW_STATE.zoom, pitch: INITIAL_VIEW_STATE.pitch, bearing: INITIAL_VIEW_STATE.bearing,
            interactive: true, minZoom: INITIAL_VIEW_STATE.minZoom, maxZoom: INITIAL_VIEW_STATE.maxZoom
         });
        console.log("MapLibre/Mapbox GL JS map instance created.");
    } catch (mapError) { /* ... (error handling) ... */ return; }

    mapInstance.on('load', () => {
        console.log("Base map 'load' event. Initializing Deck.gl overlay and loading initial data.");
        addDeckOverlayToMap(); 
        
        // Crucially, call addLegend() AFTER legendDiv is confirmed to be valid and map is loaded
        if (legendDiv) { // Double check legendDiv before calling
            addLegend();
        } else {
            console.error("legendDiv is still not available when map loaded. Cannot add legend.");
        }
        
        if (!currentStationsData) {
            console.log("Base map loaded, triggering stations data load explicitly.");
            loadStationsData();
        }
    });
    mapInstance.on('error', (e) => { /* ... (error handling) ... */ });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMap);
} else {
    initializeMap();
}