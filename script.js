// script.js (V6.12 - Complete, Fix Line Highlight & Color Logic)

// Strict mode helps catch common coding errors
"use strict";

// Ensure core libraries are loaded
if (typeof deck === 'undefined' || (typeof maplibregl === 'undefined' && typeof mapboxgl === 'undefined')) {
    const message = "CRITICAL ERROR: Required mapping libraries not loaded.";
    console.error(message); alert(message); throw new Error(message);
}

const mapLibrary = typeof maplibregl !== 'undefined' ? maplibregl : mapboxgl;
const { GeoJsonLayer, IconLayer, PathLayer } = deck;

// --- Configuration Constants ---
const GEOJSON_PATH_TEMPLATE = 'shenzhen_h3_access_pandana_res{resolution}.geojson';
const STATIONS_GEOJSON_PATH = 'shenzhen_subway_stations.geojson';
const LINES_GEOJSON_PATH = 'shenzhen_metro_lines.geojson';
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
// IMPORTANT: Replace 128, 128 with your metro_icon.png's actual pixel width and height
const STATIONS_ICON_MAPPING = { marker: { x: 0, y: 0, width: 280, height: 280, mask: false } };
const STATIONS_ICON_SIZE = 4;
const STATIONS_ICON_MIN_SIZE_PIXELS = 16;
const STATIONS_ICON_MAX_SIZE_PIXELS = 80;

const METRO_LINE_WIDTH = 5;
const METRO_LINE_HIGHLIGHT_COLOR = [255, 0, 255, 255]; // Magenta
const DEFAULT_METRO_LINE_COLOR_RGB = [100, 100, 100];
const METRO_LINE_COLOR_MAP = { // Example, use your actual line names and preferred colors
    "1号线": [0, 153, 51],   "2号线": [243, 112, 33], "3号线": [0, 160, 220],
    "4号线": [237, 28, 36],  "5号线": [126, 70, 151], "6号线": [0, 169, 157],
    "7号线": [0, 84, 166],   "8号线": [243, 112, 33], // Often same as 2号线 or a variant
    "9号线": [153, 153, 102],"10号线": [252, 175, 200],
    "11号线": [102, 0, 102], "12号线": [0, 130, 123],
    "14号线": [178, 178, 178],"16号线": [101, 194, 235],
    "default": [128, 128, 128] // Fallback color for lines not in map
};

// DOM Element Cache
let domElements = {};

// Map and Layer State
let mapInstance;
let deckOverlayInstance = null;
let currentExtrusionMultiplier = 1.0;
let currentH3Data = null;
let currentStationsData = null;
let currentLinesData = null; // This will store the original FeatureCollection for lines
let currentFlattenedLinesData = null; // This will store the array of LineString features for PathLayer
let currentlyLoadedH3Resolution = null;
let showAccessibilityLayer, showStationsLayer, showMetroLinesLayer;
let highlightedLineId = null; // Stores the _originalFeatureId of the highlighted line

// --- Helper Functions ---
function getColor(walkTimeMinutes) {
    if (walkTimeMinutes === null || walkTimeMinutes === undefined || isNaN(walkTimeMinutes)) return NO_DATA_COLOR;
    for (const scale of COLOR_SCALE_CONFIG) {
        if (walkTimeMinutes <= scale.limit) return scale.color;
    }
    return COLOR_SCALE_CONFIG[COLOR_SCALE_CONFIG.length - 1].color;
}

function getElevation(walkTimeMinutes) {
    const baseMinHeight = MIN_BAR_HEIGHT;
    if (walkTimeMinutes === null || walkTimeMinutes === undefined || isNaN(walkTimeMinutes) || walkTimeMinutes < 0) {
        return baseMinHeight * currentExtrusionMultiplier;
    }
    let proportion = 0;
    if (walkTimeMinutes < MAX_WALK_TIME_FOR_LOWEST_HEIGHT && walkTimeMinutes > 0.01) {
        const timeRatio = walkTimeMinutes / MAX_WALK_TIME_FOR_LOWEST_HEIGHT;
        proportion = Math.pow(1 - timeRatio, EMPHASIS_FACTOR);
    } else if (walkTimeMinutes <= 0.01) { proportion = 1; }
    proportion = Math.max(0, Math.min(proportion, 1));
    const calculatedHeight = proportion * MAX_ELEVATION_METERS + baseMinHeight;
    return calculatedHeight * currentExtrusionMultiplier;
}

