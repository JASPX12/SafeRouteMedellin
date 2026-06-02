// Configuración del endpoint de FastAPI (dinámico para producción o local)
const BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:'
    ? 'http://127.0.0.1:8000/api'
    : 'https://saferoutemedellin-production-e0d2.up.railway.app';


// --- SNAP AL NODO MÁS CERCANO DEL GRAFO ---
// Convierte cualquier coordenada libre a la intersección vial más próxima.
// Esto evita errores de enrutamiento cuando el usuario hace clic en
// un punto que no está exactamente sobre una calle del grafo.
async function snapToGraph(lat, lon) {
    try {
        const response = await fetch(`${BASE_URL}/nearest-node?lat=${lat}&lon=${lon}`);
        if (!response.ok) throw new Error('Snap falló');
        const data = await response.json();
        return { lat: data.lat, lon: data.lon };
    } catch (err) {
        // Si el backend no responde, devolver las coordenadas originales sin bloquear al usuario
        console.warn('[SafeRoute] Snap al grafo falló, usando coordenadas originales:', err.message);
        return { lat, lon };
    }
}


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

// Reloj global para detener animaciones simultáneamente
let animationClock = null;

// --- SLIDERS ALPHA / BETA Y PRESETS DE RUTA ---
const alphaSlider = document.getElementById('alpha-slider');
const betaSlider = document.getElementById('beta-slider');
const alphaLabel = document.getElementById('alpha-val');
const betaLabel = document.getElementById('beta-val');
const routePresetButtons = document.querySelectorAll('.btn-route-preset');

const ROUTE_PRESETS = {
    safe: { alpha: 0.1, beta: 0.9 },
    fast: { alpha: 0.9, beta: 0.1 },
    balance: { alpha: 0.5, beta: 0.5 },
};

const ALPHA_BETA_MIN = 0.1;
const ALPHA_BETA_MAX = 0.9;

let activeRoutePreset = 'balance';

function updateAlphaBetaLabels() {
    if (alphaLabel) alphaLabel.innerText = `Alpha: ${parseFloat(alphaSlider.value).toFixed(1)}`;
    if (betaLabel) betaLabel.innerText = `Beta: ${parseFloat(betaSlider.value).toFixed(1)}`;
}

function setRoutePreset(presetName, updateSliders = true) {
    activeRoutePreset = presetName;
    routePresetButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === presetName);
    });

    if (updateSliders && ROUTE_PRESETS[presetName]) {
        alphaSlider.value = ROUTE_PRESETS[presetName].alpha;
        betaSlider.value = ROUTE_PRESETS[presetName].beta;
        updateAlphaBetaLabels();
    }
}

function getAlphaBetaValues() {
    const alpha = Math.min(ALPHA_BETA_MAX, Math.max(ALPHA_BETA_MIN, parseFloat(alphaSlider.value)));
    const beta = Math.min(ALPHA_BETA_MAX, Math.max(ALPHA_BETA_MIN, parseFloat(betaSlider.value)));
    return { alpha, beta };
}

alphaSlider?.addEventListener('input', () => {
    updateAlphaBetaLabels();
    setRoutePreset('custom', false);
});

betaSlider?.addEventListener('input', () => {
    updateAlphaBetaLabels();
    setRoutePreset('custom', false);
});

routePresetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        if (preset === 'custom') {
            setRoutePreset('custom', false);
        } else {
            setRoutePreset(preset, true);
        }
    });
});

// --- SLIDER DE VELOCIDAD DE ANIMACIÓN ---
const animSpeedSlider = document.getElementById('anim-speed-slider');
const animSpeedLabel = document.getElementById('anim-speed-label');

const SPEED_LABELS = {
    1: 'Ultra Lenta',
    2: 'Muy Lenta',
    3: 'Lenta',
    4: 'Moderada',
    5: 'Normal',
    6: 'Rápida',
    7: 'Muy Rápida',
    8: 'Turbo 🚀',
};

function getAnimFrameInterval() {
    const speed = parseInt(animSpeedSlider ? animSpeedSlider.value : 5, 10);
    const intervals = { 1: 250, 2: 180, 3: 120, 4: 80, 5: 40, 6: 20, 7: 10, 8: 5 };
    return intervals[speed] || 40;
}

