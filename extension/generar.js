// Fondos abstractos dibujados aquí mismo con Cairo (sin internet), a la medida exacta de cada
// pantalla. Cuatro estilos: ondas en capas, manchas de papel cortado, arcos con relieve y tubos con
// luz de borde. Cada uno tiene versión oscura y clara (los tubos, solo oscura).
// Solo usa Cairo y GLib, así que se puede probar fuera de GNOME Shell con `gjs -m`.

import Cairo from 'cairo';
import GLib from 'gi://GLib';

const azar = lista => lista[Math.floor(Math.random() * lista.length)];
const entre = (a, b) => a + Math.random() * (b - a);
const PROB_OSCURO = 0.7; // 7 de cada 10 salen oscuros

// Paletas: fondo + colores de atrás hacia adelante. Pocas tintas por paleta, como en los ejemplos.
const PALETAS = {
    oscuro: [
        {nombre: 'Atardecer', fondo: '#1c1626', colores: ['#241a33', '#3b1f45', '#5e2550', '#8c2f55', '#c2404f', '#e8673f', '#f59e4c']},
        {nombre: 'Azul eléctrico', fondo: '#06060c', colores: ['#0d0d1f', '#14148a', '#2323e0', '#3d3dff', '#6c5cff']},
        {nombre: 'Grafito', fondo: '#141416', colores: ['#1b1b1e', '#232327', '#2c2c31', '#36363c', '#424249']},
        {nombre: 'Brasa', fondo: '#070606', colores: ['#120c0b', '#3a0f0a', '#8a1d10', '#d2401c', '#ff7a3d']},
        {nombre: 'Océano', fondo: '#04121a', colores: ['#062030', '#0a3346', '#0f4c5c', '#16707a', '#2fa39a', '#7fd1b9']},
        {nombre: 'Uva', fondo: '#120a1f', colores: ['#1d1033', '#2e1652', '#47207a', '#6a2fa8', '#9a5bd6', '#d6a6ff']},
    ],
    claro: [
        {nombre: 'Papel', fondo: '#f4efe6', colores: ['#e9e1d3', '#d8cdb9', '#1f3d8f', '#2c56c2', '#173072']},
        {nombre: 'Plata', fondo: '#e9e9ec', colores: ['#dcdce0', '#cfcfd4', '#c2c2c8', '#b3b3ba', '#a3a3ab']},
        {nombre: 'Durazno', fondo: '#fbe9dc', colores: ['#f8d7c0', '#f4b99a', '#ee9574', '#e06c5a', '#c4475a', '#8e2f5c']},
        {nombre: 'Menta', fondo: '#e6f4ef', colores: ['#cfeee3', '#a7e0cc', '#6fc7ad', '#3aa58e', '#1e7a6f']},
        {nombre: 'Lavanda', fondo: '#efeaf8', colores: ['#e0d6f3', '#c9b8ea', '#a993dc', '#8569c8', '#5e44a6']},
    ],
};

function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function mezclar(a, b, t) {
    return a.map((v, i) => v + (b[i] - v) * t);
}

// Color en la posición t (0..1) de la lista de colores.
function enEscala(colores, t) {
    const c = colores.map(rgb);
    const x = Math.min(0.9999, Math.max(0, t)) * (c.length - 1);
    const i = Math.floor(x);
    return mezclar(c[i], c[i + 1], x - i);
}

const aclarar = (c, t) => mezclar(c, [1, 1, 1], t);
const oscurecer = (c, t) => mezclar(c, [0, 0, 0], t);

// Sombra suave: dibuja la forma en negro en una superficie chica y la estira con filtro gaussiano.
// Así sale un desenfoque barato sin recorrer píxeles en JavaScript.
function sombra(cr, w, h, camino, {radio, alfa, dx = 0, dy = 0, color = [0, 0, 0]}) {
    const f = Math.max(2, radio);
    const chica = new Cairo.ImageSurface(Cairo.Format.ARGB32, Math.ceil(w / f) + 2, Math.ceil(h / f) + 2);
    const c = new Cairo.Context(chica);
    c.scale(1 / f, 1 / f);
    c.translate(dx, dy);
    camino(c);
    c.setSourceRGB(...color);
    c.fill();
    c.$dispose();
    cr.save();
    cr.scale(f, f);
    cr.setSourceSurface(chica, 0, 0);
    cr.getSource().setFilter(Cairo.Filter.GAUSSIAN);
    cr.paintWithAlpha(alfa);
    cr.restore();
    chica.finish();
}