function addLegend() {
    if (!domElements.legend) { console.error("addLegend: legendDiv not found in domElements."); return; }
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
        domElements.legend.innerHTML = legendHTML;
    } else {
        domElements.legend.innerHTML = '<div class="legend-title">图例配置错误</div>';
    }
}

function createH3LayerInstance() {
    if (!currentH3Data || !currentH3Data.features || currentH3Data.features.length === 0) return null;
    return new GeoJsonLayer({
        id: 'h3-accessibility-layer', data: currentH3Data, filled: true, extruded: true, wireframe: false,
        getFillColor: d => getColor(d.properties.avg_walk_time_min),
        getElevation: d => getElevation(d.properties.avg_walk_time_min),
        elevationScale: 1.0, pickable: true, autoHighlight: true, highlightColor: [255, 255, 0, 180],
        onHover: info => {
            if (!domElements.tooltip) return;
            if (info.object) {
                const props = info.object.properties;
                domElements.tooltip.style.display = 'block';
                domElements.tooltip.style.left = `${info.x + 10}px`;
                domElements.tooltip.style.top = `${info.y + 10}px`;
                let content = `<strong>H3 ID:</strong> ${props.h3_id}<br>`;
                if (props.avg_walk_time_min !== null && props.avg_walk_time_min !== undefined) {
                    content += `<strong>平均步行时间:</strong> ${props.avg_walk_time_min.toFixed(1)} 分钟<br>`;
                    content += `<strong>平均步行距离:</strong> ${props.avg_dist_to_subway_m.toFixed(0)} 米`;
                } else { content += "无此区域可达性数据"; }
                domElements.tooltip.innerHTML = content;
            } else { domElements.tooltip.style.display = 'none'; }
        },
        updateTriggers: { getElevation: currentExtrusionMultiplier },
        visible: showAccessibilityLayer
    });
}

function createStationsLayerInstance() {
    if (!currentStationsData || !currentStationsData.features || currentStationsData.features.length === 0) return null;
    return new IconLayer({
        id: 'subway-stations-layer', data: currentStationsData.features,
        iconAtlas: STATIONS_ICON_URL, iconMapping: STATIONS_ICON_MAPPING, getIcon: d => 'marker',
        getPosition: d => d.geometry.coordinates,
        sizeScale: 1, getSize: STATIONS_ICON_SIZE,
        sizeMinPixels: STATIONS_ICON_MIN_SIZE_PIXELS, sizeMaxPixels: STATIONS_ICON_MAX_SIZE_PIXELS,
        pickable: true, autoHighlight: false,
        onHover: info => {
            if (!domElements.tooltip) return;
            if (info.object) {
                domElements.tooltip.style.display = 'block';
                domElements.tooltip.style.left = `${info.x + 10}px`;
                domElements.tooltip.style.top = `${info.y + 10}px`;
                let content = "<strong>地铁站点</strong><br>";
                if (info.object.properties) {
                    const props = info.object.properties;
                    const primaryName = props.station_name_zh || props.name || props.Name || "未知站点";
                    content = `<strong>${primaryName}</strong><br><hr style="margin: 3px 0;">`;
                    for (const key in props) {
                        if (props.hasOwnProperty(key) && !['station_name_zh', 'name', 'Name', 'geometry'].includes(key) && props[key] !== null && String(props[key]).trim() !== "") {
                             content += `<span>${key}:</span> ${props[key]}<br>`;
                        }
                    }
                }
                domElements.tooltip.innerHTML = content.replace(/<br>$/, ""); 
            } else {
                domElements.tooltip.style.display = 'none';
            }
        },
        visible: showStationsLayer
    });
}

