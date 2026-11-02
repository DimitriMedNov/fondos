# Fondo del día

Extensión de GNOME que cambia el fondo cada 30 minutos con **fondos abstractos**: arte de
**Wallhaven** (abstracto, minimalista, 3D, degradados, ilustración) o **dibujados en tu compu**
(ondas en capas, manchas de papel cortado, arcos con relieve y tubos con luz de borde). Con varios
monitores pone uno distinto en cada uno, del tamaño y la forma de esa pantalla: uno ancho para el
ultrawide, uno vertical para el monitor vertical.

![Un ultrawide y un monitor vertical, cada uno con su fondo](capturas/escritorio.png)

*Un ultrawide (3440×1440) y un monitor vertical (1080×1920) a su derecha. Lo negro es la zona
donde no hay pantalla: nunca se ve.*

## Qué hace
- **Un fondo por pantalla.** GNOME solo deja poner una imagen para todas las pantallas, así que la
  extensión arma una sola imagen grande donde cada fondo cae justo sobre su monitor (opción
  «spanned» de GNOME). Funciona con monitores de distintos tamaños, verticales y ultrawide.
- **Cambia sola cada 30 minutos** (también al volver de suspender, si ya pasó ese rato). También
  cambia la pantalla de bloqueo.
- **Al conectar o quitar un monitor** vuelve a acomodar el fondo: reusa los fondos actuales que
  tengan la forma de cada pantalla y solo busca fondo para las que no tengan.
- **Wallhaven:** busca en [wallhaven.cc](https://wallhaven.cc) por temas (abstract, minimalism,
  gradient, 3D abstract, shapes…) con la proporción de cada pantalla (21:9 para el ultrawide, 9:16
  para el vertical), entre las más guardadas como favoritas. Solo la categoría general y apta para
  todo público; quita logos, personajes, autos y gente.
- **Generados:** dibujados con Cairo a la medida exacta de cada pantalla, sin internet y sin
  repetirse nunca. 4 estilos (ondas, manchas, arcos, tubos), 11 paletas, 7 de cada 10 oscuros.
- **Wallhaven y generados** (la opción normal) elige uno al azar por pantalla; sin internet, genera.
- Sin cuentas ni claves.

## Dónde se controla
<img src="capturas/menu.png" alt="Menú de Fondo del día en los Ajustes rápidos" width="366" align="right">

En los **Ajustes rápidos** (el menú de arriba a la derecha, el del wifi y la batería) aparece
**Fondo del día**:
- El botón prende o apaga el cambio automático.
- La flechita abre el menú: **Otro fondo ahora**, qué fondo hay en cada pantalla (clic: los de
  Wallhaven abren su página, los generados abren la imagen), de dónde salen (**Wallhaven y
  generados**, **Solo Wallhaven** o **Solo generados**; al elegir una, el fondo cambia en ese
  momento) y la carpeta de fondos.

Los fondos se guardan en `~/.local/share/fondos/` (las últimas 24 imágenes y 6 fondos armados; las más
viejas se borran solas).
<br clear="right">

## Instalar
```bash
git clone https://github.com/DimitriMedNov/fondos.git
cd fondos
./install.sh
```
Cierra sesión y vuelve a entrar. Funciona en GNOME 48 a 51. Necesita `gjs` (viene con GNOME).

`./install.sh --quitar` la quita; tu fondo actual se queda como está.

## Cómo funciona
| Archivo | Qué hace |
|---|---|
| `extension.js` | El botón de Ajustes rápidos, el cambio cada 30 min y el cambio al conectar monitores |
| `componer.js` | Programa aparte (`gjs -m`): consigue una imagen por pantalla, la recorta y arma la imagen final. Corre fuera de GNOME para que el escritorio no se congele con imágenes grandes |
| `fuentes.js` | Búsqueda en Wallhaven por tema y proporción, con filtro de tamaño |
| `generar.js` | Los 4 estilos dibujados con Cairo y sus paletas oscuras y claras |

Probar el armado sin GNOME (un ultrawide y un vertical a su derecha):
```bash
cd extension
gjs -m componer.js '{"carpeta": "/tmp/fondos", "pantallas": [{"x": 0, "y": 480, "ancho": 3440, "alto": 1440}, {"x": 3440, "y": 0, "ancho": 1080, "alto": 1920}]}'
```

## Licencia
MIT. Las imágenes de Wallhaven son de sus autores; la extensión solo las baja para usarlas de
fondo en tu compu. Los fondos generados son tuyos.