// Ruido suave: suma de senos con fases al azar (no se repite entre fondos).
// cerrada: frecuencias enteras, para que una figura cerrada termine donde empieza.
function onda(n = 3, cerrada = false) {
    const partes = Array.from({length: n}, (_, i) => ({k: cerrada ? i + 2 : entre(0.6, 1.4) * (i + 1), fase: entre(0, Math.PI * 2), a: 1 / (i + 1)}));
    const total = partes.reduce((s, p) => s + p.a, 0);
    return t => partes.reduce((s, p) => s + p.a * Math.sin(p.k * t + p.fase), 0) / total;
}

// 1. Ondas en capas, como curvas de nivel, del color de atrás al de adelante (ejemplo morado/naranja).
function ondas(cr, w, h, paleta) {
    const L = Math.hypot(w, h) / 2;
    const angulo = azar([Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) + entre(-0.25, 0.25);
    const capas = Math.round(entre(7, 10));
    const amplitud = Math.min(w, h) * entre(0.06, 0.12);
    const frecuencia = entre(2.5, 4.5) / L;
    const formas = Array.from({length: capas}, (_, i) => {
        const d = -L * 0.75 + (i / (capas - 1)) * L * 1.45;
        const o = onda(3);
        return c => {
            c.save();
            c.translate(w / 2, h / 2);
            c.rotate(angulo);
            c.moveTo(L * 1.2, -L * 1.2);
            for (let v = -L * 1.2; v <= L * 1.2; v += 6)
                c.lineTo(d + amplitud * o(v * frecuencia), v);
            c.lineTo(L * 1.2, L * 1.2);
            c.closePath();
            c.restore();
        };
    });
    cr.setSourceRGB(...rgb(paleta.fondo));
    cr.paint();
    const s = Math.min(w, h);
    formas.forEach((forma, i) => {
        sombra(cr, w, h, forma, {radio: s * 0.02, alfa: 0.55, dx: -s * 0.006, dy: -s * 0.004});
        const color = enEscala(paleta.colores, i / (capas - 1));
        // Cada capa con un degradado leve para que no se vea plana.
        const g = new Cairo.LinearGradient(0, 0, w, h);
        g.addColorStopRGB(0, ...oscurecer(color, 0.12));
        g.addColorStopRGB(1, ...aclarar(color, 0.05));
        forma(cr);
        cr.setSource(g);
        cr.fill();
    });
}

// 2. Manchas de papel cortado: figuras orgánicas con capas hacia adentro (ejemplo azul y negro).
function manchas(cr, w, h, paleta) {
    const s = Math.min(w, h);
    const [base, ...tintas] = paleta.colores;
    const contraste = azar(tintas.slice(-3));
    cr.setSourceRGB(...rgb(paleta.fondo));
    cr.paint();
    const cuantas = Math.round(entre(3, 5) * Math.max(w, h) / s);
    for (let m = 0; m < cuantas; m++) {
        const cx = entre(-0.1, 1.1) * w, cy = entre(-0.1, 1.1) * h;
        const R = s * entre(0.3, 0.55);
        const o = onda(3, true);
        const anillos = Math.round(entre(3, 6));
        for (let a = 0; a < anillos; a++) {
            const r = R * (1 - a / anillos * 0.85);
            const desplaza = a * s * 0.012;
            const forma = c => {
                for (let i = 0; i <= 120; i++) {
                    const t = i / 120 * Math.PI * 2;
                    const rr = r * (1 + 0.3 * o(t));
                    const x = cx + desplaza + rr * Math.cos(t), y = cy - desplaza + rr * Math.sin(t) * 0.85;
                    if (i === 0)
                        c.moveTo(x, y);
                    else
                        c.lineTo(x, y);
                }
                c.closePath();
            };
            sombra(cr, w, h, forma, {radio: s * 0.018, alfa: 0.7, dx: s * 0.006, dy: s * 0.008});
            const color = a % 2 === 0 ? rgb(contraste) : rgb(base);
            const g = new Cairo.RadialGradient(cx - R * 0.3, cy - R * 0.3, 0, cx, cy, R * 1.4);
            g.addColorStopRGB(0, ...aclarar(color, 0.12));
            g.addColorStopRGB(1, ...oscurecer(color, 0.25));
            forma(cr);
            cr.setSource(g);
            cr.fill();
        }
    }
}

// 3. Arcos con relieve sobre fondo de estrías diagonales (ejemplo gris plata/grafito).
function arcos(cr, w, h, paleta, oscuro) {
    const s = Math.min(w, h);
    const fondo = rgb(paleta.fondo);
    cr.setSourceRGB(...fondo);
    cr.paint();
    // Estrías: líneas diagonales con brillo de un lado y sombra del otro.
    const paso = s * entre(0.035, 0.05);
    const L = w + h;
    cr.setLineWidth(paso * 0.18);
    for (let k = -L; k < L; k += paso) {
        cr.setSourceRGBA(...(oscuro ? aclarar(fondo, 0.08) : [1, 1, 1]), oscuro ? 0.6 : 0.55);
        cr.moveTo(k, 0);
        cr.lineTo(k + h, h);
        cr.stroke();
        cr.setSourceRGBA(0, 0, 0, oscuro ? 0.35 : 0.08);
        cr.moveTo(k + paso * 0.22, 0);
        cr.lineTo(k + paso * 0.22 + h, h);
        cr.stroke();
    }
    // Arcos: varias "U" una dentro de otra, cada una con sombra, cuerpo y brillo.
    const grupos = Math.max(1, Math.round(Math.max(w, h) / s * entre(0.8, 1.3)));
    for (let gq = 0; gq < grupos; gq++) {
        // Los grupos se reparten a lo largo del lado largo de la pantalla.
        const cx = w > h ? (gq + entre(0.35, 0.65)) / grupos * w : entre(0.35, 0.65) * w;
        const cy = w > h ? entre(0.4, 0.7) * h : (gq + entre(0.35, 0.65)) / grupos * h;
        const R = s * entre(0.25, 0.38);
        const giro = azar([0, Math.PI / 4, -Math.PI / 4, Math.PI * 0.75]) + entre(-0.1, 0.1);
        const n = Math.round(entre(4, 7));
        const grosor = R / n * 0.78;
        for (let i = 0; i < n; i++) {
            const r = R - i * (R / n);
            const camino = c => {
                c.save();
                c.translate(cx, cy);
                c.rotate(giro);
                c.moveTo(-r, L);
                c.lineTo(-r, 0);
                c.arc(0, 0, r, Math.PI, 2 * Math.PI);
                c.lineTo(r, L);
                c.restore();
            };
            // Sombra del trazo grueso, dibujada en la superficie chica.
            sombra(cr, w, h, c => {
                camino(c);
                c.setLineWidth(grosor);
                c.strokePreserve();
                c.newPath();
            }, {radio: s * 0.012, alfa: oscuro ? 0.8 : 0.35, dx: s * 0.008, dy: s * 0.01});
            const base = enEscala(paleta.colores, 0.3 + 0.7 * (i / n));
            camino(cr);
            cr.setLineWidth(grosor);
            const g = new Cairo.LinearGradient(cx - R, cy - R, cx + R, cy + R);
            g.addColorStopRGB(0, ...aclarar(base, oscuro ? 0.12 : 0.35));
            g.addColorStopRGB(1, ...oscurecer(base, oscuro ? 0.35 : 0.1));
            cr.setSource(g);
            cr.stroke();
            // Brillo fino en el borde interior.
            camino(cr);
            cr.setLineWidth(grosor * 0.12);
            cr.setSourceRGBA(1, 1, 1, oscuro ? 0.12 : 0.5);
            cr.save();
            cr.translate(-grosor * 0.3, -grosor * 0.3);
            cr.stroke();
            cr.restore();
        }
    }
}

// 4. Tubos que serpentean sobre negro, con luz de color en el borde (ejemplo laberinto).
function tubos(cr, w, h, paleta, oscuro) {
    const s = Math.min(w, h);
    const celda = s / entre(5, 8);
    const cols = Math.ceil(w / celda) + 1, filas = Math.ceil(h / celda) + 1;
    const usado = new Set();
    const libre = (x, y) => x >= -1 && y >= -1 && x <= cols && y <= filas && !usado.has(`${x},${y}`);
    const caminos = [];
    const horizontal = Math.random() < 0.6;
    for (let intento = 0; intento < cols * filas; intento++) {
        let x = Math.floor(entre(-1, cols + 1)), y = Math.floor(entre(-1, filas + 1));
        if (!libre(x, y))
            continue;
        const puntos = [[x, y]];
        usado.add(`${x},${y}`);
        let dir = horizontal ? [1, 0] : [0, 1];
        for (let paso = 0; paso < 60; paso++) {
            const opciones = [dir, dir, dir, [dir[1], dir[0]], [-dir[1], -dir[0]]]
                .filter(([dx, dy]) => libre(x + dx, y + dy));
            if (!opciones.length)
                break;
            dir = azar(opciones);
            x += dir[0];
            y += dir[1];
            usado.add(`${x},${y}`);
            puntos.push([x, y]);
        }
        if (puntos.length > 2)
            caminos.push(puntos);
    }
    const fondo = rgb(paleta.fondo);
    cr.setSourceRGB(...fondo);
    cr.paint();
    const ancho = celda * 0.62;
    const luzA = rgb(paleta.colores.at(-1)), luzB = rgb(paleta.colores.at(-2));
    for (const puntos of caminos) {
        const trazo = c => {
            puntos.forEach(([px, py], i) => {
                const X = px * celda, Y = py * celda;
                if (i === 0)
                    c.moveTo(X, Y);
                else
                    c.lineTo(X, Y);
            });
        };
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setLineCap(Cairo.LineCap.ROUND);
        // Sombra al piso.
        sombra(cr, w, h, c => {
            trazo(c);
            c.setLineWidth(ancho);
            c.setLineJoin(Cairo.LineJoin.ROUND);
            c.setLineCap(Cairo.LineCap.ROUND);
            c.strokePreserve();
            c.newPath();
        }, {radio: s * 0.02, alfa: oscuro ? 0.9 : 0.35, dx: celda * 0.08, dy: celda * 0.12});
        // Cuerpo del tubo: capas de afuera hacia adentro, del color del borde al del centro.
        const luz = Math.random() < 0.5 ? luzA : luzB;
        const borde = oscuro ? mezclar(fondo, luz, 0.55) : oscurecer(luz, 0.1);
        const centro = oscuro ? aclarar(fondo, 0.04) : aclarar(rgb(paleta.fondo), 0.4);
        const pasos = 10;
        for (let k = 0; k < pasos; k++) {
            const t = k / (pasos - 1);
            trazo(cr);
            cr.setLineWidth(ancho * (1 - t * 0.75));
            cr.setSourceRGB(...mezclar(borde, centro, Math.pow(t, 0.45)));
            cr.stroke();
        }
        // Reflejo arriba a la izquierda.
        cr.save();
        cr.translate(-ancho * 0.18, -ancho * 0.18);
        trazo(cr);
        cr.setLineWidth(ancho * 0.08);
        cr.setSourceRGBA(1, 1, 1, oscuro ? 0.12 : 0.5);
        cr.stroke();
        cr.restore();
    }
}

export const ESTILOS = {ondas, manchas, arcos, tubos};
const NOMBRES = {ondas: 'Ondas', manchas: 'Manchas', arcos: 'Arcos', tubos: 'Tubos'};

// Dibuja un fondo de ancho × alto píxeles y devuelve {bytes (PNG), titulo, autor, enlace, fuente, id, ext}.
// estilo y tono son opcionales (al azar si no se dan).
export function generar(ancho, alto, {estilo, tono} = {}) {
    const nombre = estilo ?? azar(Object.keys(ESTILOS));
    const oscuro = (tono ?? (Math.random() < PROB_OSCURO ? 'oscuro' : 'claro')) === 'oscuro';
    // Los tubos se ven mejor en oscuro, como el ejemplo.
    const paleta = azar(PALETAS[oscuro || nombre === 'tubos' ? 'oscuro' : 'claro']);
    const sup = new Cairo.ImageSurface(Cairo.Format.RGB24, ancho, alto);
    const cr = new Cairo.Context(sup);
    ESTILOS[nombre](cr, ancho, alto, paleta, oscuro || nombre === 'tubos');
    cr.$dispose();
    const [fd, temporal] = GLib.file_open_tmp('fondos-XXXXXX.png');
    GLib.close(fd);
    sup.writeToPNG(temporal);
    sup.finish();
    const [, datos] = GLib.file_get_contents(temporal);
    GLib.unlink(temporal);
    const id = `generado-${nombre}-${GLib.uuid_string_random().slice(0, 8)}`;
    return {bytes: new GLib.Bytes(datos), titulo: `${NOMBRES[nombre]} · ${paleta.nombre}`, autor: 'Generado',
        enlace: '', fuente: 'Generado', id, ext: 'png'};
}
