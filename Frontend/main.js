// Configuración del endpoint local de FastAPI
const BASE_URL = 'https://web-production-3ee6f.up.railway.app/api';

// Inicialización del mapa centrado en Medellín con optimización de Canvas
const map = L.map('map', {
    preferCanvas: true // Mejora rendimiento de renderizado de miles de líneas
}).setView([6.2442, -75.5812], 13);

let currentTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Variables de control de estado global y capas
let heatmapLayer = null;
let pathLayers = []; // Contiene FeatureGroups de exploraciones y polilíneas finales

// Gestión estricta de marcadores únicos para evitar "fantasmas"
let markerOrigen = null;
let markerDestino = null;

let activePickMode = null; // 'origin' o 'destination'
let mapLocked = false;

// Reloj global para detener animaciones simultáneamente
let animationClock = null;

// --- DEFINICIÓN DE ICONOS CIRCULARES PEQUEÑOS (CSS) ---
const originCircleIcon = L.divIcon({
    className: 'custom-circle-marker marker-origin',
    iconSize: [12, 12], // Pequeños y discretos
    iconAnchor: [6, 6]  // Centrado perfecto
});

const destCircleIcon = L.divIcon({
    className: 'custom-circle-marker marker-dest',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
});

// --- 1. CONTROL DEL SLIDER INTEGRADO (Alpha + Beta = 1.0) ---
const slider = document.getElementById('balance-slider');
const alphaLabel = document.getElementById('alpha-val');
const betaLabel = document.getElementById('beta-val');

// CORRECCIÓN APLICADA: Se eliminó la validación 'if (mapLocked) return;'
// Ahora el slider SIEMPRE se puede mover, sin importar si ya hay ruta o no.
slider.addEventListener('input', (e) => {
    const beta = parseFloat(e.target.value);
    const alpha = (1 - beta).toFixed(1);
    alphaLabel.innerText = `Alpha: ${alpha}`;
    betaLabel.innerText = `Beta: ${beta}`;
});

// --- 2. INTERRUPTOR DE DISEÑO: MODO CLARO / OSCURO ---
document.getElementById('theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    map.removeLayer(currentTiles);

    const tileUrl = document.body.classList.contains('dark-mode')
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

    currentTiles = L.tileLayer(tileUrl, {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
});

// --- 3. SISTEMA DE COORDENADAS INTERACTIVO Y BLOQUEO ---
document.getElementById('btn-pick-origin').addEventListener('click', () => {
    if (!mapLocked) setActivePick('origin');
});
document.getElementById('btn-pick-destination').addEventListener('click', () => {
    if (!mapLocked) setActivePick('destination');
});

function setActivePick(mode) {
    activePickMode = mode;
    document.getElementById('map').style.cursor = 'crosshair';
    // Resetear visualmente botones
    document.getElementById('btn-pick-origin').classList.remove('active');
    document.getElementById('btn-pick-destination').classList.remove('active');
    document.getElementById(`btn-pick-${mode}`).classList.add('active');
}

// Clic en el mapa para capturar coordenadas
map.on('click', (e) => {
    if (!activePickMode || mapLocked) return;

    const lat = e.latlng.lat.toFixed(6);
    const lon = e.latlng.lng.toFixed(6);
    document.getElementById(`${activePickMode}-input`).value = `${lat},${lon}`;

    // Actualización estricta para borrar el anterior inmediatamente
    updateTechnicalMarker(activePickMode, e.latlng);

    document.getElementById(`btn-pick-${activePickMode}`).classList.remove('active');
    document.getElementById('map').style.cursor = '';
    activePickMode = null;
    checkAndApplyLock();
});

// Marcado inmediato al seleccionar barrios predeterminados
function handleBarrioSelection(e, inputId, type) {
    if (mapLocked || !e.target.value) return;

    const coordsStr = e.target.value;
    document.getElementById(inputId).value = coordsStr;
    const coordsArr = coordsStr.split(',').map(Number);

    // Actualización estricta del marcador circular
    updateTechnicalMarker(type, coordsArr);

    // Desplazar cámara
    map.setView(coordsArr, 14);
    checkAndApplyLock();
}

document.getElementById('select-barrio-origin').addEventListener('change', (e) => handleBarrioSelection(e, 'origin-input', 'origin'));
document.getElementById('select-barrio-destination').addEventListener('change', (e) => handleBarrioSelection(e, 'destination-input', 'destination'));

// Soporte de Geolocalización por GPS nativo
function getDeviceGPS(inputId, type) {
    if (mapLocked) return;
    if (!navigator.geolocation) return alert("Tu dispositivo no soporta geolocalización.");

    navigator.geolocation.getCurrentPosition(position => {
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);
        document.getElementById(inputId).value = `${lat},${lon}`;

        updateTechnicalMarker(type, [lat, lon]);
        map.setView([lat, lon], 15);
        checkAndApplyLock();
    }, () => alert("No se pudo acceder a la ubicación."));
}