animSpeedSlider?.addEventListener('input', (e) => {
    const speed = parseInt(e.target.value, 10);
    if (animSpeedLabel) animSpeedLabel.innerText = `Velocidad: ${SPEED_LABELS[speed]}`;
});

function clearRouteVisualization() {
    if (animationClock) {
        clearInterval(animationClock);
        animationClock = null;
    }
    clearMapPaths();
    resetMetricBlock('metrics-astar');
    resetMetricBlock('metrics-greedy');
    hideEmergencyInfoPanel();
}

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

// --- INTERRUPTOR DE DISEÑO: MODO CLARO / OSCURO ---
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

// --- SISTEMA DE COORDENADAS INTERACTIVO ---
document.getElementById('btn-pick-origin').addEventListener('click', () => setActivePick('origin'));
document.getElementById('btn-pick-destination').addEventListener('click', () => setActivePick('destination'));

function setActivePick(mode) {
    activePickMode = mode;
    document.getElementById('map').style.cursor = 'crosshair';
    // Resetear visualmente botones
    document.getElementById('btn-pick-origin').classList.remove('active');
    document.getElementById('btn-pick-destination').classList.remove('active');
    document.getElementById(`btn-pick-${mode}`).classList.add('active');
}

// Clic en el mapa para capturar coordenadas con snap al grafo
map.on('click', async (e) => {
    if (!activePickMode) return;

    clearRouteVisualization();
    document.getElementById('map').style.cursor = 'wait';

    const rawLat = e.latlng.lat;
    const rawLon = e.latlng.lng;

    const snapped = await snapToGraph(rawLat, rawLon);

    const lat = snapped.lat.toFixed(6);
    const lon = snapped.lon.toFixed(6);
    document.getElementById(`${activePickMode}-input`).value = `${lat},${lon}`;

    // Actualización estricta para borrar el anterior inmediatamente
    updateTechnicalMarker(activePickMode, [snapped.lat, snapped.lon]);

    document.getElementById(`btn-pick-${activePickMode}`).classList.remove('active');
    document.getElementById('map').style.cursor = '';
    activePickMode = null;
});

async function handleBarrioSelection(e, inputId, type) {
    if (!e.target.value) return;

    clearRouteVisualization();
    const rawCoords = e.target.value.split(',').map(Number);
    const snapped = await snapToGraph(rawCoords[0], rawCoords[1]);

    const coordsStr = `${snapped.lat.toFixed(6)},${snapped.lon.toFixed(6)}`;
    document.getElementById(inputId).value = coordsStr;

    // Actualización estricta del marcador circular
    updateTechnicalMarker(type, [snapped.lat, snapped.lon]);

    // Desplazar cámara
    map.setView([snapped.lat, snapped.lon], 14);
}

document.getElementById('select-barrio-origin').addEventListener('change', (e) => handleBarrioSelection(e, 'origin-input', 'origin'));
document.getElementById('select-barrio-destination').addEventListener('change', (e) => handleBarrioSelection(e, 'destination-input', 'destination'));

function getDeviceGPS(inputId, type) {
    if (!navigator.geolocation) return alert("Tu dispositivo no soporta geolocalización.");

    clearRouteVisualization();

    navigator.geolocation.getCurrentPosition(async position => {
        const rawLat = position.coords.latitude;
        const rawLon = position.coords.longitude;

        const snapped = await snapToGraph(rawLat, rawLon);

        const lat = snapped.lat.toFixed(6);
        const lon = snapped.lon.toFixed(6);
        document.getElementById(inputId).value = `${lat},${lon}`;

        updateTechnicalMarker(type, [snapped.lat, snapped.lon]);
        map.setView([snapped.lat, snapped.lon], 15);
    }, () => alert("No se pudo acceder a la ubicación."));
}

document.getElementById('btn-gps-origin').addEventListener('click', () => getDeviceGPS('origin-input', 'origin'));
document.getElementById('btn-gps-destination').addEventListener('click', () => getDeviceGPS('destination-input', 'destination'));

