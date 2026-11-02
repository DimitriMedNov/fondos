// De dónde salen los fondos, sin claves ni cuentas:
//  - Wallhaven (wallhaven.cc): fondos de arte abstracto, minimalista, 3D e ilustración, buscados
//    con la forma de cada pantalla (21:9 para el ultrawide, 9:16 para el vertical…), así casi no
//    hay que recortar.
//  - Generados: dibujados aquí mismo con Cairo (ver generar.js), sin internet.
// Solo usa GLib/Soup/Cairo, así que se puede probar fuera de GNOME Shell con `gjs -m`.

import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {generar} from './generar.js';

// Búsquedas de Wallhaven. Solo la categoría «general» (sin anime ni fotos de gente) y solo
// contenido apto para todo público. Los temas con «-» quitan lo que se cuela en la búsqueda.
const TEMAS = ['abstract', 'minimalism', 'gradient', '3D abstract', 'shapes', 'simple background',
    'illustration', 'colorful', 'geometry', 'waves'];
const QUITAR = ' -women -men -cars -anime -logo -Linux -superheroes -cartoon -robot -games';
// Proporciones que acepta Wallhaven, como ancho / alto.
const PROPORCIONES = {
    '9x18': 9 / 18, '9x16': 9 / 16, '10x16': 10 / 16, '1x1': 1, '5x4': 5 / 4, '4x3': 4 / 3, '3x2': 3 / 2,
    '16x10': 16 / 10, '16x9': 16 / 9, '21x9': 21 / 9, '32x9': 32 / 9, '48x9': 48 / 9,
};
const PARECIDA = 0.2; // diferencia máxima de proporción aceptada (en logaritmo, ~22 %)
const MIN_PROPORCION = 0.75; // la parte recortada debe tener al menos 75 % del ancho de la pantalla
const MAX_BYTES = 25 * 1024 * 1024;
const TEMAS_POR_INTENTO = 4;
const PAGINAS = 3; // de 24 imágenes cada una

const sesion = new Soup.Session({timeout: 60, user_agent: 'fondos-gnome/2'});

export const azar = lista => lista[Math.floor(Math.random() * lista.length)];

function pedir(url, cancelable) {
    const msg = Soup.Message.new('GET', url);
    if (!msg)
        return Promise.reject(new Error(`Dirección inválida: ${url}`));
    return new Promise((resolver, rechazar) => {
        sesion.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancelable, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                const estado = msg.get_status();
                if (estado !== Soup.Status.OK)
                    throw new Error(`${url.split('/')[2] ?? url} respondió ${estado}`);
                resolver(bytes);
            } catch (e) {
                rechazar(e);
            }
        });
    });
}

async function pedirJSON(url, cancelable) {
    const bytes = await pedir(url, cancelable);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

// Proporciones de Wallhaven parecidas a la de la pantalla, de la más a la menos parecida.
export function proporcionesPara(ancho, alto) {
    const r = ancho / alto;
    return Object.entries(PROPORCIONES)
        .map(([clave, v]) => [clave, Math.abs(Math.log(v / r))])
        .filter(([, d]) => d <= PARECIDA)
        .sort((a, b) => a[1] - b[1])
        .map(([clave]) => clave);
}

// ¿Sirve para una pantalla de ancho × alto? Recortada a la forma de la pantalla debe quedar casi
// del ancho de la pantalla, y no debe pesar demasiado.
export function sirve(img, ancho, alto) {
    const w = img.dimension_x, h = img.dimension_y;
    if (!(w > 0 && h > 0) || !(img.file_size < MAX_BYTES) || !/\.(jpe?g|png)$/i.test(img.path ?? ''))
        return false;
    const recorteAncho = w / h > ancho / alto ? h * ancho / alto : w;
    return recorteAncho >= ancho * MIN_PROPORCION;
}

async function deWallhavenConTema(tema, ancho, alto, cancelable) {
    const proporciones = proporcionesPara(ancho, alto);
    // Entre las más guardadas como favoritas (las primeras páginas), no entre todas: al azar
    // salen muchas de poca calidad.
    const params = {q: tema + QUITAR, categories: '100', purity: '100', sorting: 'favorites', order: 'desc'};
    if (proporciones.length)
        params.ratios = proporciones.join(',');
    const consulta = Object.entries(params).map(([k, v]) => `${k}=${GLib.uri_escape_string(v, null, false)}`).join('&');
    const buscar = pagina => pedirJSON(`https://wallhaven.cc/api/v1/search?${consulta}&page=${pagina}`, cancelable);
    let {data = []} = await buscar(1 + Math.floor(Math.random() * PAGINAS));
    if (!data.length)
        ({data = []} = await buscar(1)); // ese tema tiene menos páginas
    const img = azar(data.filter(i => sirve(i, ancho, alto)));
    if (!img)
        throw new Error(`Wallhaven no tiene «${tema}» del tamaño de la pantalla.`);
    const bytes = await pedir(img.path, cancelable);
    return {bytes, titulo: `${tema[0].toUpperCase()}${tema.slice(1)} · ${img.resolution}`, autor: '',
        enlace: img.url, fuente: 'Wallhaven', id: `wallhaven-${img.id}`, ext: img.path.split('.').pop().toLowerCase()};
}

export async function deWallhaven(ancho, alto, cancelable) {
    let ultimo;
    const temas = [...TEMAS].sort(() => Math.random() - 0.5).slice(0, TEMAS_POR_INTENTO);
    for (const tema of temas) {
        try {
            return await deWallhavenConTema(tema, ancho, alto, cancelable);
        } catch (e) {
            if (cancelable?.is_cancelled())
                throw e;
            ultimo = e;
        }
    }
    throw ultimo;
}

// fuente: 'ambas' | 'wallhaven' | 'generados'. Con 'ambas' se elige una al azar; si Wallhaven
// falla (sin internet), se genera uno aquí mismo.
export async function traer(fuente, ancho, alto, cancelable) {
    const cual = fuente === 'ambas' ? azar(['wallhaven', 'generados']) : fuente;
    if (cual === 'generados')
        return generar(ancho, alto);
    try {
        return await deWallhaven(ancho, alto, cancelable);
    } catch (e) {
        if (fuente !== 'ambas' || cancelable?.is_cancelled())
            throw e;
        return generar(ancho, alto);
    }
}

export function abortarTodo() {
    sesion.abort();
}
