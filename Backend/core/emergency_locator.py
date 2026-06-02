import os
import math
import pandas as pd
from scipy.spatial import KDTree


def _kdtree_distance_to_meters(kdtree_distance: float) -> float:
    """
    Convierte la distancia euclidiana en grados (resultado del KDTree)
    a metros usando una aproximación lineal válida para zonas urbanas.
    1 grado ≈ 111_320 metros en la latitud de Medellín.
    """
    return round(kdtree_distance * 111_320, 0)


class EmergencyLocator:
    def __init__(self):
        # Guardaremos los datos y los árboles espaciales por separado
        self.cai_tree = None
        self.cai_data = []

        self.hospital_tree = None
        self.hospital_data = []

        self._load_data()

    def _load_data(self):
        # Usamos la misma lógica infalible de main.py
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data_dir = os.path.join(base_dir, "Data")

        # ==========================================
        # 1. CARGAR CAIs Y ESTACIONES DE POLICÍA
        # ==========================================
        cai_path = os.path.join(data_dir, "cai_valle_aburra_con_coordenadas.csv")
        if os.path.exists(cai_path):
            df_cai = pd.read_csv(cai_path)
            df_cai = df_cai.dropna(subset=['latitud', 'longitud'])

            cai_coords = []
            for _, row in df_cai.iterrows():
                cai_coords.append((float(row['longitud']), float(row['latitud'])))
                self.cai_data.append({
                    "name": str(row.get('nombre', 'CAI Sin Nombre')),
                    "type": str(row.get('tipo', 'CAI')),
                    "address": str(row.get('direccion', 'Dirección no disponible')),
                    "phone": str(row.get('telefono', 'No disponible')),
                    "lat": float(row['latitud']),
                    "lon": float(row['longitud']),
                })

            if cai_coords:
                self.cai_tree = KDTree(cai_coords)
                print(f"[EmergencyLocator] {len(cai_coords)} CAIs indexados.")

        # ==========================================
        # 2. CARGAR HOSPITALES Y CLÍNICAS
        # ==========================================
        hosp_path = os.path.join(data_dir, "servicios_emergencia_valle_aburra.csv")
        if os.path.exists(hosp_path):
            df_hosp = pd.read_csv(hosp_path)
            df_hosp = df_hosp.dropna(subset=['latitud', 'longitud'])
            df_hosp = df_hosp[df_hosp['tipo'].isin(['hospital', 'clinica'])]

            hosp_coords = []
            for _, row in df_hosp.iterrows():
                # Forzamos los tipos nativos float() y str()
                hosp_coords.append((float(row['longitud']), float(row['latitud'])))
                self.hospital_data.append({
                    "name": str(row.get('nombre', '') or 'Centro Médico Sin Nombre'),
                    "type": str(row.get('tipo', 'hospital')),
                    "address": str(row.get('ciudad', '') or 'Medellín y Área Metropolitana'),
                    "phone": str(row.get('telefono', '') or 'No disponible'),
                    "lat": float(row['latitud']),
                    "lon": float(row['longitud']),
                })

            if hosp_coords:
                self.hospital_tree = KDTree(hosp_coords)
                print(f"[EmergencyLocator] {len(hosp_coords)} Hospitales/Clínicas indexados.")

    def _with_distance(self, record: dict, kdtree_distance: float) -> dict:
        result = dict(record)
        meters = _kdtree_distance_to_meters(kdtree_distance)
        result["distance_m"] = meters
        result["distance"] = f"{meters:,.0f} m".replace(",", ".")
        return result

    def get_nearest_cai(self, lon, lat):
        """Devuelve el CAI más cercano a las coordenadas dadas."""
        if not self.cai_tree:
            return None
        distance, index = self.cai_tree.query((lon, lat))
        return self._with_distance(self.cai_data[index], distance)

    def get_nearest_hospital(self, lon, lat):
        """Devuelve el Hospital más cercano a las coordenadas dadas."""
        if not self.hospital_tree:
            return None
        distance, index = self.hospital_tree.query((lon, lat))
        return self._with_distance(self.hospital_data[index], distance)