['origin-input', 'destination-input'].forEach(inputId => {
    document.getElementById(inputId)?.addEventListener('input', clearRouteVisualization);
});

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

// --- MAPA DE CALOR ULTRA-SUAVIZADO ---
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

    document.getElementById('origin-input').value = '';
    document.getElementById('destination-input').value = '';
    document.getElementById('select-barrio-origin').value = '';
    document.getElementById('select-barrio-destination').value = '';

    if (activePickMode) {
        document.getElementById(`btn-pick-${activePickMode}`).classList.remove('active');
        activePickMode = null;
    }
    document.getElementById('map').style.cursor = '';

    // Resetear visualizadores métricos
    resetMetricBlock('metrics-astar');
    resetMetricBlock('metrics-greedy');
    hideEmergencyInfoPanel();
});

function clearMapPaths() {
    pathLayers.forEach(layer => map.removeLayer(layer));
    pathLayers = [];
}

// --- 6. GESTIÓN DE PETICIONES AL BACKEND ---
document.getElementById('btn-calculate').addEventListener('click', () => requestRouteService(false));
document.getElementById('btn-emergency-cai').addEventListener('click', () => requestRouteService(true, 'cai'));
document.getElementById('btn-emergency-hosp').addEventListener('click', () => requestRouteService(true, 'hospital'));

function formatEmergencyType(type) {
    const labels = {
        cai: 'CAI / Policía',
        CAI: 'CAI / Policía',
        hospital: 'Hospital',
        clinica: 'Clínica',
    };
    return labels[type] || type;
}

function buildEmergencyPopupContent(info) {
    return `
        <div class="emergency-popup">
            <b>🚨 ${info.name}</b><br>
            <b>Tipo:</b> ${formatEmergencyType(info.type)}<br>
            <b>Dirección:</b> ${info.address}<br>
            <b>Teléfono:</b> ${info.phone}<br>
            <b>Distancia:</b> ${info.distance}
        </div>
    `;
}

function showEmergencyInfoPanel(info) {
    const panel = document.getElementById('emergency-info-panel');
    if (!panel || !info) return;

    document.getElementById('emergency-info-name').innerText = info.name || '-';
    document.getElementById('emergency-info-type').innerText = formatEmergencyType(info.type);
    document.getElementById('emergency-info-address').innerText = info.address || '-';
    document.getElementById('emergency-info-phone').innerText = info.phone || '-';
    document.getElementById('emergency-info-distance').innerText = info.distance || '-';
    panel.hidden = false;
}

function hideEmergencyInfoPanel() {
    const panel = document.getElementById('emergency-info-panel');
    if (panel) panel.hidden = true;
}

