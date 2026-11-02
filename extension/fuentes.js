// De dónde salen los fondos, sin claves ni cuentas:
//  - Unsplash, a través de Picsum (picsum.photos): fotos de Unsplash al azar, ya recortadas al
//    tamaño de tu pantalla, con su autor y enlace.
//  - NASA, de su biblioteca de imágenes (images.nasa.gov): busca un tema espacial al azar y elige
//    una imagen que, recortada a la forma de la pantalla (ancha, ultrawide o vertical), siga
//    siendo grande.
// Solo usa GLib/Gio/Soup, así que se puede probar fuera de GNOME Shell con `gjs -m`.

import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

// Temas de búsqueda. Solo se aceptan imágenes científicas (ver CODIGO_CIENTIFICO), así que las
// fotos de prensa, eventos y laboratorio quedan fuera aunque salgan en la búsqueda.
const TEMAS_NASA = ['nebula', 'galaxy', 'hubble', 'star cluster', 'supernova', 'spitzer', 'jupiter', 'saturn',
    'earth', 'aurora', 'earth at night', 'sunrise', 'milky way', 'comet'];
// PIA… = Photojournal (imágenes científicas), iss…e… = fotos desde la estación espacial,
// hubble-… = imágenes del Hubble.
const CODIGO_CIENTIFICO = /^(PIA\d+|iss\d+e\d+|hubble[-_].+)$/i;
const PICSUM_MAX = 5000; // Picsum no da imágenes más grandes
const MIN_PROPORCION = 0.75; // la parte recortada debe tener al menos 75 % del ancho de la pantalla
const MAX_BYTES = 40 * 1024 * 1024; // las originales de la NASA a veces pesan cientos de MB
const INTENTOS_NASA = 12; // imágenes revisadas por tema
const TEMAS_POR_INTENTO = 3;
const NO_SIRVE = /\b(maps?|diagrams?|charts?|graphs?|plots?|logos?|posters?|mosaic key|labeled|annotated)\b/i;

const sesion = new Soup.Session({timeout: 60, user_agent: 'fondos-gnome/1'});

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
                    throw new Error(`${new URL(url).host} respondió ${estado}`);
                resolver({bytes, uri: msg.get_uri().to_string()});
            } catch (e) {
                rechazar(e);
            }
        });
    });
}