function isValidCoordinate(coord) {
    return Array.isArray(coord) && coord.length >= 2 && typeof coord[0] === 'number' && typeof coord[1] === 'number' && !isNaN(coord[0]) && !isNaN(coord[1]);
}
function isValidLineStringCoordinates(coords) {
    return Array.isArray(coords) && coords.length >= 2 && coords.every(isValidCoordinate);
}
function isValidMultiLineStringCoordinates(coords) {
    return Array.isArray(coords) && coords.length > 0 && coords.every(isValidLineStringCoordinates);
}

function createMetroLinesLayerInstance() {
    if (!currentFlattenedLinesData || currentFlattenedLinesData.length === 0) { // Use flattened data
        return null;
    }
    // console.log(`createMetroLinesLayerInstance: Creating PathLayer with ${currentFlattenedLinesData.length} flattened features. Highlighted ID: ${highlightedLineId}`);

    try {
        return new PathLayer({
            id: 'metro-lines-layer',
            data: currentFlattenedLinesData, // Use the pre-processed flattened data
            
            getPath: feature => feature.geometry.coordinates,
            
            getColor: d => { // d is one of the flattenedFeatures
                const currentFeatureOriginalId = d.properties._originalFeatureId;

                if (highlightedLineId !== null && currentFeatureOriginalId === highlightedLineId) {
                    return METRO_LINE_HIGHLIGHT_COLOR;
                }
                if (d.properties && d.properties.color) {
                    const hexColor = d.properties.color;
                    if (typeof hexColor === 'string' && hexColor.startsWith('#')) {
                        try { 
                            let r, g, b;
                            if (hexColor.length === 7) {
                                r = parseInt(hexColor.slice(1, 3), 16); g = parseInt(hexColor.slice(3, 5), 16); b = parseInt(hexColor.slice(5, 7), 16);
                            } else if (hexColor.length === 4) {
                                r = parseInt(hexColor.slice(1, 2).repeat(2), 16); g = parseInt(hexColor.slice(2, 3).repeat(2), 16); b = parseInt(hexColor.slice(3, 4).repeat(2), 16);
                            } else { throw new Error("Invalid HEX"); }
                            if (![r,g,b].some(isNaN)) return [r, g, b, ALPHA];
                        } catch (e) { /* fallback */ }
                    }
                }
                const lineName = d.properties.line_name || d.properties.name;
                const mappedColor = lineName && METRO_LINE_COLOR_MAP[lineName];
                const defaultColor = METRO_LINE_COLOR_MAP["default"] || DEFAULT_METRO_LINE_COLOR_RGB;
                return mappedColor ? [...mappedColor, ALPHA] : [...defaultColor, ALPHA];
            },
            getWidth: METRO_LINE_WIDTH,
            widthUnits: 'pixels',
            widthMinPixels: 1,
            jointRounded: true,
            capRounded: true,
            
            pickable: true, 
            autoHighlight: false,

            onClick: (info) => { // info.object is a flattenedFeature
                if (info.object && info.object.properties) {
                    const clickedOriginalFeatureId = info.object.properties._originalFeatureId;
                    
                    highlightedLineId = (highlightedLineId === clickedOriginalFeatureId) ? null : clickedOriginalFeatureId;
                    
                    if (domElements.tooltip) {
                        if (highlightedLineId !== null) {
                            domElements.tooltip.style.display = 'block';
                            domElements.tooltip.style.left = `${info.x + 10}px`;
                            domElements.tooltip.style.top = `${info.y + 10}px`;
                            domElements.tooltip.innerHTML = `<strong>线路: ${info.object.properties.line_name || info.object.properties.name || '未知线路'}</strong>`;
                        } else {
                            domElements.tooltip.style.display = 'none';
                        }
                    }
                } else { 
                    if (highlightedLineId !== null) highlightedLineId = null;
                    if (domElements.tooltip) domElements.tooltip.style.display = 'none';
                }
                updateDeckLayers(); 
            },
            updateTriggers: {
                getColor: highlightedLineId 
            },
            visible: showMetroLinesLayer
        });
    } catch (error) {
        console.error("FATAL ERROR during PathLayer instantiation (with flattened data):", error);
        return null;
    }
}

