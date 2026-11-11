# FORGE AI STUDIO — GUÍA OFICIAL DE USUARIO

Bienvenido a **Forge AI Studio**, la suite profesional de creación, edición, texturizado PBR y sincronización bidireccional de modelos 3D para **Roblox Studio**.

---

## 1. GUÍA DE INICIO RÁPIDO

### ¿Qué es Forge AI Studio?
Forge AI Studio te permite:
- Generar modelos 3D listos para Roblox a partir de descripciones de texto o imágenes de referencia.
- Editar la geometría de cada pieza (`MeshPart`) con herramientas no destructivas de **EditableMesh**.
- Aplicar materiales realistas **SurfaceAppearance** con 4 canales PBR completos (Color, Normales, Rugosidad y Metalicidad).
- Transferir tus modelos directamente al Workspace de Roblox Studio mediante el **Puente Local (127.0.0.1:48720)** y **Rojo 7.x**.

### Requisitos previos
1. **Roblox Studio** instalado en tu PC Windows.
2. El archivo de plugin `ForgeAIStudioPlugin.server.luau` colocado en la carpeta de plugins locales de Roblox Studio.
3. El servicio **Forge Local Bridge** ejecutándose en tu PC en el puerto loopback `48720`:
   ```bash
   npm run bridge
   ```

---

## 2. MODOS DE INTERFAZ: SENCILLO VS. AVANZADO

Puedes alternar entre ambos modos con el selector en la esquina superior derecha del encabezado. Tu preferencia se guardará automáticamente en tu navegador.

### Modo Sencillo (Predeterminado)
- Diseñado para modeladores, constructores y desarrolladores principiantes.
- Vocabulario accesible en español llano (sin hashes criptográficos, comandos raw de terminal ni sockets internos expuestos).
- Controles numéricos y visuales claros: sliders, selectores de color, botones de 1 clic para enviar y recibir de Studio.
- Ayuda integrada con tooltips que explican cada término técnico.

### Modo Avanzado
- Diseñado para ingenieros técnicos de Roblox y desarrolladores de herramientas.
- Muestra el inspector de diagnósticos del Puente Local, hashes SHA-256 de integridad, métricas de red y el menú desplegable **Motores Dev**:
  * **Agentes IA (P0-P3)**: Orquestador y auditor de arquitectura.
  * **Luau Engine**: Generador y validador de scripts `--!strict` con tipado estático y patrón Maid.
  * **UI Engine**: Generador de interfaces de usuario 2D y 3D (SurfaceGui/ScreenGui).
  * **Rojo Bridge Guide**: Diagnóstico y manifiestos de sincronización de carpetas de disco.
  * **Contexto & Módulos**: Gestión de módulos compartidos de Roblox.
  * **Backend Explorer**: Inspección de endpoints y controladores FastAPI/Express.

---

## 3. LAS 5 ÁREAS DE LA APLICACIÓN

### A. INICIO (`home`)
- **Estado del Sistema**: Monitorea en vivo cuatro servicios vitales:
  * **Roblox Studio**: `Conectado` (cuando el plugin envía heartbeats) o `Esperando Plugin`.
  * **Puente Local**: `Activo` en `127.0.0.1:48720` o `En espera`.
  * **Rojo Server**: `Sincronizando` en el puerto `34872`.
  * **Backend API**: `Operativo` con indicador de latencia en milisegundos.
- **Acciones Rápidas**:
  * *Crear nuevo modelo con IA*: Inicia el asistente guiado paso a paso.
  * *Importar archivo 3D*: Carga directa de archivos `.rbxmx`, `.glb` o `.obj`.
  * *Roblox Studio & Puente*: Acceso directo al centro de sincronización.
- **Biblioteca de Modelos Recientes**: Muestra tarjetas con vistas previas, cantidad de piezas, polígonos reales y botones para abrir en el editor 3D o enviar a Studio con un clic.

### B. CREAR (`create`)
Flujo guiado en 5 pasos sencillos:
1. **Paso 1: Tipo de Objeto**: Selecciona entre *Arma / Utilería*, *Vehículo*, *Arquitectura*, *Sci-Fi / Gadgets* o *Terreno*.
2. **Paso 2: Método de Entrada**:
   - *Texto Descriptivo*: Escribe lo que imaginas o pulsa las etiquetas de sugerencia contextual.
   - *Imagen 2D*: Sube un boceto PNG/JPG y el motor generará el volumen 3D correlacionado.
   - *Relieve Procedural*: Ajusta la resolución y la profundidad de extrusión en studs.
   - *Archivo 3D*: Optimiza un modelo preexistente.
3. **Paso 3: Configuración**:
   - Nivel de detalle: *Bajo* (~1,800 tris - móviles), *Medio* (~3,800 tris - estándar), *Alto* (~8,500 tris) o *Ultra* (~14,000 tris).
   - Fidelidad de colisión: *Hull* (rápido y envolvente), *Box* (cubo mínimo) o *Precise* (colisión exacta).
   - Estilo de material inicial: Titanio, Fibra de carbono, Metal cepillado o Piedra.
4. **Paso 4: Generación en Tiempo Real**: Visualiza la etapa actual del procesamiento con posibilidad de cancelar la generación en cualquier momento.
5. **Paso 5: Resultado**: Vista 3D interactiva del modelo generado con acciones directas para abrir en el editor, personalizar materiales o enviar a Studio.

