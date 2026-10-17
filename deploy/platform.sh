#!/usr/bin/env bash
# Shared by the package installer and compatibility checks. No work at source time.
agentvps_detect_platform() {
  local os_release=${1:-/etc/os-release}
  local ID='' VERSION_ID='' PRETTY_NAME='Linux'
  source "$os_release"
  agentvps_distribution=$ID
  agentvps_distribution_version=$VERSION_ID
  case "$ID:$VERSION_ID" in
    ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) agentvps_package_manager=apt ;;
    rocky:9|rocky:9.*|almalinux:9|almalinux:9.*|centos:9|centos:9.*|rhel:9|rhel:9.*) agentvps_package_manager=dnf ;;
    *) echo "Unsupported system: $PRETTY_NAME. See https://agentvps.ai-infra.org/#install for supported Linux versions." >&2; return 1 ;;
  esac
  printf 'Installing AgentVPS on %s.\n' "$PRETTY_NAME"
}

agentvps_install_system_packages() {
  if [[ $agentvps_package_manager == apt ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils python3 python3-venv build-essential
    apt-get install -y --no-install-recommends tigervnc-standalone-server openbox tint2 thunar xfce4-terminal x11vnc xdotool wmctrl x11-utils x11-xserver-utils xauth feh dbus-x11 scrot librsvg2-bin adwaita-icon-theme-full fonts-dejavu-core
  else
    # Cloud images often ship curl-minimal, which already provides HTTPS and
    # conflicts with the full curl RPM. Keep it rather than erasing packages.
    if ! command -v curl >/dev/null 2>&1; then dnf install -y curl; fi
    dnf install -y dnf-plugins-core ca-certificates xz python3 gcc-c++ make
    if [[ $agentvps_distribution == rhel ]]; then
      # Requires the user's existing Red Hat subscription; never registers an account.
      subscription-manager repos --enable "codeready-builder-for-rhel-9-$(uname -m)-rpms"
    else
      dnf config-manager --set-enabled crb
    fi
    if ! rpm -q epel-release >/dev/null 2>&1; then
      if [[ $agentvps_distribution == rhel || $agentvps_distribution == centos ]]; then
        dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-9.noarch.rpm
      else
        dnf install -y epel-release
      fi
    fi
    dnf install -y tigervnc-server-minimal openbox tint2 Thunar xfce4-terminal x11vnc xdotool wmctrl xorg-x11-utils xorg-x11-server-utils xorg-x11-xauth ImageMagick dbus-x11 librsvg2-tools adwaita-icon-theme dejavu-sans-fonts dejavu-sans-mono-fonts chromium
  fi
}
