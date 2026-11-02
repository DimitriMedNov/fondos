// Arma el fondo para todas tus pantallas: una imagen distinta por pantalla, recortada a su forma
// (ancha, ultrawide o vertical) y pegada justo donde está esa pantalla, en una sola imagen que
// GNOME extiende sobre todas ("spanned"). GNOME solo deja poner una imagen para todas.
//
// Corre como programa aparte (gjs -m componer.js '<json>') para que GNOME no se congele mientras
// procesa imágenes grandes. Imprime en la salida un JSON con el archivo final y las fotos usadas.
//
// Entrada: {fuente, carpeta, pantallas: [{x, y, ancho, alto, escala}], anteriores: [{archivo, vertical, ...}],
//           reusar}
//   x, y, ancho, alto: lugar de cada pantalla en el escritorio (en puntos lógicos de GNOME);
//   escala: cuántos píxeles reales hay por punto.
//   anteriores: fotos del fondo actual. Si una descarga falla, se usa una de estas.
//   reusar: al conectar o quitar un monitor. Cada pantalla toma una foto anterior de su misma
//           forma (vertical u horizontal) y solo se baja foto para las que no tengan.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {traer} from './fuentes.js';

const MAX_LADO = 16000; // límite de seguridad para la imagen final
const GUARDAR_FONDOS = 6; // imágenes finales que se conservan
const GUARDAR_FOTOS = 24; // fotos sueltas que se conservan

function salir(datos, codigo = 0) {
    print(JSON.stringify(datos));
    System.exit(codigo);
}

// Recorta al centro la parte con la forma de la pantalla y la escala a ancho × alto.
function ajustar(pixbuf, ancho, alto) {
    const w = pixbuf.get_width(), h = pixbuf.get_height();
    let cw = w, ch = h;
    if (w / h > ancho / alto)
        cw = Math.round(h * ancho / alto);
    else
        ch = Math.round(w * alto / ancho);
    const recorte = pixbuf.new_subpixbuf(Math.floor((w - cw) / 2), Math.floor((h - ch) / 2), cw, ch);
    const escalada = recorte.scale_simple(ancho, alto, GdkPixbuf.InterpType.HYPER);
    if (!escalada.get_has_alpha())
        return escalada;
    // PNG con transparencia: se aplana sobre negro (el lienzo final no tiene canal alfa).
    const plana = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, ancho, alto);
    plana.fill(0x000000ff);
    escalada.composite(plana, 0, 0, ancho, alto, 0, 0, 1, 1, GdkPixbuf.InterpType.NEAREST, 255);
    return plana;
}

function borrarViejos(carpeta, prefijo, guardar, enUso) {
    const dir = Gio.File.new_for_path(carpeta);
    const lista = [];
    const it = dir.enumerate_children('standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = it.next_file(null))) {
        if (info.get_name().startsWith(prefijo))
            lista.push({nombre: info.get_name(), t: info.get_modification_date_time()?.to_unix() ?? 0});
    }
    lista.sort((a, b) => b.t - a.t);
    for (const {nombre} of lista.slice(guardar)) {
        const ruta = GLib.build_filenamev([carpeta, nombre]);
        if (!enUso.has(ruta))
            dir.get_child(nombre).delete(null);
    }
}

async function main() {
    let entrada;
    try {
        entrada = JSON.parse(System.programArgs[0]);
    } catch {
        salir({error: 'Uso: gjs -m componer.js \'{"fuente": "ambas", "carpeta": "...", "pantallas": [...]}\''}, 2);
    }
    const {fuente = 'ambas', carpeta, pantallas, reusar = false} = entrada;
    const anteriores = (entrada.anteriores ?? []).filter(a => a?.archivo && GLib.file_test(a.archivo, GLib.FileTest.EXISTS));
    const usadas = new Set();
    if (!carpeta || !pantallas?.length)
        salir({error: 'Faltan la carpeta o las pantallas.'}, 2);
    GLib.mkdir_with_parents(carpeta, 0o755);

    // Escala común: la mayor, para que ninguna pantalla quede con menos píxeles de los que tiene.
    const escala = Math.max(...pantallas.map(p => p.escala ?? 1));
    const minX = Math.min(...pantallas.map(p => p.x)), minY = Math.min(...pantallas.map(p => p.y));
    const maxX = Math.max(...pantallas.map(p => p.x + p.ancho)), maxY = Math.max(...pantallas.map(p => p.y + p.alto));
    const f = Math.min(escala, MAX_LADO / (maxX - minX), MAX_LADO / (maxY - minY));
    const lienzo = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8,
        Math.round((maxX - minX) * f), Math.round((maxY - minY) * f));
    lienzo.fill(0x000000ff); // lo que no cae en ninguna pantalla nunca se ve

    const sello = GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S');
    const fotos = [];
    const avisos = [];
    for (const [i, p] of pantallas.entries()) {
        const ancho = Math.round(p.ancho * f), alto = Math.round(p.alto * f);
        const vertical = p.alto > p.ancho;
        let foto = null;
        if (reusar) {
            foto = anteriores.find(a => !usadas.has(a.archivo) && Boolean(a.vertical) === vertical) ?? null;
            if (foto)
                usadas.add(foto.archivo);
        }
        if (!foto) {
            try {
                const d = await traer(fuente, ancho, alto, null);
                const archivo = GLib.build_filenamev([carpeta, `foto-${sello}-${i + 1}-${d.id}.${d.ext ?? 'jpg'}`]);
                GLib.file_set_contents(archivo, d.bytes.get_data());
                foto = {archivo, titulo: d.titulo, autor: d.autor, enlace: d.enlace, fuente: d.fuente};
            } catch (e) {
                avisos.push(`Pantalla ${i + 1}: ${e.message}`);
            }
        }
        // Sin foto nueva: una de antes, mejor si es de la misma forma.
        if (!foto) {
            foto = anteriores.find(a => Boolean(a.vertical) === vertical) ?? anteriores[i % Math.max(1, anteriores.length)] ?? null;
            if (foto)
                avisos.push(`Pantalla ${i + 1}: usé la foto anterior.`);
        }
        if (!foto)
            salir({error: avisos.join(' · ') || 'No hay foto para una de las pantallas.'}, 1);

        let pixbuf;
        try {
            pixbuf = GdkPixbuf.Pixbuf.new_from_file(foto.archivo).apply_embedded_orientation();
        } catch (e) {
            salir({error: `No pude abrir la foto de la pantalla ${i + 1}: ${e.message}`}, 1);
        }
        ajustar(pixbuf, ancho, alto).copy_area(0, 0, ancho, alto, lienzo,
            Math.round((p.x - minX) * f), Math.round((p.y - minY) * f));
        fotos.push({...foto, pantalla: i + 1, vertical});
    }

    const final = GLib.build_filenamev([carpeta, `fondo-${sello}.jpg`]);
    lienzo.savev(final, 'jpeg', ['quality'], ['92']);
    const enUso = new Set([final, ...fotos.map(x => x.archivo)]);
    borrarViejos(carpeta, 'fondo-', GUARDAR_FONDOS, enUso);
    borrarViejos(carpeta, 'foto-', GUARDAR_FOTOS, enUso);
    salir({archivo: final, fotos, avisos, ancho: lienzo.get_width(), alto: lienzo.get_height()});
}

await main().catch(e => salir({error: e.message}, 1));
