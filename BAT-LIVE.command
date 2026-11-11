#!/bin/zsh
set -e
cd "${0:A:h}"

# Finder doesn't necessarily inherit the terminal's nvm configuration.
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 24 || { print 'Cần Node 24: chạy nvm install 24 rồi mở lại file này.'; exit 1; }
fi
if ! command -v node >/dev/null 2>&1; then
  print 'Chưa tìm thấy Node.js. Cài Node 24 rồi mở lại file này.'
  exit 1
fi
LIVE_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$LIVE_NODE_MAJOR" != 24 ]]; then
  print 'Cần Node 24 theo .nvmrc. Chạy nvm use 24 rồi mở lại file này.'
  exit 1
fi
LIVE_PORT="${PORT:-3002}"
if curl -fsS --max-time 2 "http://localhost:$LIVE_PORT/api/status" >/dev/null 2>&1; then
  print "Ứng dụng đã chạy tại http://localhost:$LIVE_PORT"
  open "http://localhost:$LIVE_PORT"
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi
npm run build
print "Bảng điều khiển: http://localhost:$LIVE_PORT"
print "Link LIVE Studio: http://lvh.me:$LIVE_PORT/?view=stage (1080 x 1920)"
print 'Đóng cửa sổ này hoặc nhấn Ctrl+C để dừng ứng dụng.'
print 'Đo RAM: MEMORY_DIAGNOSTICS=1 ./BAT-LIVE.command'
npm start