function updateDeckLayers() {
    if (!deckOverlayInstance) { return; }
    const layers = [];
    const h3Layer = createH3LayerInstance();
    const stationsLayer = createStationsLayerInstance();
    const linesLayer = createMetroLinesLayerInstance();

    if (h3Layer) layers.push(h3Layer);
    if (stationsLayer) layers.push(stationsLayer);
    if (linesLayer) layers.push(linesLayer);
    
    deckOverlayInstance.setProps({ layers });
    // console.log(`Deck layers updated. Total: ${layers.length}. H3:${showAccessibilityLayer}, Stn:${showStationsLayer}, Lines:${showMetroLinesLayer}`);
}

function setupDeckGLAndLoadData() {
    if (!mapInstance || !domElements.h3ResolutionSlider) { return; }
    if (deckOverlayInstance && typeof mapInstance.hasControl === 'function' && mapInstance.hasControl(deckOverlayInstance)) {
        try { mapInstance.removeControl(deckOverlayInstance); } catch (e) { /* ignore */ }
    }
    deckOverlayInstance = null; 
    deckOverlayInstance = new deck.MapboxOverlay({ layers: [], interleaved: true, 
        onError: (e, layer) => { 
            console.error('Deck.gl Overlay Error:', e, 'Layer ID:', layer ? layer.id : 'N/A'); 
            if(domElements.loader) domElements.loader.classList.add('hidden');
        }
    });
    mapInstance.addControl(deckOverlayInstance);
    updateDeckLayers(); 
    const initialEffectiveRes = getEffectiveH3Resolution(parseFloat(domElements.h3ResolutionSlider.value));
    loadAndRenderH3Data(initialEffectiveRes);
    loadStationsData();
    loadMetroLinesData(); // This will load original lines data and then process it
}

function loadAndRenderH3Data(resolutionToLoad) {
    if (!domElements.loader) { return; }
    if (!AVAILABLE_H3_RESOLUTIONS.includes(resolutionToLoad)) {
        currentH3Data = null; updateDeckLayers(); return; 
    }
    const geojsonPath = GEOJSON_PATH_TEMPLATE.replace('{resolution}', resolutionToLoad);
    domElements.loader.classList.remove('hidden');
    currentlyLoadedH3Resolution = resolutionToLoad;
    fetch(geojsonPath)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status} for H3: ${geojsonPath}`);
            return response.json();
        })
        .then(geojsonData => { currentH3Data = (geojsonData?.features?.length > 0) ? geojsonData : null; })
        .catch(error => { console.error(`Error H3 (res ${resolutionToLoad}):`, error); currentH3Data = null; })
        .finally(() => { updateDeckLayers(); if(domElements.loader) domElements.loader.classList.add('hidden'); });
}

function loadStationsData() {
    if (!domElements.loader) { return; }
    domElements.loader.classList.remove('hidden');
    fetch(STATIONS_GEOJSON_PATH)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status} for Stations: ${STATIONS_GEOJSON_PATH}`);
            return response.json();
        })
        .then(geojsonData => { currentStationsData = (geojsonData?.features?.length > 0) ? geojsonData : null; })
        .catch(error => { console.error(`Error Stations:`, error); currentStationsData = null; })
        .finally(() => { updateDeckLayers(); if(domElements.loader) domElements.loader.classList.add('hidden'); });
}

