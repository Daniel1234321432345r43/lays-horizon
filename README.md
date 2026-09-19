# Lays Horizon

Prototipo 3D de voxels, agricultura y edificación urbana construido con **Vite** y **Three.js**.
El mundo es una rejilla de 30 × 6 × 30 bloques renderizada con `InstancedMesh` y culling de caras internas.

## Puesta en marcha

```bash
npm install
npm run dev      # servidor de desarrollo en http://127.0.0.1:5173
npm run build    # build de producción en dist/
npm run preview  # sirve el build
```

## Controles

| Entrada | Acción |
| --- | --- |
| `W A S D` / flechas | Mover al jugador en el plano XZ según la orientación de la cámara |
| `Espacio` | Saltar |
| `Shift` | Correr |
| `1` … `5` o clic en la hotbar | Elegir herramienta (Pico, Azada, Semillas, Carretera, Edificio) |
| Clic izquierdo | Usar la herramienta sobre el bloque/objetivo apuntado |
| Mantener el clic | Minar de forma continua acumulando durabilidad |
| `R` | Rescatar al jugador y devolverlo a la superficie más cercana |

## Herramientas

- **Pico** — mina bloques expuestos de cualquier capa (`Y ≤ 0`); el drop va al inventario.
- **Azada** — convierte césped de `Y = 0` en tierra arada.
- **Semillas** — planta sobre tierra arada; el cultivo crece por fases (Semilla → Brote → Madura).
- **Carretera** — asfalta celdas libres de `Y = 0` con bloques `ROAD`.
- **Edificio** — ensambla un módulo 2 × 2 (cimientos, muros con ventanas, tejado piramidal y antena).
  Con el pico seleccionado, un clic sobre una construcción la desmonta y recupera parte de los materiales.

Un clic sobre una planta **madura** la cosecha con cualquier herramienta, suma Alimento y deja la tierra lista para replantar.

## Arquitectura

```
src/
├── main.js                    # Arranque y bucle principal (deltaTime acotado)
├── core/Engine.js             # WebGLRenderer, Scene, Camera, resize
├── core/Lighting.js           # Sol con sombras, luz ambiental y hemisférica
├── world/BlockTypes.js        # ID, color, durabilidad y drop de cada bloque
├── world/WorldGrid.js         # Rejilla 3D sobre Uint8Array + generación inicial
├── world/TerrainRenderer.js   # InstancedMesh por tipo, culling y updateBlock incremental
├── entities/Player.js         # Movimiento WASD, física, colisiones AABB y cámara lerp
├── entities/Crops.js          # Mallas low-poly de las fases de crecimiento
├── systems/InteractionSystem.js # Raycast de cursor, DDA de vóxeles y cursor 3D
├── systems/DiggingSystem.js   # Minado, durabilidad acumulada y drops
├── systems/FarmingSystem.js   # Labranza, siembra, temporizadores y cosecha
├── systems/CitySystem.js      # Carreteras y edificios modulares 2x2
└── ui/HUD.js                  # Hotbar, panel de estado e inventario
```

## Seguridad de juego

- **Escalón automático:** el jugador sube desniveles de un bloque caminando, sin saltar.
- **Salto + escalón** permiten salir de pozos de dos bloques; para pozos más profundos
  (hasta la roca base) existe la tecla `R`, que reubica al jugador en la superficie más
  cercana. Sin ella, un pozo profundo dejaría la partida bloqueada: no hay herramienta
  para colocar bloques.
- Los paneles del HUD capturan el puntero, de modo que un clic sobre la interfaz nunca
  excava el mundo que queda detrás.
- **Puntería del cultivo:** apuntar a la celda donde hay una planta (o a la planta misma) apunta al
  cultivo, no a la tierra. Desde la cámara isométrica el rayo solo rozaba las hojas y caía en el
  bloque de debajo, así que la cosecha podía no dispararse aunque el jugador estuviera apuntando bien.
- **Salto con margen:** una pulsación corta se recuerda (0,25 s) y se aplica en cuanto el jugador
  toca el suelo. Con pocos fps, un toque rápido caía entre dos frames y se perdía.

## Aspecto y feedback

- **Color por cara:** cada bloque tiene su propia geometría de caja con colores por vértice, así que
  el césped es verde arriba y tierra en los lados, y los cortes del terreno muestran estratos.
- **Variación por instancia:** `instanceColor` da a cada bloque un tono estable derivado de sus
  coordenadas, de modo que grandes superficies no se ven planas y un bloque recolocado conserva el suyo.
