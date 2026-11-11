#!/bin/zsh
set -e
cd "${0:A:h}"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 24
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run voice:setup
npm run voice:start