function processAndStoreLinesData(originalLinesData) {
    if (!originalLinesData || !originalLinesData.features || originalLinesData.features.length === 0) {
        currentFlattenedLinesData = [];
        console.warn("processAndStoreLinesData: Original lines data is empty or invalid.");
        return;
    }
    const flattened = [];
    originalLinesData.features.forEach((feature, featureIndex) => {
        if (!feature || !feature.geometry || !feature.geometry.coordinates) return;
        const type = feature.geometry.type;
        const coords = feature.geometry.coordinates;
        const properties = feature.properties || {};
        const originalFeatureIdentifier = properties.line_name || properties.name || properties.id || properties.OBJECTID || featureIndex;

        if (type === "LineString") {
            if (isValidLineStringCoordinates(coords)) {
                flattened.push({ ...feature, properties: {...properties, _originalFeatureId: originalFeatureIdentifier} });
            }
        } else if (type === "MultiLineString") {
            if (isValidMultiLineStringCoordinates(coords)) {
                coords.forEach((lineSegmentCoords) => {
                    if (isValidLineStringCoordinates(lineSegmentCoords)) {
                        flattened.push({
                            type: "Feature",
                            properties: { ...properties, _originalFeatureId: originalFeatureIdentifier },
                            geometry: { type: "LineString", coordinates: lineSegmentCoords }
                        });
                    }
                });
            }
        }
    });
    currentFlattenedLinesData = flattened;
    console.log(`Lines data processed: ${originalLinesData.features.length} original -> ${flattened.length} flattened LineString features.`);
}


