import os
import time
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("API_KEY")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Tuple  # <-- Agregamos Tuple

from models.graph import build_medellin_graph
from core.pathfinding_a_star_algorithm import algorithm_a_star
from core.pathfinding_greedy_algorithm import algorithm_greedy
from core.emergency_locator import EmergencyLocator

# Variables globales con Type Hinting para calmar a PyCharm
GRAPH: Any = None
NODES_LIST: List[Any] = []
DATA_TREE: Any = None
EMERGENCY_LOCATOR: Any = None


@asynccontextmanager
async def lifespan(_fastapi_app: FastAPI):  # <-- 'fastapi_app' para evitar el Shadowing
    global GRAPH, NODES_LIST, DATA_TREE, EMERGENCY_LOCATOR


    # Esto averigua automáticamente dónde está parado este archivo y busca la carpeta Data
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    csv_path = os.path.join(BASE_DIR, "Data", "unified_medellin_data.csv")

    print(f"[API] Cargando grafo para Medellín...")
    GRAPH = build_medellin_graph(csv_path)
    NODES_LIST = list(GRAPH.nodes)

    # Importación local de KDTree para asegurar que PyCharm reconozca el tipo
    from scipy.spatial import KDTree
    DATA_TREE = KDTree(NODES_LIST)
    print(f"[API] Grafo cargado exitosamente. {len(NODES_LIST)} nodos indexados.")

    print(f"[API] Iniciando Localizador de Emergencias...")
    EMERGENCY_LOCATOR = EmergencyLocator()

    yield
    print("[API] Servidor apagándose, liberando memoria...")


