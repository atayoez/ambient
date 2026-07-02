# Third-Party Licenses

Ambient itself is proprietary (see `LICENSE`). The Ambient binary
distributed to customers bundles the third-party assets and
source-available components listed below. Their respective copyright
and license notices are reproduced here as required by the terms of
their licenses.

---

## Inter (font)

Copyright (c) 2020 The Inter Project Authors
(<https://github.com/rsms/inter>)

This Font Software is licensed under the **SIL Open Font License,
Version 1.1**. The full license text is available at
<https://openfontlicense.org/open-font-license-official-text/> and
in the Inter source repository at
<https://github.com/rsms/inter/blob/master/LICENSE.txt>.

The `InterVariable.woff2` file is embedded into the Ambient binary at
build time from `public/fonts/InterVariable.woff2`, unmodified. Inter
is not the Reserved Font Name of Ambient and is not represented as a
derivative work; it is used as the typographic system across the
Ambient user interface.

---

## Lucide icon geometry (derivative)

The inline-SVG icons defined in `src/components/Icons.tsx` are
hand-drawn copies that follow the Lucide icon set's geometric
conventions (24px viewBox, 2px stroke, round line caps and joins).
Lucide is distributed under the **ISC License**:
<https://github.com/lucide-icons/lucide/blob/main/LICENSE>.

---

## Microsoft Fluent Emoji (3D artwork)

Copyright (c) Microsoft Corporation
(<https://github.com/microsoft/fluentui-emoji>)

The emoji artwork bundled at `src-tauri/core/assets/emojis/` (and
fetched on demand from the codepoint-indexed
`@lobehub/fluent-emoji-3d` mirror of the same artwork) is the
Microsoft Fluent Emoji 3D set, distributed under the **MIT License**:
<https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE>.
Ambient composites this artwork into rendered wallpapers, the KDE
Plasma live-wallpaper plugin, and the in-app emoji UI.

---

## Runtime dependencies

**JavaScript** dependencies (React, ReactDOM, the Tauri JS API
packages, the Tauri plugin packages for `http`, `opener`, and
`store`) are declared in `package.json`. All are distributed under
permissive open-source licenses (MIT / Apache 2.0 / ISC). Their
license texts are available alongside each package in
`node_modules/` after installation.

**Rust** dependencies for the native side of the application
(`src-tauri/`) are declared in `src-tauri/Cargo.toml` and pinned in
`src-tauri/Cargo.lock`. All transitively-included crates are
distributed under permissive open-source licenses (MIT / Apache 2.0 /
ISC / BSD-2-Clause / BSD-3-Clause / Unicode-DFS-2016). Per-crate
license metadata is available via `cargo about generate` or by
inspecting each crate's `LICENSE*` file on crates.io.