async function requestRouteService(isEmergency, emergencyType = '') {
    const originStr = document.getElementById('origin-input').value;
    const destStr = document.getElementById('destination-input').value;

    if (!originStr || (!destStr && !isEmergency)) {
        return alert("Establece coordenadas de origen y destino válidas.");
    }

    const originCoords = originStr.split(',').map(Number);
    const { alpha: alphaValue, beta: betaValue } = getAlphaBetaValues();
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

        if (isEmergency && dataResult.emergency_info) {
            const info = dataResult.emergency_info;
            markerDestino.bindPopup(buildEmergencyPopupContent(info)).openPopup();
            showEmergencyInfoPanel(info);
        } else {
            hideEmergencyInfoPanel();
            markerDestino.bindPopup("<b>Destino Final</b>");
        }

        // Despachar modo de renderizado
        if (renderType === 'instant') {
            if (dataResult.a_star) drawStaticPolyline(dataResult.a_star.route, '#9333ea');
            if (dataResult.greedy) drawStaticPolyline(dataResult.greedy.route, '#34d399');
            updateMetricsDashboard(dataResult);
        } else {
            executeDualSimultaneousAnimation(dataResult);
        }

        // Autoajustar encuadre de cámara
        const boundaryGroup = new L.featureGroup([markerOrigen, markerDestino]);
        map.fitBounds(boundaryGroup.getBounds().pad(0.2));

    } catch (err) {
        alert(`Error en procesamiento: ${err.message}`);
        clearRouteVisualization();
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

    const totalFrames = 60;
    let currentFrame = 0;
    const frameIntervalTime = getAnimFrameInterval();

    const aStarExplorationLayer = L.featureGroup().addTo(map);
    const greedyExplorationLayer = L.featureGroup().addTo(map);
    pathLayers.push(aStarExplorationLayer, greedyExplorationLayer);

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

        // A*: muchos segmentos → nube morada (no usar trazo acumulado)
        if (resultPayload.a_star) {
            let startIdx = Math.floor(((currentFrame - 1) / totalFrames) * aStarHistory.length);
            let endIdx = Math.floor((currentFrame / totalFrames) * aStarHistory.length);

            for (let i = startIdx; i < endIdx && i < aStarHistory.length; i++) {
                const segment = aStarHistory[i];
                L.polyline(segment, {color: '#c084fc', weight: 1.5, opacity: 0.4}).addTo(aStarExplorationLayer);
            }
        }

        // Greedy: historial más corto → trazo verde acumulado
        if (resultPayload.greedy && animatingGreedyPath) {
            let startIdx = Math.floor(((currentFrame - 1) / totalFrames) * greedyHistory.length);
            let endIdx = Math.floor((currentFrame / totalFrames) * greedyHistory.length);

            for (let i = startIdx; i < endIdx && i < greedyHistory.length; i++) {
                const segment = greedyHistory[i];
                if (animatingGreedyPath.getLatLngs().length === 0) {
                    animatingGreedyPath.setLatLngs([segment[0], segment[1]]);
                } else {
                    animatingGreedyPath.addLatLng(segment[1]);
                }
            }
            animatingGreedyPath.bringToFront();
        }

        if (currentFrame >= totalFrames) {
            clearInterval(animationClock);
            animationClock = null;

            map.removeLayer(aStarExplorationLayer);
            map.removeLayer(greedyExplorationLayer);

            if (resultPayload.a_star) drawStaticPolyline(resultPayload.a_star.route, '#9333ea');
            if (resultPayload.greedy) drawStaticPolyline(resultPayload.greedy.route, '#34d399');

            updateMetricsDashboard(resultPayload);
            console.log("[SafeRoute] Animación finalizada. Mapa limpio.");
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

// --- 11. SISTEMA INTEGRADO DE ALERTA DE AUXILIO (BOTÓN DE PÁNICO Y MOCKUPS) ---

// Elementos de Entrada
const inputContactName = document.getElementById('contact-name');
const inputContactEmail = document.getElementById('contact-email');
const inputContactPhone = document.getElementById('contact-phone');

// Cargar valores previos desde localStorage al iniciar
if (inputContactName) inputContactName.value = localStorage.getItem('emergency_contact_name') || '';
if (inputContactEmail) inputContactEmail.value = localStorage.getItem('emergency_contact_email') || '';
if (inputContactPhone) inputContactPhone.value = localStorage.getItem('emergency_contact_phone') || '';

// Escuchadores para guardar cambios en localStorage automáticamente
inputContactName?.addEventListener('input', () => {
    localStorage.setItem('emergency_contact_name', inputContactName.value);
});
inputContactEmail?.addEventListener('input', () => {
    localStorage.setItem('emergency_contact_email', inputContactEmail.value);
});
inputContactPhone?.addEventListener('input', () => {
    localStorage.setItem('emergency_contact_phone', inputContactPhone.value);
});

// Elementos del disparador y cuenta regresiva
const btnPanicTrigger = document.getElementById('btn-panic-trigger');
const btnPanicFloating = document.getElementById('btn-panic-floating');
const countdownModal = document.getElementById('countdown-modal');
const countdownNumber = document.getElementById('countdown-number');
const btnCancelPanic = document.getElementById('btn-cancel-panic');

let panicTimer = null;
let countdownCount = 3;

const handlePanicClick = () => {
    const contactName = inputContactName.value.trim();
    const contactEmail = inputContactEmail.value.trim();
    const contactPhone = inputContactPhone.value.trim();

    // 1. Validar que la información de contacto esté completa
    if (!contactName || !contactEmail || !contactPhone) {
        return alert("⚠️ Datos Faltantes: Completa el nombre, correo y teléfono del contacto de emergencia antes de activar el Botón de Pánico.");
    }

    // 2. Validar que se haya establecido un punto de origen
    const originVal = document.getElementById('origin-input').value.trim();
    if (!originVal) {
        return alert("🚨 Ubicación Requerida: Para enviar la alerta de auxilio de forma correcta, primero debes seleccionar un Punto de Origen en el mapa interactivo (marcando un punto con el cursor o el GPS).");
    }

    // 3. Iniciar cuenta regresiva de 3 segundos para seguridad del usuario
    countdownCount = 3;
    countdownNumber.innerText = countdownCount;
    countdownModal.style.display = 'flex';

    panicTimer = setInterval(() => {
        countdownCount--;
        if (countdownCount > 0) {
            countdownNumber.innerText = countdownCount;
        } else {
            clearInterval(panicTimer);
            panicTimer = null;
            countdownModal.style.display = 'none';
            // Ejecutar el envío de alerta
            dispatchPanicAlert(originVal, contactName, contactEmail, contactPhone);
        }
    }, 1000);
};

btnPanicTrigger?.addEventListener('click', handlePanicClick);
btnPanicFloating?.addEventListener('click', handlePanicClick);


// Botón de Cancelar cuenta regresiva
btnCancelPanic?.addEventListener('click', () => {
    if (panicTimer) {
        clearInterval(panicTimer);
        panicTimer = null;
    }
    countdownModal.style.display = 'none';
    console.log("[SafeRoute] Alerta de auxilio cancelada de forma manual.");
});

// Enviar datos al Backend
async function dispatchPanicAlert(originCoordsStr, name, email, phone) {
    const coordsArr = originCoordsStr.split(',').map(Number);
    const payload = {
        latitud: coordsArr[0],
        longitud: coordsArr[1],
        contacto_nombre: name,
        contacto_email: email,
        contacto_telefono: phone,
        mensaje_personalizado: "¡Ayuda! Me encuentro en una situación de riesgo. Sigue mi ubicación de origen aquí:"
    };

    try {
        console.log("[SafeRoute] Despachando alerta al backend...");
        const response = await fetch(`${BASE_URL}/send-panic-alert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || "Error al procesar el servidor.");
        }

        const result = await response.json();
        console.log("[SafeRoute] Alerta despachada con éxito:", result);

        // Desplegar maqueta interactiva del SMS y Email generados
        showAlertResultModal(result, name, email, phone);

    } catch (err) {
        alert(`❌ Error al activar alerta de auxilio: ${err.message}`);
    }
}

// Elementos del modal de confirmación de alerta
const mockupModal = document.getElementById('mockup-modal');
const btnCloseMockup = document.getElementById('btn-close-mockup');
const mockupModalTitle = document.getElementById('mockup-modal-title');
const mockupStatusBanner = document.getElementById('mockup-status-banner');
const mockupSmsLabel = document.getElementById('mockup-sms-label');
const mockupEmailLabel = document.getElementById('mockup-email-label');
const mockupSmsText = document.getElementById('mockup-sms-text');
const mockupSmsTime = document.getElementById('mockup-sms-time');
const mockupEmailIframe = document.getElementById('mockup-email-iframe');

function getChannelLabel(channel, status, contactName, contactEmail, phone) {
    const sentLabels = {
        email: `Correo enviado a ${contactEmail}`,
        sms: `SMS enviado a ${contactName} (${phone})`,
    };
    const previewLabels = {
        email: `Vista previa del correo para ${contactEmail}`,
        sms: `Vista previa del SMS para ${contactName}`,
    };
    const failedLabels = {
        email: `No se pudo enviar el correo a ${contactEmail}`,
        sms: `No se pudo enviar el SMS a ${phone}`,
    };

    if (status === 'sent') return sentLabels[channel];
    if (status === 'failed') return failedLabels[channel];
    return previewLabels[channel];
}

function buildAlertStatusSummary(result) {
    const lines = [];

    if (result.email_status === 'sent') {
        lines.push('Correo electrónico enviado correctamente.');
    } else if (result.email_status === 'failed') {
        lines.push(`Error al enviar el correo: ${result.details?.email_error || 'desconocido'}`);
    }

    if (result.sms_status === 'sent') {
        lines.push('SMS enviado correctamente.');
    } else if (result.sms_status === 'failed') {
        lines.push(`Error al enviar SMS: ${result.details?.sms_error || 'desconocido'}`);
    } else if (result.sms_status === 'simulated') {
        lines.push('SMS no configurado (requiere credenciales de Twilio en el servidor).');
    }

    return lines.join(' ');
}

function showAlertResultModal(result, name, email, phone) {
    if (!mockupModal) return;

    const emailSent = result.email_status === 'sent';
    const smsSent = result.sms_status === 'sent';
    const hasFailure = result.email_status === 'failed' || result.sms_status === 'failed';

    if (mockupModalTitle) {
        if (hasFailure && !emailSent && !smsSent) {
            mockupModalTitle.innerText = '🚨 Alerta No Enviada';
        } else if (hasFailure) {
            mockupModalTitle.innerText = '🚨 Alerta Enviada Parcialmente';
        } else {
            mockupModalTitle.innerText = '🚨 Alerta de Pánico Enviada';
        }
    }

    if (mockupStatusBanner) {
        mockupStatusBanner.innerText = buildAlertStatusSummary(result);
        mockupStatusBanner.classList.remove('status-success', 'status-warning');
        if (emailSent || smsSent) {
            mockupStatusBanner.classList.add(hasFailure ? 'status-warning' : 'status-success');
        }
    }

    if (mockupSmsLabel) {
        mockupSmsLabel.textContent = getChannelLabel('sms', result.sms_status, name, email, phone);
    }
    if (mockupEmailLabel) {
        mockupEmailLabel.textContent = getChannelLabel('email', result.email_status, name, email, phone);
    }

    if (mockupSmsText) {
        const body = result.sms_body;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        mockupSmsText.innerHTML = body.replace(urlRegex, url => `<a href="${url}" target="_blank">${url}</a>`);
    }

    if (mockupSmsTime) {
        const d = new Date();
        mockupSmsTime.innerText = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    if (mockupEmailIframe) {
        const iframeDoc = mockupEmailIframe.contentDocument || mockupEmailIframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(result.email_body);
        iframeDoc.close();
    }

    mockupModal.style.display = 'flex';
}

// Escuchadores de cierre para el modal de maqueta
btnCloseMockup?.addEventListener('click', () => {
    mockupModal.style.display = 'none';
});

// Cerrar si se presiona fuera del recuadro
window.addEventListener('click', (e) => {
    if (e.target === mockupModal) {
        mockupModal.style.display = 'none';
    }
});

// --- 12. INICIALIZACIÓN: PRE-CARGAR ORIGEN Y DESTINO DESDE LOS SELECTS POR DEFECTO ---
(async function initDefaultPoints() {
    const originSelect = document.getElementById('select-barrio-origin');
    const destSelect = document.getElementById('select-barrio-destination');

    async function applyDefaultBarrio(select, inputId, type) {
        if (!select || !select.value) return;
        const rawCoords = select.value.split(',').map(Number);
        // Intentamos snap; si el backend no está listo aún, usamos las coords raw
        const snapped = await snapToGraph(rawCoords[0], rawCoords[1]);
        const coordsStr = `${snapped.lat.toFixed(6)},${snapped.lon.toFixed(6)}`;
        document.getElementById(inputId).value = coordsStr;
        updateTechnicalMarker(type, [snapped.lat, snapped.lon]);
    }

    await applyDefaultBarrio(originSelect, 'origin-input', 'origin');
    await applyDefaultBarrio(destSelect, 'destination-input', 'destination');

    // Centrar el mapa entre los dos puntos predeterminados
    const originVal = document.getElementById('origin-input').value;
    const destVal = document.getElementById('destination-input').value;
    if (originVal && destVal) {
        const o = originVal.split(',').map(Number);
        const d = destVal.split(',').map(Number);
        const centerLat = (o[0] + d[0]) / 2;
        const centerLon = (o[1] + d[1]) / 2;
        map.setView([centerLat, centerLon], 13);
    }

    console.log('[SafeRoute] Puntos predeterminados cargados y snapeados al grafo: El Poblado → Centro / Candelaria');
})();

