# Disposable native-dependency/runtime test. Always pass a digest-pinned BASE_IMAGE.
# This checks desktop/tools in a container, not systemd boot or host SELinux.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY deploy/platform.sh /checks/platform.sh
RUN bash -c 'set -euo pipefail; source /checks/platform.sh; agentvps_detect_platform; agentvps_install_system_packages'
RUN set -eu; \
    case "$(uname -m)" in \
      x86_64) arch=x64; sha=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de ;; \
      aarch64) arch=arm64; sha=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f ;; \
      *) exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 "https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-${arch}.tar.xz" -o /tmp/node.tar.xz; \
    echo "$sha  /tmp/node.tar.xz" | sha256sum -c -; \
    mkdir -p /opt/node; tar -xJf /tmp/node.tar.xz --strip-components=1 -C /opt/node; rm /tmp/node.tar.xz
ENV PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COPY runtime.tgz /tmp/runtime.tgz
RUN useradd --system --create-home --home-dir /var/lib/agentvps --shell /bin/bash agentvps; \
    mkdir -p /opt/agentvps/browsers; chown -R agentvps:agentvps /opt/agentvps; \
    chmod 644 /tmp/runtime.tgz; \
    runuser -u agentvps -- env HOME=/var/lib/agentvps npm install --prefix /opt/agentvps --omit=dev --no-audit --no-fund /tmp/runtime.tgz
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/agentvps/browsers
RUN bash -c 'set -euo pipefail; source /checks/platform.sh; agentvps_detect_platform; \
    if [[ $agentvps_package_manager == apt ]]; then \
      /opt/agentvps/node_modules/.bin/playwright install-deps chromium; \
      runuser -u agentvps -- env HOME=/var/lib/agentvps PATH="$PATH" PLAYWRIGHT_BROWSERS_PATH=/opt/agentvps/browsers /opt/agentvps/node_modules/.bin/playwright install chromium; \
    else \
      printf "AGENTVPS_BROWSER_EXECUTABLE=%s\n" "$(command -v chromium-browser || command -v chromium)" > /opt/agentvps/browser.env; \
    fi'
USER agentvps
ENV HOME=/var/lib/agentvps AGENTVPS_HOME=/var/lib/agentvps AGENTVPS_DESKTOP=1 AGENTVPS_HOST=0.0.0.0
WORKDIR /var/lib/agentvps
CMD ["bash", "-c", "if [ -f /opt/agentvps/browser.env ]; then set -a; . /opt/agentvps/browser.env; set +a; fi; exec node /opt/agentvps/node_modules/.bin/agentvps serve"]
