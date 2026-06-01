# 🗺️ SafeRouteMedellín: Enrutamiento Peatonal Inteligente y Seguro

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![HTML/JS](https://img.shields.io/badge/Frontend-HTML5_&_JS-F16529?style=for-the-badge&logo=html5&logoColor=white)]()

SafeRouteMedellín es una plataforma web geoespacial diseñada para proteger la integridad de los peatones en la ciudad de Medellín. A diferencia de las aplicaciones tradicionales que priorizan la ruta más corta o rápida, nuestro sistema integra **mapas de percepción de seguridad y criminalidad** para calcular trayectos que minimicen la exposición a riesgos urbanos (como hurto y acoso callejero).

---

## ✨ Características Principales

* **Enrutamiento Multi-Objetivo (A* y Greedy):** Algoritmos de búsqueda heurística que balancean distancia física y seguridad del entorno.
* **Controles Dinámicos (Alpha y Beta):** El usuario puede ajustar el peso de la seguridad (α) frente a la eficiencia/distancia (β) mediante un slider interactivo.
* **Mapas de Calor (Heatmaps):** Visualización en tiempo real de las zonas rojas y de mayor riesgo en la ciudad.
* **Botón de Pánico Inteligente:** Uso de estructuras de datos `KDTree` para localizar en milisegundos el CAI (Estación de Policía) o Centro Médico más cercano y trazar una ruta de escape.
* **UI/UX Adaptable:** Landing page profesional con soporte nativo para Modo Claro y Oscuro para discreción nocturna.

---

## 🛠️ Tecnologías Utilizadas

**Backend:**
* **Python 3.x**
* **FastAPI:** Para la creación de la API RESTful de alto rendimiento.
* **Pandas:** Procesamiento y limpieza de datos espaciales (CSV).
* **SciPy:** Estructuras de árboles multidimensionales (`KDTree`) para búsquedas de proximidad.
* **Uvicorn:** Servidor ASGI para despliegue.

**Frontend:**
* **HTML5, CSS3, Vanilla JavaScript**
* **Leaflet.js:** Para la renderización interactiva del mapa y las políneas.

---

## 📂 Estructura del Proyecto

```text
📦 SafeRouteMedellin
 ┣ 📂 Backend
 ┃ ┣ 📂 core
 ┃ ┃ ┣ 📜 routing_algorithms.py   # Lógica matemática de A* y Greedy
 ┃ ┃ ┗ 📜 emergency_locator.py    # KDTree para CAIs y Hospitales
 ┃ ┣ 📂 Data
 ┃ ┃ ┣ 📜 grafo_medellin.csv
 ┃ ┃ ┣ 📜 cai_valle_aburra_con_coordenadas.csv
 ┃ ┃ ┗ 📜 servicios_emergencia_valle_aburra.csv
 ┃ ┣ 📜 main.py                   # Puntos de entrada (Endpoints) de la API
 ┃ ┗ 📜 requirements.txt          # Dependencias de Python
 ┣ 📂 Frontend
 ┃ ┣ 📜 index.html                # Landing Page y Documentación
 ┃ ┣ 📜 mapa.html                 # Aplicación del Mapa Interactivo
 ┃ ┗ 📜 styles.css                # Estilos globales y Modo Oscuro
 ┗ 📜 README.md
```

---

## 🚀 Instalación y Despliegue Local

Sigue estos pasos para correr el proyecto en tu máquina local:

### 1. Clonar el repositorio
```bash
git clone [https://github.com/TU_USUARIO/SafeRouteMedellin.git]
cd SafeRouteMedellin
```

### 2. Configurar el Backend
Es recomendable crear un entorno virtual antes de instalar las dependencias:
```bash
cd Backend
python -m venv venv
source venv/bin/activate  # En Windows usa: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Ejecutar el Servidor FastAPI
```bash
uvicorn main:app --reload
```
La API estará corriendo en `http://localhost:8000`. Puedes ver la documentación automática de la API en `http://localhost:8000/docs`.

### 4. Lanzar el Frontend
Simplemente abre el archivo `Frontend/index.html` en tu navegador de preferencia (o usa una extensión como *Live Server* en VSCode).

---

## 🤝 Uso y Buenas Prácticas

1. **Configuración de variables:** Antes de trazar una ruta, ajusta los valores de seguridad según la hora del día. En trayectos nocturnos, se recomienda un valor alto de Alpha.
2. **Limpieza del Canvas:** Usa el botón de limpieza total antes de marcar un nuevo origen/destino para evitar saturación de memoria en el navegador.
3. **Manejo de Emergencias:** Haz clic en los botones de emergencia de la interfaz solo en caso de requerir una ruta rápida de asistencia; el sistema forzará un cálculo directo evadiendo obstáculos geográficos.

---

---

## 🌐 ¡Proyecto en Vivo! (Live Demo)

¿Quieres ver a **SafeRouteMedellín** en acción sin descargar nada? Entra a nuestra plataforma interactiva y calcula tu primera ruta segura haciendo clic en el enlace de abajo:

🚀 **[Visitar la Aplicación Web Oficial](https://TU_LINK_AQUI.vercel.app)**

> *💡 **Tip de uso:** Para una experiencia óptima en el Live Demo, activa el mapa de calor (Heatmap) y explora los ajustes de los algoritmos usando el panel de control lateral.*
*Desarrollado con ❤️ para mejorar la movilidad segura en Medellín.*