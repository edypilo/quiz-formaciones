#!/bin/bash
# Doble clic para abrir el Quiz en Mac.
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Falta Node.js, el programa que necesita esta aplicación."
  echo "  Se va a abrir su página de descarga: instala la versión LTS"
  echo "  y después vuelve a abrir este archivo."
  echo
  open "https://nodejs.org/es/download"
  read -r -p "  Pulsa Enter para cerrar…"
  exit 1
fi

node iniciar.js
