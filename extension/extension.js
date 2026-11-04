// Fondo del día: cada 30 minutos pone fondos abstractos nuevos (de Wallhaven o dibujados aquí mismo),
// uno por pantalla y con la forma de cada una (ultrawide, vertical, normal). Se controla desde los
// Ajustes rápidos (el menú del wifi y la batería): prender o apagar el cambio automático, otro fondo
// ahora y de dónde salen. El trabajo pesado (bajar, dibujar y recortar) lo hace componer.js aparte.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// Icono propio (foto con montañas y sol). "-symbolic" hace que GNOME lo pinte del color del tema.
let ICONO = null;
const CAMBIAR_CADA = 30 * 60; // s entre un fondo y el siguiente
const REVISAR_CADA = 60; // s: revisa seguido para no pasarse de los 30 min (también al volver de suspender)
const PRIMERA_REVISION = 20; // s tras entrar: deja que arranque la red
const ESPERA_MONITORES = 4; // s: al conectar un monitor llegan varios avisos seguidos
const FUENTES = [['ambas', 'Wallhaven y generados'], ['wallhaven', 'Solo Wallhaven'], ['generados', 'Solo generados']];

const ahora = () => Math.floor(GLib.get_real_time() / 1e6); // s

function abrir(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        Main.notifyError('Fondo del día', `No pude abrir ${uri}: ${e.message}`);
    }
}

// Blur my Shell arma el difuminado de la barra con el fondo del monitor donde está la barra. Al
// conectar o quitar un monitor lo rehace antes de que GNOME mueva la barra al monitor principal,
// y se queda con el fondo (y el ancho) del otro monitor. Apagar y prender su "static-blur" lo
// obliga a rehacerlo con la barra ya en su lugar. Solo actúa si Blur my Shell está activa y usa
// difuminado estático; si no, no hace nada.
const BLUR_MY_SHELL = 'blur-my-shell@aunetx';
let esperaBarra = 0, ajustesBarra = null;

function refrescarBarraDifuminada() {
    const ext = Main.extensionManager.lookup(BLUR_MY_SHELL);
    if (!ext || ext.state !== 1) // 1 = ACTIVE
        return;
    let ajustes;
    try {
        const fuente = Gio.SettingsSchemaSource.new_from_directory(GLib.build_filenamev([ext.path, 'schemas']),
            Gio.SettingsSchemaSource.get_default(), false);
        const esquema = fuente.lookup('org.gnome.shell.extensions.blur-my-shell.panel', true);
        if (!esquema)
            return;
        ajustes = new Gio.Settings({settings_schema: esquema, path: '/org/gnome/shell/extensions/blur-my-shell/panel/'});
    } catch (e) {
        console.warn(`Fondo del día: no pude leer Blur my Shell: ${e.message}`);
        return;
    }
    if (!ajustes.get_boolean('static-blur') || esperaBarra)
        return;
    ajustesBarra = ajustes;
    ajustes.set_boolean('static-blur', false);
    esperaBarra = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        esperaBarra = 0;
        ajustes.set_boolean('static-blur', true);
        ajustesBarra = null;
        return GLib.SOURCE_REMOVE;
    });
}

// Al apagar Fondos a la mitad del refresco, deja el difuminado prendido como estaba.
function cancelarRefrescoBarra() {
    if (!esperaBarra)
        return;
    GLib.source_remove(esperaBarra);
    esperaBarra = 0;
    ajustesBarra?.set_boolean('static-blur', true);
    ajustesBarra = null;
}

// Lugar y tamaño de cada pantalla, en el orden de GNOME.
function leerPantallas() {
    return Main.layoutManager.monitors.map((m, i) => ({
        x: m.x, y: m.y, ancho: m.width, alto: m.height,
        escala: global.display.get_monitor_scale(i) || m.geometry_scale || 1,
    }));
}