### C. EDITAR (`edit`)
- **Visor 3D Central**: Ocupa el 60% de la pantalla, con controles de órbita, zoom, desplazamiento y vistas de cámara predefinidas (Perspectiva, Frontal, Lateral, Superior y Reset).
- **Barra Lateral Izquierda (Jerarquía)**: Árbol visual de cada `MeshPart` con su nombre, identificador estable y forma básica.
- **Barra Lateral Derecha (Propiedades y Herramientas)**:
  - *Transformación*: Modifica Posición (X, Y, Z), Rotación (grados) y Tamaño (studs) con entradas numéricas limpias.
  - *Herramientas EditableMesh*:
    * **Subdividir superficie**: Divide triángulos para aumentar la suavidad.
    * **Diezmar / Optimizar**: Reduce polígonos manteniendo la silueta para eliminar lag.
    * **Suavizar normales**: Corrige la iluminación para evitar facetas duras.
    * **Alinear al suelo (Y=0)**: Coloca la base del modelo exactamente en el plano del suelo.
    * **Separar partes**: Descompone mallas complejas en piezas lógicas separadas.
    * **Auto-Reparar**: Detecta y soluciona caras degeneradas y vértices corruptos.
- **Historial No Destructivo**: Botones de Deshacer y Rehacer con recuento de pasos y detección automática de cambios pendientes mediante huella de contenido (hash).

### D. MATERIALES (`materials`)
- **Presets de Materiales**: Muestras táctiles de *Titanio Hexagonal*, *Fibra de Carbono*, *Metal Cepillado*, *Piedra Granito*, *Oro Pulido* y *Obsidiana*.
- **Color Base y Acento**: Selectores visuales para el color Albedo y el color Emisivo/Luminoso.
- **Propiedades Físicas**: Sliders de Rugosidad (*Roughness*) y Metalicidad (*Metalness*).
- **Inspección de 4 Canales PBR**: Visualiza individualmente:
  1. *ColorMap* (Albedo / color base).
  2. *NormalMap* (Relieve y micro-detalles sin sobrecargar geometría).
  3. *RoughnessMap* (Dispersión de brillo y reflejos difusos).
  4. *MetalnessMap* (Conductividad reflectiva metálica).
- **Distinción de Texturas**: Distingue claramente entre texturas guardadas localmente en disco y texturas publicadas en Roblox Cloud con AssetId verificado.
- **Botón Directo**: *Generar SurfaceAppearance para Roblox Studio*.

### E. ROBLOX STUDIO (`studio`)
- **Inspección de Selección en Vivo**: Consulta en tiempo real qué modelo o parte está seleccionada en el DataModel de Roblox Studio mediante `studio.get_selection`.
- **Acciones Principales**:
  - **Enviar a Roblox Studio (Push)**: Transfiere el modelo al Workspace de Studio.
  - **Traer de Roblox Studio (Pull)**: Importa el modelo seleccionado en Studio al editor web.
- **Estrategia de Resolución de Conflictos**:
  - *Fusión Inteligente*: Combina propiedades modificadas sin sobrescribir destructivamente.
  - *Conservar Forge AI Studio*: Prioriza los cambios realizados en el estudio web.
  - *Conservar Roblox Studio*: Prioriza las ediciones realizadas en Studio.
- **Confirmación de Seguridad**: Las operaciones que implican sobrescritura total muestran un modal de confirmación previa con resumen del impacto.
- **Historial de Sincronización**: Registro cronológico de tareas enviadas con marca de tiempo y estado verificado (*Completado*, *En espera de Studio* o *Error*).

---

## 4. SOLUCIÓN DE PROBLEMAS FRECUENTES

| Problema | Causa probable | Solución |
| :--- | :--- | :--- |
| **Roblox Studio aparece como "Esperando Plugin"** | El plugin no está activo en Studio o HTTP Requests está deshabilitado. | 1. En Roblox Studio, ve a **Game Settings > Security** y activa **Allow HTTP Requests**.<br>2. Verifica que el script `ForgeAIStudioPlugin.server.luau` esté activo. |
| **Puente Local aparece como "En espera"** | El proceso de Node.js no se ha iniciado en tu PC Windows. | Abre una terminal en tu proyecto y ejecuta `npm run bridge`. Debe indicar que está escuchando en `127.0.0.1:48720`. |
| **Aparece un aviso de "Cambios pendientes sin guardar"** | Modificaste una pieza y seleccionaste otro modelo antes de guardar. | Puedes pulsar **Guardar y abrir** para conservar tus cambios en disco, o **Descartar cambios** si deseas desecharlos. |
| **Un modelo tiene más de 10,000 polígonos** | Supera el límite de importación estándar de un único MeshPart de Roblox. | En la pestaña **Editar**, pulsa **Diezmar / Optimizar** o **Separar partes lógicas** para dividirlo automáticamente en piezas menores a 10k tris. |

---

## 5. GLOSARIO DE TÉRMINOS TÉCNICOS

- **EditableMesh**: API moderna de Roblox que permite manipular vértices, aristas y caras de una malla en tiempo real dentro del motor.
- **SurfaceAppearance**: Objeto de Roblox que aplica materiales PBR realistas sustituyendo las texturas básicas de plástico.
- **SHA-256 / Hash de Integridad**: Huella matemática única que garantiza que el modelo local y el modelo en Roblox son idénticos.
- **Rojo Bridge**: Herramienta de sincronización de archivos que vincula tus archivos locales (`src/shared/assets`) con el DataModel de Roblox Studio.
- **LOD (Level of Detail)**: Sistema de optimización que reduce la densidad poligonal del modelo cuando la cámara se aleja.