document.getElementById('btn-gps-origin').addEventListener('click', () => getDeviceGPS('origin-input', 'origin'));
document.getElementById('btn-gps-destination').addEventListener('click', () => getDeviceGPS('destination-input', 'destination'));

// Modificación técnica para gestionar marcadores únicos sin duplicados
function updateTechnicalMarker(type, latlng) {
    if (type === 'origin') {
        if (markerOrigen) map.removeLayer(markerOrigen);
        markerOrigen = L.marker(latlng, {
            icon: originCircleIcon,
            zIndexOffset: 1000
        }).addTo(map);
    } else {
        if (markerDestino) map.removeLayer(markerDestino);
        markerDestino = L.marker(latlng, {
            icon: destCircleIcon,
            zIndexOffset: 1000
        }).addTo(map);
    }
}

// Bloquea solo herramientas de captura, dejando libres los disparadores de rutas (y el slider)
function checkAndApplyLock() {
    const originVal = document.getElementById('origin-input').value;
    const destVal = document.getElementById('destination-input').value;

    if (originVal && destVal) {
        mapLocked = true;

        // Desactivar estrictamente entradas y selectores para proteger el estado geográfico
        document.getElementById('origin-input').disabled = true;
        document.getElementById('destination-input').disabled = true;
        document.getElementById('select-barrio-origin').disabled = true;
        document.getElementById('select-barrio-destination').disabled = true;

        // Desactivar botones de captura individuales
        document.getElementById('btn-pick-origin').disabled = true;
        document.getElementById('btn-pick-destination').disabled = true;
        document.getElementById('btn-gps-origin').disabled = true;
        document.getElementById('btn-gps-destination').disabled = true;

        console.log("[SafeRoute] Coordenadas fijadas. Los botones de cálculo permanecen activos.");
    }
}

// --- 4. MAPA DE CALOR ULTRA-SUAVIZADO ---
document.getElementById('heatmap-toggle').addEventListener('change', async (e) => {
    if (e.target.checked) {
        try {
            const response = await fetch(`${BASE_URL}/heatmap`);
            const data = await response.json();

            heatmapLayer = L.heatLayer(data, {
                radius: 15,
                blur: 30,          // Difuminado extremo para simular zonas continuas
                maxZoom: 20,
                max: 1,          // Evita plastrones rojos opacos
                gradient: { 0.4: '#ffff00', 0.7: '#ff8c00', 1.0: '#ff0000' }
            }).addTo(map);
        } catch (err) {
            console.error("Error cargando heatmap:", err);
        }
    } else {
        if (heatmapLayer) map.removeLayer(heatmapLayer);
    }
});

// --- 5. BOTÓN DE LIMPIEZA TOTAL (CON DETENCIÓN ABSOLUTA DE PROCESOS) ---
document.getElementById('btn-clear').addEventListener('click', () => {
    // PARADA DE EMERGENCIA: Rompe los hilos de animación en ejecución
    if (animationClock) {
        clearInterval(animationClock);
        animationClock = null;
        console.log("[SafeRoute] Hilo de animación destruido por limpieza.");
    }

    // Limpar capas viales
    clearMapPaths();

    // Destruir instancias de marcadores
    if (markerOrigen) { map.removeLayer(markerOrigen); markerOrigen = null; }
    if (markerDestino) { map.removeLayer(markerDestino); markerDestino = null; }

    // Reactivar todos los elementos de la interfaz de forma explícita
    document.getElementById('origin-input').disabled = false;
    document.getElementById('destination-input').disabled = false;
    document.getElementById('select-barrio-origin').disabled = false;
    document.getElementById('select-barrio-destination').disabled = false;
    document.getElementById('btn-pick-origin').disabled = false;
    document.getElementById('btn-pick-destination').disabled = false;
    document.getElementById('btn-gps-origin').disabled = false;
    document.getElementById('btn-gps-destination').disabled = false;

    // Resetear valores de entrada
    document.getElementById('origin-input').value = '';
    document.getElementById('destination-input').value = '';
    document.getElementById('select-barrio-origin').value = '';
    document.getElementById('select-barrio-destination').value = '';

    mapLocked = false;
    if (activePickMode) {
        document.getElementById(`btn-pick-${activePickMode}`).classList.remove('active');
        activePickMode = null;
    }
    document.getElementById('map').style.cursor = '';

    // Resetear visualizadores métricos
    resetMetricBlock('metrics-astar');
    resetMetricBlock('metrics-greedy');
});

function clearMapPaths() {
    pathLayers.forEach(layer => map.removeLayer(layer));
    pathLayers = [];
}

