import heapq
from utils.math_utils import heuristic_haversine


def algorithm_a_star(graph, origin, destination, alpha, beta):
    if origin not in graph or destination not in graph:
        return None, float('inf'), 0, []

    graph_attributes = getattr(graph, 'graph', {})
    max_city_distance = graph_attributes.get('max_city_distance', 1.0)

    priority_queue = []
    g_score = {nodo: float('inf') for nodo in graph.nodes}
    g_score[origin] = 0

    f_score = {nodo: float('inf') for nodo in graph.nodes}
    f_score[origin] = heuristic_haversine(origin, destination, alpha, max_city_distance)

    heapq.heappush(priority_queue, (f_score[origin], origin))
    previous_path = {}
    explored_nodes = 0
    closed_set = set()
    history_visited = []

    while priority_queue:
        current_f, current_node = heapq.heappop(priority_queue)

        if current_node in closed_set:
            continue

        closed_set.add(current_node)

        parent_node = previous_path.get(current_node, current_node)
        history_visited.append((parent_node, current_node))

        explored_nodes += 1

        if current_node == destination:
            route = []
            total_cost = g_score[destination]
            current = destination
            while current in previous_path:
                route.append(current)
                current = previous_path[current]
            route.append(origin)
            route.reverse()
            return route, total_cost, explored_nodes, history_visited

        for neighbor in graph.neighbors(current_node):
            if neighbor in closed_set:
                continue

            edge_data = graph.get_edge_data(current_node, neighbor)

            normalized_length = edge_data['normalized_length']

            # --- FÓRMULA DE RIESGO DINÁMICO ---
            base_risk = edge_data['harassmentRisk']
            cameras = edge_data.get('cameras_count', 0)
            incidents = edge_data.get('incidents_count', 0)

            dynamic_risk = base_risk + (0.05 * incidents) - (0.2 * cameras)
            dynamic_risk = max(0.0, min(1.0, dynamic_risk))  # Limitar entre 0 y 1
            # ----------------------------------

            edge_cost = (alpha * normalized_length) + (beta * dynamic_risk)
            tentative_g_score = g_score[current_node] + edge_cost

            if tentative_g_score < g_score[neighbor]:
                previous_path[neighbor] = current_node
                g_score[neighbor] = tentative_g_score
                f_score[neighbor] = tentative_g_score + heuristic_haversine(neighbor, destination, alpha,
                                                                            max_city_distance)
                heapq.heappush(priority_queue, (f_score[neighbor], neighbor))

    return None, float('inf'), explored_nodes, history_visited