- **Cielo y atmósfera:** domo con degradado cenit → horizonte → bruma, niebla a juego y sombras
  direccionales ajustadas al tamaño del mundo.
- **Vista previa de colocación:** carreteras y edificios muestran un fantasma verde (o rojo si la
  acción no es válida) con la huella real que van a ocupar antes de construirlos.
- **HUD:** barra de progreso de minado o de crecimiento del cultivo (ámbar → verde al madurar),
  iconos de inventario coloreados y lectura de `fps`, draw calls e instancias visibles.

## Animación del personaje

- **Extremidades articuladas:** piernas y brazos cuelgan de grupos anclados en la cadera y en el
  hombro, así que el ciclo de caminar gira desde la articulación y se amortigua al detenerse.
- **Un golpe por acción:** labrar, sembrar, asfaltar, construir, cosechar y desmontar disparan el
  golpe de herramienta; en el minado continuo se cuenta **un golpe por punto de durabilidad**, de
  modo que el brazo acompaña el ritmo real de la excavación en vez de quedarse quieto.
- **Cabeza que mira el objetivo:** el jugador gira la cabeza hacia el bloque, la planta o el
  edificio apuntado (acotado a ±40° de giro y ±15° de inclinación para no retorcer el cuello) y
  vuelve al frente al perder el objetivo.
- **Vida en reposo:** respiración sutil del torso y de los brazos cuando no se mueve, para que el
  modelo no quede congelado mientras se decide el siguiente paso.

## Notas de rendimiento

- **Culling de caras internas**: un bloque solo se instancia si alguno de sus 6 vecinos es aire.
  En el mundo inicial esto reduce 5.400 bloques a ~1.500 instancias visibles.
- **Actualización incremental**: `updateBlock()` reasigna slots (con *swap-remove* y pila de
  slots libres) solo del bloque tocado y sus 6 vecinos, sin reconstruir la escena.
- **Selección sin coste por instancia**: el bloque apuntado se resuelve con un recorrido DDA
  (Amanatides & Woo) sobre la rejilla en lugar de probar miles de instancias por frame.
- **Cultivos instanciados**: cada fase es una única geometría fusionada con color por vértice y
  todas las plantas de esa fase se dibujan en un `InstancedMesh` por fase. El campo entero cuesta
  3 draw calls, no 9 por planta (medido: 3 plantas maduras pasaban de 36 a 127 draw calls; con
  instancing, 7 plantas se quedan en ~44 incluyendo terreno, edificios y el pase de sombras).
- **Interacción con instancias**: el cultivo apuntado se identifica por `instanceId` dentro de su
  fase, sin recorrer el árbol de la escena.
- **Simulación de paso fijo**: el bucle avanza la física en pasos de 1/60 s (hasta 20 por frame) en
  lugar de recortar el `deltaTime`. Con pocos fps el mundo mantiene el ritmo real (medido: 3,5-4,3
  unidades/s de las 4,6 nominales a 2-3 fps, frente a ~1,5 antes) y las colisiones se resuelven
  siempre con el mismo tamaño de paso, nunca con un salto largo.
- **Mapa de sombras a petición**: `renderer.shadowMap.autoUpdate = false`. El pase de sombras es más
  caro que el render principal, así que solo se recalcula cuando algo que proyecta sombra cambia
  (el jugador se mueve o cambia de postura, se edita el terreno, aparece o crece un cultivo, se
  construye o se desmonta) más un refresco de seguridad cada 0,5 s. Medido en la Preview (WebGL por
  software): un frame con sombras cuesta 10,4 ms y uno que reutiliza el mapa 3,1 ms; en reposo se
  salta el pase en la mayoría de los frames y caminando se rehace siempre.
- **Caja de sombra ajustada al mundo**: los 48x48 fijos dejaban resolución sin usar. La caja se
  calcula proyectando la caja real del mundo sobre los ejes de la luz (47x45), lo que sube la
  densidad de 42,7 a 43,6 texels por bloque con la misma textura de 2048.
- **Matrices estáticas**: el grupo del terreno desactiva `matrixAutoUpdate`, de modo que sus
  matrices no se recalculan en cada frame.

Medición del coste por frame en JavaScript (300 iteraciones por sistema): `player.update` 0,06-0,08 ms,
`interaction.update` 0,02 ms, `farming.update` 0,002 ms y `hud.setStatus` 0,02 ms. El presupuesto por
frame se va entero en rasterizado, no en la lógica del juego, así que las optimizaciones se centraron
ahí.
