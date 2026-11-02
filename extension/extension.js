// Fondo del día: cada mañana pone fotos nuevas de Unsplash y de la NASA, una por pantalla y con la
// forma de cada una (ultrawide, vertical, normal). Se controla desde los Ajustes rápidos (el menú
// del wifi y la batería): prender o apagar el cambio diario, otro fondo ahora, de dónde salen las
// fotos y quién las tomó. El trabajo pesado (bajar y recortar) lo hace componer.js aparte.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const ICONO = 'preferences-desktop-wallpaper-symbolic';
const REVISAR_CADA = 15 * 60; // s: si cambió el día (o volviste de suspender), cambia el fondo
const PRIMERA_REVISION = 20; // s tras entrar: deja que arranque la red
const ESPERA_MONITORES = 4; // s: al conectar un monitor llegan varios avisos seguidos
const FUENTES = [['ambas', 'Unsplash y NASA'], ['unsplash', 'Solo Unsplash'], ['nasa', 'Solo NASA']];

const hoy = () => GLib.DateTime.new_now_local().format('%Y-%m-%d');

function abrir(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        Main.notifyError('Fondo del día', `No pude abrir ${uri}: ${e.message}`);
    }
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
        super._init({title: 'Fondo del día', iconName: ICONO, toggleMode: true});
        this._ext = ext;
        this._settings = ext.getSettings();
        this._settings.bind('auto', this, 'checked', Gio.SettingsBindFlags.DEFAULT);
        this.menu.setHeader(ICONO, 'Fondo del día');

        this._otro = new PopupMenu.PopupImageMenuItem('Otro fondo ahora', 'view-refresh-symbolic');
        this._otro.connect('activate', () => ext.cambiar({manual: true}));
        this.menu.addMenuItem(this._otro);

        this._fotos = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Fotos de ahora'));
        this.menu.addMenuItem(this._fotos);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('De dónde'));
        this._fuentes = FUENTES.map(([clave, nombre]) => {
            const item = new PopupMenu.PopupMenuItem(nombre);
            item.connect('activate', () => this._settings.set_string('fuente', clave));
            this.menu.addMenuItem(item);
            return [clave, item];
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const carpeta = new PopupMenu.PopupImageMenuItem('Abrir la carpeta de fotos', 'folder-pictures-symbolic');
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
        this.subtitle = ocupado ? 'Buscando fotos…' : nombreFuente.replace('Solo ', '');
        this.menu.setHeader(ICONO, 'Fondo del día',
            ocupado ? 'Buscando fotos…' : auto ? 'Cambia cada mañana' : 'Apagado: el fondo no cambia solo');
        this._otro.label.text = ocupado ? 'Buscando fotos…' : error ? `Reintentar (${error})` : 'Otro fondo ahora';
        this._otro.setSensitive(!ocupado);
        for (const [clave, item] of this._fuentes)
            item.setOrnament(clave === fuente ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);

        this._fotos.removeAll();
        const fotos = this._ext.estado?.fotos ?? [];
        if (fotos.length === 0) {
            const vacio = new PopupMenu.PopupMenuItem('Todavía no hay fotos', {reactive: false});
            this._fotos.addMenuItem(vacio);
        }
        for (const f of fotos) {
            const donde = fotos.length > 1 ? `Pantalla ${f.pantalla}${f.vertical ? ' (vertical)' : ''}: ` : '';
            const item = new PopupMenu.PopupImageMenuItem(`${donde}${f.titulo} · ${f.fuente}`, 'web-browser-symbolic');
            item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            item.connect('activate', () => abrir(f.enlace));
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
        // Si apagaste el cambio diario y lo vuelves a prender, el fondo cambia ese mismo día.
        this._settings.connectObject('changed::auto', () => this._revisar(), this);
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        for (const id of [this._revision, this._esperaMonitores]) {
            if (id)
                GLib.source_remove(id);
        }
        this._revision = this._esperaMonitores = 0;
        this._proceso?.force_exit();
        this._proceso = null;
        this._indicador?.destroy();
        this._indicador = null;
        this._settings = null;
    }

    _revisar() {
        if (this._settings.get_boolean('auto') && this._settings.get_string('ultimo-dia') !== hoy())
            this.cambiar({manual: false});
    }

    _alCambiarMonitores() {
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
        if (this.ocupado)
            return;
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
            this._settings.set_string('estado', JSON.stringify(this.estado));
            if (!reusar)
                this._settings.set_string('ultimo-dia', hoy());
            if (resultado.avisos?.length)
                console.warn(`Fondo del día: ${resultado.avisos.join(' · ')}`);
        } catch (e) {
            this.error = e.message.length > 60 ? 'sin internet o sin foto' : e.message;
            console.warn(`Fondo del día: ${e.message}`);
            if (manual)
                Main.notifyError('Fondo del día', `No pude cambiar el fondo: ${e.message}`);
        } finally {
            this.ocupado = false;
            this._actualizar();
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