const Interruptor = GObject.registerClass(
class Interruptor extends QuickMenuToggle {
    _init(ext) {
        super._init({title: 'Fondo del día', gicon: ICONO, toggleMode: true});
        this._ext = ext;
        this._settings = ext.getSettings();
        this._settings.bind('auto', this, 'checked', Gio.SettingsBindFlags.DEFAULT);
        this.menu.setHeader(ICONO, 'Fondo del día');

        this._otro = new PopupMenu.PopupImageMenuItem('Otro fondo ahora', 'view-refresh-symbolic');
        this._otro.connect('activate', () => ext.cambiar({manual: true}));
        this.menu.addMenuItem(this._otro);

        this._fotos = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Fondos de ahora'));
        this.menu.addMenuItem(this._fotos);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('De dónde'));
        this._fuentes = FUENTES.map(([clave, nombre]) => {
            const item = new PopupMenu.PopupMenuItem(nombre);
            item.connect('activate', () => this._settings.set_string('fuente', clave));
            this.menu.addMenuItem(item);
            return [clave, item];
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const carpeta = new PopupMenu.PopupImageMenuItem('Abrir la carpeta de fondos', 'folder-pictures-symbolic');
        carpeta.connect('activate', () => abrir(Gio.File.new_for_path(ext.carpeta).get_uri()));
        this.menu.addMenuItem(carpeta);

        this._settings.connectObject('changed', () => this.actualizar(), this);
        this.actualizar();
    }

    actualizar() {
        const {ocupado, error} = this._ext;
        const fuente = this._settings.get_string('fuente');
        const auto = this._settings.get_boolean('auto');
        const nombreFuente = FUENTES.find(([c]) => c === fuente)?.[1] ?? '';
        this.subtitle = ocupado ? 'Buscando fondos…' : nombreFuente.replace('Solo ', '');
        this.menu.setHeader(ICONO, 'Fondo del día',
            ocupado ? 'Buscando fondos…' : auto ? 'Cambia cada 30 min' : 'Apagado: el fondo no cambia solo');
        this._otro.label.text = ocupado ? 'Buscando fondos…' : error ? `Reintentar (${error})` : 'Otro fondo ahora';
        this._otro.setSensitive(!ocupado);
        for (const [clave, item] of this._fuentes)
            item.setOrnament(clave === fuente ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);

        this._fotos.removeAll();
        const fotos = this._ext.estado?.fotos ?? [];
        if (fotos.length === 0) {
            const vacio = new PopupMenu.PopupMenuItem('Todavía no hay fondos', {reactive: false});
            this._fotos.addMenuItem(vacio);
        }
        for (const f of fotos) {
            const donde = fotos.length > 1 ? `Pantalla ${f.pantalla}${f.vertical ? ' (vertical)' : ''}: ` : '';
            // Los de Wallhaven abren su página; los generados abren la imagen.
            const item = new PopupMenu.PopupImageMenuItem(`${donde}${f.titulo} · ${f.fuente}`,
                f.enlace ? 'web-browser-symbolic' : 'image-x-generic-symbolic');
            item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            item.connect('activate', () => abrir(f.enlace || Gio.File.new_for_path(f.archivo).get_uri()));
            this._fotos.addMenuItem(item);
        }
    }
});

const Indicador = GObject.registerClass(
class Indicador extends SystemIndicator {
    _init(ext) {
        super._init();
        this.interruptor = new Interruptor(ext);
        this.quickSettingsItems.push(this.interruptor);
    }

    destroy() {
        this.quickSettingsItems.forEach(i => i.destroy());
        super.destroy();
    }
});

export default class Fondos extends Extension {
    enable() {
        ICONO = Gio.FileIcon.new(this.dir.get_child('icons').get_child('fondos-symbolic.svg'));
        this._settings = this.getSettings();
        this.carpeta = GLib.build_filenamev([GLib.get_user_data_dir(), 'fondos']);
        this.ocupado = false;
        this.error = null;
        this.estado = null;
        try {
            this.estado = JSON.parse(this._settings.get_string('estado') || 'null');
        } catch {
            this.estado = null;
        }
        this._proceso = null;
        this._indicador = new Indicador(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicador);

        this._revision = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PRIMERA_REVISION, () => {
            this._revisar();
            this._revision = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REVISAR_CADA, () => {
                this._revisar();
                return GLib.SOURCE_CONTINUE;
            });
            return GLib.SOURCE_REMOVE;
        });
        this._esperaMonitores = 0;
        Main.layoutManager.connectObject('monitors-changed', () => {
            if (this._esperaMonitores)
                GLib.source_remove(this._esperaMonitores);
            this._esperaMonitores = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ESPERA_MONITORES, () => {
                this._esperaMonitores = 0;
                this._alCambiarMonitores();
                return GLib.SOURCE_REMOVE;
            });
        }, this);
        this._pendiente = false;
        this._settings.connectObject(
            // Si apagaste el cambio automático y lo prendes, cambia si ya pasaron los 30 min.
            'changed::auto', () => this._revisar(),
            // Al elegir otra fuente, fondo nuevo de inmediato (por si el actual no te gusta).
            'changed::fuente', () => this.cambiar({manual: true}),
            this);
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        for (const id of [this._revision, this._esperaMonitores]) {
            if (id)
                GLib.source_remove(id);
        }
        this._revision = this._esperaMonitores = 0;
        cancelarRefrescoBarra();
        this._proceso?.force_exit();
        this._proceso = null;
        this._indicador?.destroy();
        this._indicador = null;
        this._settings = null;
        ICONO = null;
    }

    _revisar() {
        if (this._settings.get_boolean('auto') && ahora() - this._settings.get_int64('ultimo-cambio') >= CAMBIAR_CADA)
            this.cambiar({manual: false});
    }

    _alCambiarMonitores() {
        // La barra ya está en su monitor: que Blur my Shell rehaga su difuminado.
        refrescarBarraDifuminada();
        // Mismas pantallas que el fondo actual: nada que hacer.
        if (!this.estado || JSON.stringify(leerPantallas()) === JSON.stringify(this.estado.pantallas))
            return;
        this.cambiar({manual: false, reusar: true});
    }

    _actualizar() {
        this._indicador?.interruptor.actualizar();
    }

    // Corre componer.js y, si sale bien, pone el resultado de fondo (y de pantalla de bloqueo).
    async cambiar({manual, reusar = false}) {
        if (this.ocupado) {
            // Ya está buscando: cuando termine, busca otra vez con la fuente nueva.
            if (manual)
                this._pendiente = true;
            return;
        }
        this.ocupado = true;
        this.error = null;
        this._actualizar();
        const pantallas = leerPantallas();
        try {
            const resultado = await this._componer({
                fuente: this._settings.get_string('fuente'), carpeta: this.carpeta, pantallas, reusar,
                anteriores: this.estado?.fotos ?? [],
            });
            if (!this._settings)
                return; // se apagó la extensión mientras tanto
            const uri = Gio.File.new_for_path(resultado.archivo).get_uri();
            const fondo = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            fondo.set_string('picture-options', 'spanned');
            fondo.set_string('picture-uri', uri);
            fondo.set_string('picture-uri-dark', uri);
            const bloqueo = new Gio.Settings({schema_id: 'org.gnome.desktop.screensaver'});
            bloqueo.set_string('picture-options', 'spanned');
            bloqueo.set_string('picture-uri', uri);

            this.estado = {archivo: resultado.archivo, fotos: resultado.fotos, pantallas};
            refrescarBarraDifuminada();
            this._settings.set_string('estado', JSON.stringify(this.estado));
            if (!reusar)
                this._settings.set_int64('ultimo-cambio', ahora());
            if (resultado.avisos?.length)
                console.warn(`Fondo del día: ${resultado.avisos.join(' · ')}`);
        } catch (e) {
            this.error = e.message.length > 60 ? 'sin internet o sin fondo' : e.message;
            console.warn(`Fondo del día: ${e.message}`);
            if (manual)
                Main.notifyError('Fondo del día', `No pude cambiar el fondo: ${e.message}`);
        } finally {
            this.ocupado = false;
            this._actualizar();
            if (this._pendiente && this._settings) {
                this._pendiente = false;
                this.cambiar({manual: true});
            }
        }
    }

    _componer(entrada) {
        const gjs = GLib.find_program_in_path('gjs') ?? '/usr/bin/gjs';
        const argv = [gjs, '-m', GLib.build_filenamev([this.path, 'componer.js']), JSON.stringify(entrada)];
        return new Promise((resolver, rechazar) => {
            let proceso;
            try {
                proceso = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            } catch (e) {
                rechazar(new Error(`No pude correr gjs: ${e.message}`));
                return;
            }
            this._proceso = proceso;
            proceso.communicate_utf8_async(null, null, (_p, res) => {
                this._proceso = null;
                try {
                    const [, salida, errores] = proceso.communicate_utf8_finish(res);
                    let datos = null;
                    try {
                        datos = JSON.parse(salida.trim().split('\n').at(-1));
                    } catch {
                        datos = null;
                    }
                    if (datos?.archivo)
                        resolver(datos);
                    else
                        rechazar(new Error(datos?.error ?? (errores.trim().split('\n').at(-1) || 'componer.js no respondió')));
                } catch (e) {
                    rechazar(e);
                }
            });
        });
    }
}
