#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "=== Publicar o Maré no Firebase ==="
echo ""
if ! command -v node >/dev/null 2>&1; then
  echo "Falta instalar o Node.js. Baixe a versão LTS em https://nodejs.org, instale e rode este arquivo de novo."
  read -p "Tecle Enter para sair"; exit 1
fi
read -p "Cole o ID do projeto Firebase e tecle Enter: " PROJ
echo ""; echo "[1/3] Entrando na sua conta Google (vai abrir o navegador)..."
npx -y firebase-tools@latest login
echo ""; echo "[2/3] Preparando os avisos..."
npm --prefix functions install --no-audit --no-fund
echo ""; echo "[3/3] Publicando. Isso leva alguns minutos..."
npx -y firebase-tools@latest deploy --project "$PROJ" --force
echo ""
echo "Se apareceu \"Deploy complete\", abra no celular: https://$PROJ.web.app"
echo "Se apareceu erro de primeira vez, espere 5 minutos e rode este arquivo de novo."
read -p "Tecle Enter para sair"