app = FastAPI(title="Medellin Safe Routing API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> Dict[str, Any]:
    """Raíz de la API: el mapa no vive aquí, solo los endpoints /api/*."""
    return {
        "app": "SafeRoute Medellín API",
        "status": "ok",
        "docs": "/docs",
        "mensaje": "Abre el frontend: Frontend/mapa.html (Live Server o http://127.0.0.1:5500/mapa.html)",
        "endpoints": [
            "/api/calculate-routes",
            "/api/emergency-route",
            "/api/heatmap",
            "/api/nearest-node",
            "/api/send-panic-alert",
        ],
    }


def find_nearest_node(lat: float, lon: float) -> Any:
    target = (lon, lat)
    _, index = DATA_TREE.query(target)
    return NODES_LIST[index]


@app.get("/api/nearest-node")
def get_nearest_node(lat: float, lon: float) -> Dict[str, float]:
    """
    Recibe unas coordenadas crudas (clic del usuario en el mapa)
    y devuelve la coordenada del nodo más cercano en el grafo vial.
    Esto evita errores de enrutamiento por puntos fuera de la red.
    """
    node = find_nearest_node(lat, lon)
    snapped_lon, snapped_lat = node[0], node[1]
    return {
        "lat": snapped_lat,
        "lon": snapped_lon
    }



# Definimos que el origen y destino son exactamente parejas de coordenadas [lat, lon]
class RouteRequest(BaseModel):
    origen: Tuple[float, float]
    destino: Tuple[float, float]
    alpha: float
    beta: float
    mode: str = "both"


class EmergencyRequest(BaseModel):
    origen: Tuple[float, float]
    tipo_emergencia: str  # "cai" o "hospital"
    alpha: float
    beta: float
    mode: str = "both"


class PanicAlertRequest(BaseModel):
    latitud: float
    longitud: float
    contacto_nombre: str
    contacto_email: str
    contacto_telefono: str
    mensaje_personalizado: str = None



@app.get("/api/heatmap")
def get_heatmap_data() -> List[List[float]]:
    heatmap_points = []
    # Aseguramos que PyCharm entienda que GRAPH no es None antes de iterar
    if GRAPH is not None:
        for u, v, data in GRAPH.edges(data=True):
            lon, lat = u
            risk = data.get('harassmentRisk', 0.0)
            heatmap_points.append([lat, lon, risk])
    return heatmap_points


@app.post("/api/calculate-routes")
def calculate_routes(request: RouteRequest) -> Dict[str, Any]:
    start_lat, start_lon = request.origen[0], request.origen[1]
    end_lat, end_lon = request.destino[0], request.destino[1]

    origin_node = find_nearest_node(start_lat, start_lon)
    destination_node = find_nearest_node(end_lat, end_lon)

    mode = request.mode

    # Dict[str, Any] le dice a PyCharm que el diccionario mutará libremente
    response_data: Dict[str, Any] = {
        "origin": [origin_node[1], origin_node[0]],
        "destination": [destination_node[1], destination_node[0]],
        "a_star": None,
        "greedy": None
    }

    errors = []

    if mode in ["astar", "both"]:
        start_time_ast = time.time()
        a_star_path, a_star_cost, a_star_explored, a_star_history = algorithm_a_star(
            GRAPH, origin_node, destination_node, request.alpha, request.beta
        )
        ast_time = time.time() - start_time_ast

        if a_star_path:
            response_data["a_star"] = {
                "route": [[n[1], n[0]] for n in a_star_path],
                "history_visited": [[[padre[1], padre[0]], [hijo[1], hijo[0]]] for padre, hijo in a_star_history],
                "cost": a_star_cost,
                "explored_nodes": a_star_explored,
                "execution_time": ast_time
            }
        else:
            errors.append("A* no encontró ruta viable.")

    if mode in ["greedy", "both"]:
        start_time_gre = time.time()
        greedy_path, greedy_cost, greedy_history = algorithm_greedy(
            GRAPH, origin_node, destination_node, request.alpha, request.beta
        )
        gre_time = time.time() - start_time_gre

        if greedy_path:
            response_data["greedy"] = {
                "route": [[n[1], n[0]] for n in greedy_path],
                "history_visited": [[[padre[1], padre[0]], [hijo[1], hijo[0]]] for padre, hijo in greedy_history],
                "cost": greedy_cost,
                "explored_nodes": len(greedy_history),
                "execution_time": gre_time
            }
        else:
            errors.append("Greedy no encontró ruta viable.")

    if not response_data["a_star"] and not response_data["greedy"]:
        detail = " ".join(errors) if errors else "No se encontró ninguna ruta viable."
        raise HTTPException(status_code=404, detail=detail)

    if errors and mode != "both":
        raise HTTPException(status_code=404, detail=errors[0])

    return response_data


@app.post("/api/emergency-route")
def calculate_emergency_route(request: EmergencyRequest) -> Dict[str, Any]:
    start_lat, start_lon = request.origen[0], request.origen[1]

    if request.tipo_emergencia == "cai":
        nearest_emergency = EMERGENCY_LOCATOR.get_nearest_cai(start_lon, start_lat)
    elif request.tipo_emergencia == "hospital":
        nearest_emergency = EMERGENCY_LOCATOR.get_nearest_hospital(start_lon, start_lat)
    else:
        raise HTTPException(status_code=400, detail="Tipo de emergencia inválido. Usa 'cai' o 'hospital'.")

    if not nearest_emergency:
        raise HTTPException(status_code=500, detail="No se pudieron cargar los datos de emergencia.")

    origin_node = find_nearest_node(start_lat, start_lon)
    destination_node = find_nearest_node(nearest_emergency['lat'], nearest_emergency['lon'])

    route_request = RouteRequest(
        origen=(origin_node[1], origin_node[0]),
        destino=(destination_node[1], destination_node[0]),
        alpha=request.alpha,
        beta=request.beta,
        mode=request.mode
    )

    response_data = calculate_routes(route_request)
    response_data["emergency_info"] = nearest_emergency

    return response_data


@app.post("/api/send-panic-alert")
def send_panic_alert(request: PanicAlertRequest) -> Dict[str, Any]:
    from utils.notifier import send_emergency_alert
    
    result = send_emergency_alert(
        lat=request.latitud,
        lon=request.longitud,
        contact_name=request.contacto_nombre,
        contact_email=request.contacto_email,
        contact_phone=request.contacto_telefono,
        user_message=request.mensaje_personalizado
    )
    
    return result