async function pedirJSON(url, cancelable) {
    const {bytes} = await pedir(url, cancelable);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

// Devuelve {bytes, titulo, autor, enlace, fuente, id}. Picsum ya la recorta a ancho × alto.
export async function deUnsplash(ancho, alto, cancelable) {
    const f = Math.min(1, PICSUM_MAX / Math.max(ancho, alto));
    const [w, h] = [Math.round(ancho * f), Math.round(alto * f)];
    // Picsum redirige a la foto elegida; el número de foto viene en la dirección final.
    const {bytes, uri} = await pedir(`https://picsum.photos/${w}/${h}`, cancelable);
    const id = uri.match(/\/id\/(\d+)\//)?.[1];
    let autor = '', enlace = 'https://unsplash.com';
    if (id) {
        try {
            const info = await pedirJSON(`https://picsum.photos/id/${id}/info`, cancelable);
            autor = info.author ?? '';
            enlace = info.url ?? enlace;
        } catch {
            // sin autor: la foto sirve igual
        }
    }
    return {bytes, titulo: autor ? `Foto de ${autor}` : 'Foto de Unsplash', autor, enlace, fuente: 'Unsplash',
        id: `unsplash-${id ?? GLib.uuid_string_random().slice(0, 8)}`};
}

// ¿Sirve de fondo para una pantalla de ancho × alto? Al recortarla a la forma de la pantalla
// debe quedar casi del ancho de la pantalla, y no debe pesar demasiado.
export function sirveDeFondo(meta, ancho, alto) {
    const w = Number(meta['File:ImageWidth']), h = Number(meta['File:ImageHeight']);
    if (!(w > 0 && h > 0))
        return false;
    const recorteAncho = w / h > ancho / alto ? h * ancho / alto : w;
    const mb = parseFloat(meta['File:FileSize']);
    const unidad = String(meta['File:FileSize'] ?? '').match(/[kMG]B/)?.[0] ?? 'MB';
    const bytes = mb * {kB: 1024, MB: 1024 ** 2, GB: 1024 ** 3}[unidad];
    return recorteAncho >= ancho * MIN_PROPORCION && !(bytes > MAX_BYTES);
}

// Mira la imagen en chiquito: descarta las casi grises (relieves, fotos en blanco y negro) y las
// casi todas blancas (fotos de laboratorio).
export function sirveDeColor(bytes) {
    const cargador = new GdkPixbuf.PixbufLoader();
    cargador.connect('size-prepared', (c, w, h) => c.set_size(48, Math.max(1, Math.round(48 * h / w))));
    try {
        cargador.write_bytes(bytes);
        cargador.close();
    } catch {
        return false;
    }
    const p = cargador.get_pixbuf();
    const datos = p.get_pixels(), n = p.get_n_channels(), fila = p.get_rowstride();
    let saturacion = 0, blancos = 0, total = 0;
    for (let y = 0; y < p.get_height(); y++) {
        for (let x = 0; x < p.get_width(); x++) {
            const i = y * fila + x * n;
            const max = Math.max(datos[i], datos[i + 1], datos[i + 2]), min = Math.min(datos[i], datos[i + 1], datos[i + 2]);
            saturacion += max === 0 ? 0 : (max - min) / max;
            if (min > 200)
                blancos++;
            total++;
        }
    }
    return saturacion / total >= 0.12 && blancos / total < 0.35;
}

export async function deNASA(ancho, alto, cancelable) {
    let ultimo;
    for (let i = 0; i < TEMAS_POR_INTENTO; i++) {
        try {
            return await deNASAconTema(azar(TEMAS_NASA), ancho, alto, cancelable);
        } catch (e) {
            if (cancelable?.is_cancelled())
                throw e;
            ultimo = e;
        }
    }
    throw ultimo;
}

async function deNASAconTema(tema, ancho, alto, cancelable) {
    const base = `https://images-api.nasa.gov/search?media_type=image&q=${encodeURIComponent(tema)}`;
    const primera = await pedirJSON(base, cancelable);
    const paginas = Math.min(20, Math.ceil((primera.collection?.metadata?.total_hits ?? 0) / 100));
    if (paginas === 0)
        throw new Error(`La NASA no encontró imágenes de «${tema}».`);
    const pagina = 1 + Math.floor(Math.random() * paginas);
    const datos = pagina === 1 ? primera : await pedirJSON(`${base}&page=${pagina}`, cancelable);

    const candidatos = [...(datos.collection?.items ?? [])].sort(() => Math.random() - 0.5);
    let revisados = 0;
    for (const item of candidatos) {
        if (revisados >= INTENTOS_NASA)
            break;
        const info = item.data?.[0];
        // Si el título es solo el código de archivo, suele ser una foto de trámite.
        if (!CODIGO_CIENTIFICO.test(info?.nasa_id ?? '') || info.title === info.nasa_id ||
            NO_SIRVE.test(info.title ?? ''))
            continue;
        revisados++; // solo cuentan las que hay que pedir a internet
        const carpeta = `https://images-assets.nasa.gov/image/${encodeURIComponent(info.nasa_id)}`;
        let meta;
        try {
            meta = await pedirJSON(`${carpeta}/metadata.json`, cancelable);
        } catch {
            continue;
        }
        if (!sirveDeFondo(meta, ancho, alto))
            continue;
        // Los archivos de cada imagen: se prefiere la original en JPG; las TIFF no sirven de fondo.
        let archivos;
        try {
            const lista = await pedirJSON(`https://images-api.nasa.gov/asset/${encodeURIComponent(info.nasa_id)}`, cancelable);
            archivos = (lista.collection?.items ?? []).map(i => i.href.replace(/^http:/, 'https:'));
        } catch {
            continue;
        }
        const archivo = ['~orig.jpg', '~large.jpg', '~orig.png', '~orig.jpeg']
            .map(fin => archivos.find(a => a.toLowerCase().endsWith(fin))).find(Boolean);
        if (!archivo)
            continue;
        const {bytes} = await pedir(encodeURI(decodeURI(archivo)), cancelable);
        if (!sirveDeColor(bytes))
            continue;
        return {bytes, titulo: info.title ?? info.nasa_id, autor: info.center ? `NASA ${info.center}` : 'NASA',
            enlace: `https://images.nasa.gov/details/${encodeURIComponent(info.nasa_id)}`, fuente: 'NASA',
            id: `nasa-${info.nasa_id}`.replace(/[^\w.-]/g, '_')};
    }
    throw new Error(`No encontré una imagen de la NASA de «${tema}» del tamaño de la pantalla.`);
}

// fuente: 'ambas' | 'unsplash' | 'nasa'. Con 'ambas', si la elegida falla se prueba la otra.
export async function traer(fuente, ancho, alto, cancelable) {
    const cual = fuente === 'ambas' ? azar(['unsplash', 'nasa']) : fuente;
    const de = c => c === 'nasa' ? deNASA(ancho, alto, cancelable) : deUnsplash(ancho, alto, cancelable);
    try {
        return await de(cual);
    } catch (e) {
        if (fuente !== 'ambas' || cancelable?.is_cancelled())
            throw e;
        return de(cual === 'nasa' ? 'unsplash' : 'nasa');
    }
}

export function abortarTodo() {
    sesion.abort();
}