function loadMetroLinesData() {
    if (!domElements.loader) { return; }
    domElements.loader.classList.remove('hidden');
    fetch(LINES_GEOJSON_PATH)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status} for Lines: ${LINES_GEOJSON_PATH}`);
            return response.json();
        })
        .then(geojsonData => {
            currentLinesData = (geojsonData?.features?.length > 0) ? geojsonData : null; // Store original
            processAndStoreLinesData(currentLinesData); // Process and store flattened
        })
        .catch(error => { 
            console.error(`Error Lines:`, error); 
            currentLinesData = null; 
            currentFlattenedLinesData = null;
        })
        .finally(() => { updateDeckLayers(); if(domElements.loader) domElements.loader.classList.add('hidden'); });
}

function getEffectiveH3Resolution(sliderValue) {
    if (isNaN(sliderValue) || sliderValue === undefined || sliderValue === null) return DEFAULT_H3_RESOLUTION;
    let roundedRes = Math.round(sliderValue);
    roundedRes = Math.max(AVAILABLE_H3_RESOLUTIONS[0], Math.min(roundedRes, AVAILABLE_H3_RESOLUTIONS[AVAILABLE_H3_RESOLUTIONS.length - 1]));
    if (!AVAILABLE_H3_RESOLUTIONS.includes(roundedRes)) {
        let closest = AVAILABLE_H3_RESOLUTIONS[0];
        let minDist = Math.abs(roundedRes - closest);
        AVAILABLE_H3_RESOLUTIONS.forEach(res => {
            const dist = Math.abs(roundedRes - res);
            if (dist < minDist) { minDist = dist; closest = res; }
        });
        roundedRes = closest;
    }
    return roundedRes;
}

function initializeDOMAndListeners() {
    // console.log("DOM: Caching elements and attaching listeners...");
    domElements = {
        loader: document.getElementById('loader'),
        tooltip: document.getElementById('tooltip'),
        legend: document.getElementById('legend'),
        mapContainer: document.getElementById('map-container'),
        extrusionScaleSlider: document.getElementById('extrusion-scale-slider'),
        extrusionScaleValue: document.getElementById('extrusion-scale-value'),
        h3ResolutionSlider: document.getElementById('h3-resolution-slider'),
        h3ResolutionValue: document.getElementById('h3-resolution-value'),
        basemapSelector: document.getElementById('basemap-selector'),
        toggleAccessibilityLayer: document.getElementById('toggle-accessibility-layer'),
        toggleStationsLayer: document.getElementById('toggle-stations-layer'),
        toggleLinesLayer: document.getElementById('toggle-lines-layer')
    };

    const missing = Object.keys(domElements).filter(key => !domElements[key]);
    if (missing.length > 0) {
        const errorMsg = `HTML Error: Missing elements: ${missing.join(', ')}. Check IDs.`;
        console.error(errorMsg); alert(errorMsg);
        if (domElements.mapContainer) domElements.mapContainer.innerHTML = `<div style='color:red;padding:20px;'>${errorMsg}</div>`;
        return false;
    }

    showAccessibilityLayer = domElements.toggleAccessibilityLayer.checked;
    showStationsLayer = domElements.toggleStationsLayer.checked;
    showMetroLinesLayer = domElements.toggleLinesLayer.checked;

    domElements.toggleAccessibilityLayer.addEventListener('change', e => { showAccessibilityLayer = e.target.checked; updateDeckLayers(); });
    domElements.toggleStationsLayer.addEventListener('change', e => { showStationsLayer = e.target.checked; updateDeckLayers(); });
    domElements.toggleLinesLayer.addEventListener('change', e => { showMetroLinesLayer = e.target.checked; updateDeckLayers(); });

    domElements.extrusionScaleSlider.addEventListener('input', e => {
        currentExtrusionMultiplier = parseFloat(e.target.value);
        domElements.extrusionScaleValue.textContent = `${currentExtrusionMultiplier.toFixed(1)}x`;
        updateDeckLayers();
    });
    domElements.extrusionScaleValue.textContent = `${parseFloat(domElements.extrusionScaleSlider.value).toFixed(1)}x`;
    currentExtrusionMultiplier = parseFloat(domElements.extrusionScaleSlider.value);

    domElements.h3ResolutionSlider.addEventListener('input', e => {
        const effectiveRes = getEffectiveH3Resolution(parseFloat(e.target.value));
        domElements.h3ResolutionValue.textContent = effectiveRes;
        if (effectiveRes !== currentlyLoadedH3Resolution) {
            currentH3Data = null; 
            updateDeckLayers(); 
            loadAndRenderH3Data(effectiveRes);
        }
    });
    domElements.h3ResolutionValue.textContent = getEffectiveH3Resolution(parseFloat(domElements.h3ResolutionSlider.value));
    
    domElements.basemapSelector.addEventListener('change', e => {
        const styleUrl = BASEMAP_STYLES[e.target.value];
        if (mapInstance && styleUrl) {
            const {lng, lat} = mapInstance.getCenter(); 
            const zoom = mapInstance.getZoom(), pitch = mapInstance.getPitch(), bearing = mapInstance.getBearing();
            mapInstance.setStyle(styleUrl); 
            mapInstance.once('load', () => { 
                mapInstance.setCenter([lng, lat]); 
                mapInstance.setZoom(zoom); mapInstance.setPitch(pitch); mapInstance.setBearing(bearing);
                // The map's primary 'load' event handler will call setupDeckGLAndLoadData
            });
        }
    });
    // console.log("DOM: Elements cached, listeners attached.");
    return true;
}

function initializeApp() {
    console.log("App: Initializing...");
    if (!initializeDOMAndListeners()) {
        console.error("App: DOM initialization failed. Aborting.");
        return;
    }

    try {
        mapInstance = new mapLibrary.Map({
            container: domElements.mapContainer, style: BASEMAP_STYLES[DEFAULT_BASEMAP_ID],
            center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
            zoom: INITIAL_VIEW_STATE.zoom, pitch: INITIAL_VIEW_STATE.pitch, bearing: INITIAL_VIEW_STATE.bearing,
            interactive: true, minZoom: INITIAL_VIEW_STATE.minZoom, maxZoom: INITIAL_VIEW_STATE.maxZoom
         });
        console.log("App: Map instance created.");
    } catch (mapError) {
        console.error("App: Failed to initialize base map:", mapError);
        if(domElements.loader) domElements.loader.classList.add('hidden');
        alert(`底图初始化失败: ${mapError.message}.`);
        return;
    }

    mapInstance.on('load', () => {
        console.log("Map 'load' event. Setting up Deck.gl and loading data.");
        setupDeckGLAndLoadData(); 
        if (domElements.legend) addLegend(); else console.error("Legend div not ready for addLegend.");
    });
    mapInstance.on('error', e => { 
        console.error("MapLibre/Mapbox GL JS map error event:", e.error ? e.error.message : e);
        if (e.error?.message?.toLowerCase().includes("webgl")) {
            alert("WebGL初始化失败。请确保您的浏览器支持WebGL并且已启用。");
        }
        if(domElements.loader) domElements.loader.classList.add('hidden');
     });
}

// Start the application
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
