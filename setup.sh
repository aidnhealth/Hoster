#!/usr/bin/env bash
# OPTIONAL host setup for Hoster: wildcard LAN DNS + start-on-login.
#
# Hoster works without this. By default apps live on *.hoster.localhost, which
# browsers resolve on their own. Run this only when you want other devices on
# your network to reach your apps, or want Hoster to start when you log in.
#
# Run with: sudo ./setup.sh
set -euo pipefail

DOMAIN="${HOSTER_DOMAIN:-hoster.local}"
REAL_USER="${SUDO_USER:-$USER}"
USER_HOME=$(eval echo "~$REAL_USER")
HOSTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(command -v node)"

if [[ $EUID -ne 0 ]]; then
  echo "run this with sudo: sudo ./setup.sh" >&2; exit 1
fi

echo "==> installing dnsmasq"
sudo -u "$REAL_USER" brew install dnsmasq >/dev/null 2>&1 || true
BREW_PREFIX="$(sudo -u "$REAL_USER" brew --prefix)"

echo "==> pointing *.$DOMAIN at this machine"
mkdir -p "$BREW_PREFIX/etc"
CONF="$BREW_PREFIX/etc/dnsmasq.d/hoster.conf"
mkdir -p "$(dirname "$CONF")"
echo "address=/$DOMAIN/127.0.0.1" > "$CONF"
grep -q "conf-dir=$BREW_PREFIX/etc/dnsmasq.d" "$BREW_PREFIX/etc/dnsmasq.conf" 2>/dev/null \
  || echo "conf-dir=$BREW_PREFIX/etc/dnsmasq.d/,*.conf" >> "$BREW_PREFIX/etc/dnsmasq.conf"

# macOS only consults dnsmasq for a domain listed under /etc/resolver.
mkdir -p /etc/resolver
printf "nameserver 127.0.0.1\n" > "/etc/resolver/$DOMAIN"

brew services restart dnsmasq >/dev/null 2>&1 \
  || sudo -u "$REAL_USER" brew services restart dnsmasq >/dev/null 2>&1 || true

echo "==> installing start-on-login agent"
PLIST="$USER_HOME/Library/LaunchAgents/com.hoster.control.plist"
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hoster.control</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$HOSTER_DIR/src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$HOSTER_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$USER_HOME/.hoster/logs/control.log</string>
  <key>StandardErrorPath</key><string>$USER_HOME/.hoster/logs/control.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$BREW_PREFIX/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOSTER_DOMAIN</key><string>$DOMAIN</string>
  </dict>
</dict>
</plist>
PLISTEOF
chown "$REAL_USER" "$PLIST"
mkdir -p "$USER_HOME/.hoster/logs" && chown -R "$REAL_USER" "$USER_HOME/.hoster"

sudo -u "$REAL_USER" launchctl unload "$PLIST" 2>/dev/null || true
sudo -u "$REAL_USER" launchctl load "$PLIST"

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")

cat <<DONE

Setup complete.

  Run Hoster with  HOSTER_DOMAIN=$DOMAIN npm start

  Dashboard        http://$DOMAIN
  This machine     https://<app>.$DOMAIN
  Other LAN devices  point their DNS at $LAN_IP, or use http://$LAN_IP with a
                     Host header. Simplest alternative: 'hoster share <app>'.

Apps now restart automatically when you log in.
DONE