// --- 6. GESTIÓN DE PETICIONES AL BACKEND ---
document.getElementById('btn-calculate').addEventListener('click', () => requestRouteService(false));
document.getElementById('btn-emergency-cai').addEventListener('click', () => requestRouteService(true, 'cai'));
document.getElementById('btn-emergency-hosp').addEventListener('click', () => requestRouteService(true, 'hospital'));

async function requestRouteService(isEmergency, emergencyType = '') {
    const originStr = document.getElementById('origin-input').value;
    const destStr = document.getElementById('destination-input').value;

    if (!originStr || (!destStr && !isEmergency)) {
        return alert("Establece coordenadas de origen y destino válidas.");
    }

    const originCoords = originStr.split(',').map(Number);
    // Tomar los valores *actuales* del slider
    const betaValue = parseFloat(slider.value);
    const alphaValue = parseFloat((1 - betaValue).toFixed(1));
    const mode = document.getElementById('algo-mode').value;
    const renderType = document.getElementById('render-type').value;

    let targetEndpoint = `${BASE_URL}/calculate-routes`;
    let payload = {
        origen: originCoords,
        destino: destStr ? destStr.split(',').map(Number) : [0, 0],
        alpha: alphaValue,
        beta: betaValue,
        mode: mode
    };

    if (isEmergency) {
        targetEndpoint = `${BASE_URL}/emergency-route`;
        payload = {
            origen: originCoords,
            tipo_emergencia: emergencyType,
            alpha: alphaValue,
            beta: betaValue,
            mode: mode
        };
    }

    try {
        clearMapPaths();

        // Si hay una animación vieja colgada por seguridad, la fulmina antes del nuevo fetch
        if (animationClock) { clearInterval(animationClock); animationClock = null; }

        const response = await fetch(targetEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.detail || "Error interno del algoritmo.");
        }

        const dataResult = await response.json();

        // Ajustar marcadores técnicos a los nodos reales devueltos por el grafo del Backend
        updateTechnicalMarker('origin', dataResult.origin);
        updateTechnicalMarker('destination', dataResult.destination);

        markerOrigen.bindPopup("<b>Inicio Seguro</b>").openPopup();
        const titleEnd = isEmergency ? `🚨 Emergencia: ${dataResult.emergency_info.name}` : "<b>Destino Final</b>";
        markerDestino.bindPopup(titleEnd);

        // Despachar modo de renderizado
        if (renderType === 'instant') {
            if (dataResult.a_star) drawStaticPolyline(dataResult.a_star.route, '#9333ea');
            if (dataResult.greedy) drawStaticPolyline(dataResult.greedy.route, '#059669');
            updateMetricsDashboard(dataResult);
        } else {
            executeDualSimultaneousAnimation(dataResult);
        }

        // Autoajustar encuadre de cámara
        const boundaryGroup = new L.featureGroup([markerOrigen, markerDestino]);
        map.fitBounds(boundaryGroup.getBounds().pad(0.2));

    } catch (err) {
        alert(`Error en procesamiento: ${err.message}`);
        document.getElementById('btn-clear').click(); // Destraba la UI si la API falla
    }
}

function drawStaticPolyline(coordinates, strokeColor) {
    const polyline = L.polyline(coordinates, {color: strokeColor, weight: 6, opacity: 0.9}).addTo(map);
    pathLayers.push(polyline);
}

// --- 7. CÓMPUTO MÉTRICO DE DISTANCIA GEODÉSICA REAL ---
function calculateTrueGeodeticDistance(coordinatesList) {
    let currentTotalMeters = 0;
    for (let i = 0; i < coordinatesList.length - 1; i++) {
        const pointA = L.latLng(coordinatesList[i][0], coordinatesList[i][1]);
        const pointB = L.latLng(coordinatesList[i+1][0], coordinatesList[i+1][1]);
        currentTotalMeters += pointA.distanceTo(pointB);
    }
    return currentTotalMeters >= 1000
        ? `${(currentTotalMeters / 1000).toFixed(2)} km`
        : `${Math.round(currentTotalMeters)} metros`;
}

