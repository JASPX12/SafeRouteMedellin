import os
import pandas as pd
from scipy.spatial import KDTree


class EmergencyLocator:
    def __init__(self):
        # Guardaremos los datos y los árboles espaciales por separado
        self.cai_tree = None
        self.cai_data = []

        self.hospital_tree = None
        self.hospital_data = []

        self._load_data()

    def _load_data(self):
        # Rutas relativas hacia la carpeta Data
        base_dir = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.join(base_dir, "..", "Data")

        # ==========================================
        # 1. CARGAR CAIs Y ESTACIONES DE POLICÍA
        # ==========================================
        cai_path = os.path.join(data_dir, "cai_valle_aburra_con_coordenadas.csv")
        if os.path.exists(cai_path):
            df_cai = pd.read_csv(cai_path)
            # Limpiar filas que no tengan coordenadas
            df_cai = df_cai.dropna(subset=['latitud', 'longitud'])

            cai_coords = []
            for _, row in df_cai.iterrows():
                # KDTree usa (longitud, latitud) para mantener consistencia con tu API
                cai_coords.append((row['longitud'], row['latitud']))
                self.cai_data.append({
                    "name": row.get('cai', 'CAI Sin Nombre'),
                    "address": row.get('direccion', 'Dirección no disponible'),
                    "lat": row['latitud'],
                    "lon": row['longitud']
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

            # Filtramos para que solo arme el árbol con centros médicos
            df_hosp = df_hosp[df_hosp['tipo'].isin(['hospital', 'clinica'])]

            hosp_coords = []
            for _, row in df_hosp.iterrows():
                hosp_coords.append((row['longitud'], row['latitud']))
                self.hospital_data.append({
                    "name": row.get('nombre', 'Centro Médico Sin Nombre'),
                    "type": row['tipo'],
                    "lat": row['latitud'],
                    "lon": row['longitud']
                })

            if hosp_coords:
                self.hospital_tree = KDTree(hosp_coords)
                print(f"[EmergencyLocator] {len(hosp_coords)} Hospitales/Clínicas indexados.")

    def get_nearest_cai(self, lon, lat):
        """Devuelve el CAI más cercano a las coordenadas dadas."""
        if not self.cai_tree:
            return None
        # distance: qué tan lejos está en línea recta
        # index: en qué posición de la lista self.cai_data está guardado
        distance, index = self.cai_tree.query((lon, lat))
        return self.cai_data[index]

    def get_nearest_hospital(self, lon, lat):
        """Devuelve el Hospital más cercano a las coordenadas dadas."""
        if not self.hospital_tree:
            return None
        distance, index = self.hospital_tree.query((lon, lat))
        return self.hospital_data[index]