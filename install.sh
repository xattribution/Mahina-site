#!/usr/bin/env bash
# Mahina Club: install, update, and remove the site on a Linux server.
#
#   Install:    curl -fsSL https://raw.githubusercontent.com/xattribution/mahina-site/main/install.sh | sudo bash
#   Update:     sudo mahina update
#   Uninstall:  sudo mahina uninstall
#
# Other commands: status, logs, backup, restore <file>, restart, help.
# The whole script lives in functions and runs from the last line, so an update can safely replace this file.

REPO="${MAHINA_REPO:-xattribution/mahina-site}"
BRANCH="${MAHINA_BRANCH:-main}"
REPO_URL="${MAHINA_REPO_URL:-https://github.com/${REPO}.git}"
DIR="${MAHINA_DIR:-/opt/mahina-club}"
BIN="${MAHINA_BIN:-/usr/local/bin/mahina}"
KEEP_BACKUPS="${MAHINA_KEEP_BACKUPS:-10}"
APP_UID=10001

set -Eeuo pipefail

# ---------- output ----------
if [ -t 1 ]; then B=$'\e[1m'; D=$'\e[2m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'; else B=; D=; R=; G=; Y=; N=; fi
say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*" >&2; }
die()  { printf '%s✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

# Questions read from the terminal even when this script arrives through a pipe.
# With no terminal (automation), answers come from environment variables or defaults.
TTY=""
if { : </dev/tty; } 2>/dev/null; then TTY=/dev/tty; fi
ask() { # ask "Question" default -> echoes answer
  local q="$1" def="${2:-}" a=""
  if [ -n "$TTY" ] && [ -z "${MAHINA_YES:-}" ]; then
    if [ -n "$def" ]; then printf '%s %s[%s]%s ' "$q" "$D" "$def" "$N" >/dev/tty; else printf '%s ' "$q" >/dev/tty; fi
    IFS= read -r a </dev/tty || true
  fi
  printf '%s' "${a:-$def}"
}
confirm() { # confirm "Question" -> 0 if yes
  [ -n "${MAHINA_YES:-}" ] && return 0
  [ -n "$TTY" ] || return 1
  local a; a="$(ask "$1 [y/N]" "")"
  [[ "$a" =~ ^[Yy] ]]
}

# ---------- checks ----------
need_root() { [ "$(id -u)" -eq 0 ] || die "Run this with sudo."; }
installed() { [ -f "$DIR/docker-compose.yml" ] && [ -d "$DIR/.git" ]; }
need_installed() { installed || die "The Mahina Club isn't installed in $DIR."; }
compose() { (cd "$DIR" && docker compose --progress quiet "$@"); }
env_get() { [ -f "$DIR/.env" ] && sed -n "s/^$1=//p" "$DIR/.env" | tail -n1 || true; }

pkg_install() {
  if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q "$@"
  elif command -v yum >/dev/null; then yum install -y -q "$@"
  elif command -v apk >/dev/null; then apk add --no-cache -q "$@"
  elif command -v pacman >/dev/null; then pacman -Sy --noconfirm --needed "$@" >/dev/null
  elif command -v zypper >/dev/null; then zypper -q install -y "$@"
  else die "Install these first: $*"; fi
}

ensure_tools() {
  [ "$(uname -s)" = "Linux" ] || die "This installer runs on Linux. On other systems, use docker compose (see README)."
  local missing=()
  for t in git curl tar; do command -v "$t" >/dev/null || missing+=("$t"); done
  if [ ${#missing[@]} -gt 0 ]; then step "Installing ${missing[*]}"; pkg_install "${missing[@]}"; fi
  if ! command -v docker >/dev/null; then
    step "Installing Docker (official script from get.docker.com)"
    curl -fsSL https://get.docker.com | sh >/dev/null
  fi
  if command -v systemctl >/dev/null && ! docker info >/dev/null 2>&1; then systemctl enable --now docker >/dev/null 2>&1 || true; fi
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start it and try again."
  if ! docker compose version >/dev/null 2>&1; then
    step "Installing the Docker Compose plugin"
    pkg_install docker-compose-plugin || die "Install the Docker Compose plugin, then try again."
  fi
}

local_url() {
  local port bind; port="$(env_get MAHINA_PORT)"; bind="$(env_get MAHINA_BIND)"
  case "${bind:-0.0.0.0}" in 0.0.0.0|::|"") bind=127.0.0.1 ;; esac
  printf 'http://%s:%s' "$bind" "${port:-8080}"
}

wait_healthy() { # up to 2 minutes; gives up early if the container keeps crashing
  local _ restarts
  for _ in $(seq 1 60); do
    if curl -fsS "$(local_url)/healthz" >/dev/null 2>&1; then return 0; fi
    restarts="$(docker inspect -f '{{.RestartCount}}' mahina-club 2>/dev/null || echo 0)"
    [ "${restarts:-0}" -ge 2 ] && return 1
    sleep 2
  done
  return 1
}

# ---------- backups ----------
make_backup() { # make_backup [dest_dir] -> echoes file path
  local dest="${1:-$DIR/backups}" stamp file
  mkdir -p "$dest"; chmod 700 "$dest"
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$dest/mahina-$stamp.tar.gz"
  # SQLite is consistent to copy while the app runs (WAL mode); the -wal file is included.
  tar -czf "$file" -C "$DIR" data .env 2>/dev/null || tar -czf "$file" -C "$DIR" data
  chmod 600 "$file"
  printf '%s' "$file"
}

prune_backups() { # keep the newest $KEEP_BACKUPS (names sort by date)
  local files=() i
  shopt -s nullglob; files=("$DIR"/backups/mahina-*.tar.gz); shopt -u nullglob
  for ((i = 0; i < ${#files[@]} - KEEP_BACKUPS; i++)); do rm -f "${files[$i]}"; done
  return 0
}

# ---------- configuration ----------
set_env() { # set_env KEY VALUE  (adds or replaces a line in .env)
  local k="$1" v="$2" f="$DIR/.env" tmp
  tmp="$(mktemp)"
  if grep -q "^$k=" "$f"; then
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$f" >"$tmp"
  else
    cat "$f" >"$tmp"; printf '%s=%s\n' "$k" "$v" >>"$tmp"
  fi
  cat "$tmp" >"$f"; rm -f "$tmp"
}

merge_new_settings() { # add settings that newer versions introduced, keeping the user's values
  local line k added=0
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)= ]] || continue
    k="${BASH_REMATCH[1]}"
    if ! grep -q "^$k=" "$DIR/.env"; then printf '%s\n' "$line" >>"$DIR/.env"; added=$((added + 1)); fi
  done <"$DIR/.env.example"
  [ "$added" -gt 0 ] && ok "Added $added new setting(s) to .env"
  return 0
}

first_config() {
  local ip url port seed
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; ip="${ip:-localhost}"
  say ""
  say "${B}A few questions.${N} Press Enter to take the default."
  port="$(ask "Port for the site:" "${MAHINA_PORT:-8080}")"
  url="$(ask "Public address people will use:" "${MAHINA_SITE_URL:-http://$ip:$port}")"
  seed="n"; if [ "${MAHINA_SEED:-0}" = "1" ]; then seed="y"; fi
  seed="$(ask "Load sample events and photos to look around? (y/N)" "$seed")"
  cp "$DIR/.env.example" "$DIR/.env"
  chmod 600 "$DIR/.env"
  set_env SITE_URL "${url%/}"
  set_env MAHINA_PORT "$port"
  set_env SECRET_KEY "$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | cut -c1-48)"
  if [[ "$seed" =~ ^[Yy1] ]]; then set_env MAHINA_SEED 1; else set_env MAHINA_SEED 0; fi
  [ -n "${MAHINA_ADMIN_EMAIL:-}" ] && set_env ADMIN_EMAIL "$MAHINA_ADMIN_EMAIL"
  return 0
}

install_cli() {
  chmod +x "$DIR/install.sh"
  mkdir -p "$(dirname "$BIN")"
  ln -sf "$DIR/install.sh" "$BIN"
}

# ---------- commands ----------
cmd_install() {
  need_root
  if installed; then
    warn "Already installed in $DIR. Updating instead."
    cmd_update; return
  fi
  ensure_tools
  step "Downloading the Mahina Club into $DIR"
  [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && die "$DIR exists and isn't empty. Move it aside, or set MAHINA_DIR."
  git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$DIR" || die "Couldn't download $REPO_URL."
  first_config
  mkdir -p "$DIR/data" "$DIR/backups"; chmod 700 "$DIR/backups"
  chown -R "$APP_UID:$APP_UID" "$DIR/data"
  step "Building and starting (the first build takes a few minutes)"
  compose up -d --build --quiet-pull >/dev/null
  install_cli
  if wait_healthy; then ok "The site is running."; else warn "The site didn't answer yet. Check with: sudo mahina logs"; fi
  local url; url="$(env_get SITE_URL)"
  say ""
  say "${B}Open ${url}/login${N} to create the first admin account."
  say ""
  say "  Update:     sudo mahina update"
  say "  Uninstall:  sudo mahina uninstall"
  say "  More:       sudo mahina help"
  say ""
  say "Settings are in $DIR/.env. Email and sign-in options are explained in the README."
}

cmd_update() {
  need_root; need_installed; ensure_tools
  cd "$DIR"
  local old new file
  old="$(git rev-parse HEAD)"
  step "Backing up your data"
  file="$(make_backup)"; prune_backups
  ok "Saved $file"
  step "Downloading the latest version"
  git fetch -q --depth 1 origin "$BRANCH" || die "Couldn't reach $(git remote get-url origin)."
  new="$(git rev-parse FETCH_HEAD)"
  if [ "$old" = "$new" ] && [ -z "${MAHINA_FORCE:-}" ]; then ok "Already up to date ($(git log -1 --format=%cs "$old"))."; return; fi
  git reset -q --hard "$new"   # your data/, backups/ and .env are not tracked by git, so they stay as they are
  merge_new_settings
  chown -R "$APP_UID:$APP_UID" "$DIR/data"
  step "Rebuilding and restarting"
  compose up -d --build --remove-orphans --quiet-pull >/dev/null
  if wait_healthy; then
    docker image prune -f >/dev/null 2>&1 || true
    ok "Updated to $(git log -1 --format='%h from %cs')."
  else
    warn "The new version didn't start. Going back to the previous one."
    git reset -q --hard "$old"
    compose up -d --build --remove-orphans >/dev/null
    if wait_healthy; then warn "Back on the previous version. Your data backup is $file"; else die "The site isn't starting. See: sudo mahina logs. Backup: $file"; fi
    exit 1
  fi
}

cmd_uninstall() {
  need_root; need_installed
  local purge="" yes="" a
  for a in "$@"; do case "$a" in --purge) purge=1 ;; --yes|-y) yes=1 ;; *) die "Unknown option: $a" ;; esac; done
  if [ -z "$yes" ] && [ -z "${MAHINA_YES:-}" ]; then
    [ -n "$TTY" ] || die "Add --yes to uninstall without a prompt."
    say "This stops the site and removes it from $DIR."
    if [ -n "$purge" ]; then say "${R}--purge deletes all club data with no backup.${N}"; else say "Your data is saved to a backup file first."; fi
    a="$(ask "Type ${B}uninstall${N} to continue:" "")"
    [ "$a" = "uninstall" ] || die "Nothing was changed."
  fi
  local file=""
  if [ -z "$purge" ]; then
    step "Saving a final backup"
    file="$(make_backup "${MAHINA_FINAL_BACKUP_DIR:-$HOME}")"
    ok "Saved $file"
  fi
  step "Stopping and removing the site"
  compose down --rmi all --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$DIR"
  if [ -L "$BIN" ] || [ -f "$BIN" ]; then rm -f "$BIN"; fi
  ok "The Mahina Club is uninstalled. Docker was left in place."
  [ -n "$file" ] && say "To bring it back later: install again, then run: sudo mahina restore $file"
  return 0
}

cmd_backup() {
  need_root; need_installed
  local file; file="$(make_backup)"; prune_backups
  ok "Saved $file"
}

cmd_restore() {
  need_root; need_installed
  local file="${1:-}"
  [ -n "$file" ] && [ -f "$file" ] || die "Give the backup file: sudo mahina restore /path/to/mahina-YYYYMMDD-HHMMSS.tar.gz"
  local list; list="$(tar -tzf "$file" 2>/dev/null)" || die "Couldn't read $file."
  grep -q '^data/' <<<"$list" || die "That file isn't a Mahina Club backup."
  if [ -z "${MAHINA_YES:-}" ]; then
    confirm "Replace the current data with $file? A backup of the current data is made first." || die "Nothing was changed."
  fi
  local safety; safety="$(make_backup)"
  ok "Current data saved to $safety"
  step "Restoring"
  compose stop >/dev/null 2>&1 || true
  rm -rf "$DIR/data"
  tar -xzf "$file" -C "$DIR" data
  if grep -qx '.env' <<<"$list"; then tar -xzf "$file" -C "$DIR" .env; chmod 600 "$DIR/.env"; merge_new_settings; fi
  chown -R "$APP_UID:$APP_UID" "$DIR/data"
  compose up -d >/dev/null
  if wait_healthy; then ok "Restored."; else warn "Restored, but the site didn't answer yet. See: sudo mahina logs"; fi
}

cmd_status() {
  need_root; need_installed
  cd "$DIR"
  say "${B}Mahina Club${N} in $DIR"
  say "  Version:  $(git log -1 --format='%h from %cs')"
  say "  Address:  $(env_get SITE_URL)"
  if curl -fsS "$(local_url)/healthz" >/dev/null 2>&1; then say "  Status:   ${G}running${N}"; else say "  Status:   ${R}not responding${N}"; fi
  # shellcheck disable=SC2012
  say "  Backups:  $(ls -1 "$DIR"/backups/mahina-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') in $DIR/backups"
}

cmd_logs() { need_root; need_installed; compose logs --tail 200 -f; }
cmd_restart() { need_root; need_installed; compose restart >/dev/null; wait_healthy && ok "Restarted." || warn "Restarted, but the site isn't answering yet."; }

cmd_help() {
  cat <<EOF
${B}mahina${N} manages the Mahina Club site in $DIR

  sudo mahina update              Back up, download the latest version, restart
  sudo mahina uninstall           Remove the site (keeps a backup file; add --purge to skip it)
  sudo mahina backup              Save a backup to $DIR/backups
  sudo mahina restore <file>      Put a backup back
  sudo mahina restart             Restart the site
  sudo mahina status              Version, address, and whether it's running
  sudo mahina logs                Follow the site's logs

Settings live in $DIR/.env. After changing them: sudo mahina restart
EOF
}

main() {
  local cmd="${1:-}"
  [ $# -gt 0 ] && shift
  if [ -z "$cmd" ]; then if installed; then cmd=status; else cmd=install; fi; fi
  case "$cmd" in
    install) cmd_install ;;
    update|upgrade) cmd_update ;;
    uninstall|remove) cmd_uninstall "$@" ;;
    backup) cmd_backup ;;
    restore) cmd_restore "$@" ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    restart) cmd_restart ;;
    help|-h|--help) cmd_help ;;
    *) die "Unknown command: $cmd (try: mahina help)" ;;
  esac
}

main "$@"; exit $?