// --- 8. DINÁMICA DE ANIMACIONES SIMULTÁNEAS (SINCRONIZACIÓN PERFECTA) ---
function executeDualSimultaneousAnimation(resultPayload) {
    const aStarHistory = resultPayload.a_star ? resultPayload.a_star.history_visited : [];
    const greedyHistory = resultPayload.greedy ? resultPayload.greedy.history_visited : [];

    // CONFIGURACIÓN DE SINCRONIZACIÓN
    const totalFrames = 60; // Cantidad de pasos totales de la animación (ajusta si la quieres más rápida o lenta)
    let currentFrame = 0;
    const frameIntervalTime = 20; // Milisegundos por cuadro

    const aStarExplorationLayer = L.featureGroup().addTo(map);
    const greedyExplorationLayer = L.featureGroup().addTo(map);
    pathLayers.push(aStarExplorationLayer, greedyExplorationLayer);

    // GREEDY: Mismo grosor que A* (weight: 1.5)
    let animatingGreedyPath = null;
    if (resultPayload.greedy) {
        animatingGreedyPath = L.polyline([], {
            color: '#34d399',
            weight: 1.5,
            opacity: 0.95,
            zIndexOffset: 1000
        }).addTo(greedyExplorationLayer);
    }

    animationClock = setInterval(() => {
        currentFrame++;

        // ANIMACIÓN A*: Dibuja la porción correspondiente a este frame
        if (resultPayload.a_star) {
            let startIdx = Math.floor(((currentFrame - 1) / totalFrames) * aStarHistory.length);
            let endIdx = Math.floor((currentFrame / totalFrames) * aStarHistory.length);

            for (let i = startIdx; i < endIdx && i < aStarHistory.length; i++) {
                let segment = aStarHistory[i];
                L.polyline(segment, {color: '#c084fc', weight: 1.5, opacity: 0.4}).addTo(aStarExplorationLayer);
            }
        }

        // ANIMACIÓN GREEDY: Dibuja la porción correspondiente a este frame
        if (resultPayload.greedy) {
            let startIdx = Math.floor(((currentFrame - 1) / totalFrames) * greedyHistory.length);
            let endIdx = Math.floor((currentFrame / totalFrames) * greedyHistory.length);

            for (let i = startIdx; i < endIdx && i < greedyHistory.length; i++) {
                let segment = greedyHistory[i];
                if (animatingGreedyPath.getLatLngs().length === 0) {
                    animatingGreedyPath.setLatLngs([segment[0], segment[1]]);
                } else {
                    animatingGreedyPath.addLatLng(segment[1]);
                }
            }
            animatingGreedyPath.bringToFront();
        }

       // CONDICIÓN DE PARADA: Ambos terminan exactamente en el mismo frame
        if (currentFrame >= totalFrames) {
            clearInterval(animationClock);
            animationClock = null;

            // ==========================================
            // ¡MAGIA AQUÍ! Borramos el rastro de exploración
            // ==========================================
            map.removeLayer(aStarExplorationLayer);
            map.removeLayer(greedyExplorationLayer);

            // Dibujar las soluciones óptimas en trazado grueso final y limpio
            if (resultPayload.a_star) drawStaticPolyline(resultPayload.a_star.route, '#9333ea');
            if (resultPayload.greedy) drawStaticPolyline(resultPayload.greedy.route, '#059669');

            updateMetricsDashboard(resultPayload);
            console.log("[SafeRoute] Animación finalizada en empate técnico. Mapa limpio.");
        }
    }, frameIntervalTime);
}

// --- 9. ACTUALIZACIÓN DEL DASHBOARD DE MÉTRICAS ---
function updateMetricsDashboard(result) {
    if (result.a_star) {
        document.getElementById('ast-explored').innerText = result.a_star.explored_nodes;
        document.getElementById('ast-time').innerText = `${(result.a_star.execution_time * 1000).toFixed(2)} ms`;
        document.getElementById('ast-nodes').innerText = result.a_star.route.length;
        document.getElementById('ast-cost').innerText = result.a_star.cost.toFixed(2);
        document.getElementById('ast-dist').innerText = calculateTrueGeodeticDistance(result.a_star.route);
    } else {
        resetMetricBlock('metrics-astar');
    }

    if (result.greedy) {
        document.getElementById('gre-explored').innerText = result.greedy.explored_nodes;
        document.getElementById('gre-time').innerText = `${(result.greedy.execution_time * 1000).toFixed(2)} ms`;
        document.getElementById('gre-nodes').innerText = result.greedy.route.length;
        document.getElementById('gre-cost').innerText = result.greedy.cost.toFixed(2);
        document.getElementById('gre-dist').innerText = calculateTrueGeodeticDistance(result.greedy.route);
    } else {
        resetMetricBlock('metrics-greedy');
    }
}

function resetMetricBlock(elementId) {
    const component = document.getElementById(elementId);
    if(component) {
        component.querySelectorAll('strong').forEach(node => node.innerText = '-');
    }
}
// --- 10. BOTÓN PARA OCULTAR/MOSTRAR PANEL DE MÉTRICAS ---
document.getElementById('btn-toggle-metrics').addEventListener('click', () => {
    const container = document.querySelector('.app-container');

    // Agrega o quita la clase que colapsa el panel en el CSS
    container.classList.toggle('metrics-hidden');

    // Truco CRÍTICO: Esperamos un milisegundo a que el CSS termine la transición
    // y le decimos a Leaflet que redibuje el mapa para ocupar el nuevo espacio
    setTimeout(() => {
        map.invalidateSize();
    }, 50);
});