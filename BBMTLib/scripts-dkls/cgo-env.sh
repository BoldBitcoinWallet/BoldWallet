#!/bin/bash
# Platform CGO flags for libtss-ffi. Source after ROOT / LIBTSS_RELEASE are set.
#   LIBTSS_RELEASE="${ROOT}/../../libtss/target/release"
#   source "${ROOT}/scripts-dkls/cgo-env.sh"

export CGO_ENABLED=1

_cgo_libtss_release="${LIBTSS_RELEASE:-}"
if [ -z "${_cgo_libtss_release}" ]; then
  _script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _bbmt_root="$(cd "${_script_dir}/.." && pwd)"
  _cgo_libtss_release="${_bbmt_root}/../../libtss/target/release"
fi

case "$(uname -s)" in
  Darwin)
    export CGO_LDFLAGS="-L${_cgo_libtss_release} -llibtss_ffi -lm -framework Security -framework CoreFoundation"
    ;;
  Linux)
    export CGO_LDFLAGS="-L${_cgo_libtss_release} -l:liblibtss_ffi.a -ldl -lm -lpthread"
    ;;
  *)
    export CGO_LDFLAGS="-L${_cgo_libtss_release} -llibtss_ffi -ldl -lm -lpthread"
    ;;
esac

unset _cgo_libtss_release _script_dir _bbmt_root
