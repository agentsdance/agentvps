#!/usr/bin/env bash
# Run serial, resource-bounded native Linux fixtures on a Linux Docker host.
# Usage: AGENTVPS_PACKAGE=/path/to/runtime.tgz bash test/linux-matrix.sh rocky9 alma9
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'Use a Linux Docker host with Node.js and npm ci completed.' >&2; exit 1; }
[[ $# -gt 0 && -f ${AGENTVPS_PACKAGE:-} ]] || { echo 'Provide matrix keys and AGENTVPS_PACKAGE.' >&2; exit 1; }
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
context=$(mktemp -d)
token_file=$(mktemp)
container=''
cleanup() {
  if [[ -n $container && -n ${output:-} ]]; then docker logs "$container" > "$output/runtime.log" 2>&1 || true; fi
  [[ -z $container ]] || docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$context"
  rm -f "$token_file"
}
trap cleanup EXIT
mkdir -p "$context/deploy" "$context/test" test-results/linux-matrix
tar -xOf "$AGENTVPS_PACKAGE" package/deploy/platform.sh > "$context/deploy/platform.sh"
cp test/linux.Dockerfile "$context/test/"
cp "$AGENTVPS_PACKAGE" "$context/runtime.tgz"
for entry in "$@"; do
  base=$(node -e 'const p=require("./test/linux-images.json"); const v=p[process.argv[1]]; if(!v || !/@sha256:[a-f0-9]{64}$/.test(v)) process.exit(1); console.log(v)' "$entry")
  case "$entry" in ubuntu*) distro=ubuntu ;; debian*) distro=debian ;; rocky*) distro=rocky ;; alma*) distro=almalinux ;; centos*) distro=centos ;; *) exit 1 ;; esac
  output="$root/test-results/linux-matrix/$entry"
  mkdir -p "$output"
  printf 'BUILD %s (%s)\n' "$entry" "$base"
  if ! docker build --memory=900m --memory-swap=1600m --cpu-period=100000 --cpu-quota=100000 \
    --build-arg "BASE_IMAGE=$base" -f "$context/test/linux.Dockerfile" -t "agentvps-test:$entry" "$context" > "$output/build.log" 2>&1; then
    tail -n 35 "$output/build.log"; exit 1
  fi
  container="agentvps-matrix-${entry}-$$"
  docker run -d --name "$container" --memory=768m --memory-swap=1g --cpus=1 --pids-limit=256 --shm-size=256m \
    -p 127.0.0.1:18080:8080 -p 127.0.0.1:18081:8081 "agentvps-test:$entry" > /dev/null
  ready=false
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 2 http://127.0.0.1:18080/healthz >/dev/null 2>&1; then ready=true; break; fi
    [[ $(docker inspect -f '{{.State.Running}}' "$container") == true ]] || break
    sleep 1
  done
  if [[ $ready != true ]]; then docker logs --tail 35 "$container"; exit 1; fi
  docker exec "$container" cat /var/lib/agentvps/token > "$token_file"
  export AGENTVPS_URL=http://127.0.0.1:18080 AGENTVPS_TOKEN_FILE="$token_file" AGENTVPS_EXPECT_DISTRO="$distro" AGENTVPS_EXPECT_PLATFORM=linux
  export AGENTVPS_TEST_OUTPUT="$output" AGENTVPS_TEST_API_ONLY=1 AGENTVPS_TEST_PREVIEW_URL=http://127.0.0.1:18081
  printf 'TEST %s\n' "$entry"
  timeout 180s node test/linux-mcp.mjs
  timeout 180s node --import tsx test/e2e.ts
  printf '%s\n' "$base" > "$output/base-image.txt"
  sha256sum "$context/runtime.tgz" > "$output/package-sha256.txt"
  docker logs "$container" > "$output/runtime.log" 2>&1
  docker rm -f "$container" >/dev/null
  container=''
  printf 'PASS %s\n' "$entry"
done
