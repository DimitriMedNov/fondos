#!/usr/bin/env bash
# Instala Fondo del día en tu usuario (sin sudo). Uso: ./install.sh   |   ./install.sh --quitar
set -euo pipefail
cd "$(dirname "$0")"

UUID="fondos@dimitrimednov.github.io"
EXT="$HOME/.local/share/gnome-shell/extensions/$UUID"

if [ "${1:-}" = "--quitar" ]; then
  gnome-extensions disable "$UUID" 2>/dev/null || true
  rm -rf "$EXT"
  echo "Fondo del día quitado. Tu fondo actual se queda como está."
  exit 0
fi

command -v glib-compile-schemas >/dev/null || { echo "Falta glib-compile-schemas (paquete glib2)."; exit 1; }

# Si GNOME aún no conoce la extensión (recién copiada), "enable" falla: se agrega a mano a la lista
# de extensiones activas para que cargue al volver a entrar.
activar() {
  gnome-extensions enable "$UUID" 2>/dev/null && return
  python3 - "$UUID" <<'PY'
import ast, subprocess, sys
lista = ast.literal_eval(subprocess.check_output(["gsettings", "get", "org.gnome.shell", "enabled-extensions"], text=True).replace("@as ", ""))
if sys.argv[1] not in lista:
    subprocess.check_call(["gsettings", "set", "org.gnome.shell", "enabled-extensions", str(lista + [sys.argv[1]])])
PY
}

mkdir -p "$EXT/schemas"
cp extension/*.js extension/metadata.json "$EXT/"
cp extension/schemas/*.gschema.xml "$EXT/schemas/"
glib-compile-schemas "$EXT/schemas"
activar

echo "Fondo del día instalado. Cierra sesión y vuelve a entrar; el control está en los Ajustes rápidos (arriba a la derecha)."
command -v gjs >/dev/null || echo "Aviso: falta gjs (paquete gjs); sin él no se pueden armar los fondos."
