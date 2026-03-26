#!/bin/bash
# Fix XMTP native bindings on macOS - patches nix libiconv reference to system path
for f in $(find node_modules -name "bindings_node.darwin-arm64.node" 2>/dev/null); do
  nix_path=$(otool -L "$f" 2>/dev/null | grep nix | awk '{print $1}')
  if [ -n "$nix_path" ]; then
    install_name_tool -change "$nix_path" "/usr/lib/libiconv.2.dylib" "$f" 2>/dev/null
    codesign -f -s - "$f" 2>/dev/null
    echo "Patched: $f"
  fi
done
