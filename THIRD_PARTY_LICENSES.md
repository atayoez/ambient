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

## React Bits

Copyright (c) 2026 David Haz
(<https://github.com/DavidHDev/react-bits>)

Distributed under the **MIT + Commons Clause License Condition v1.0**.
Verbatim license text from the upstream repository:

> Permission is hereby granted, free of charge, to any person obtaining
> a copy of this software and associated documentation files (the
> "Software"), to deal in the Software without restriction, including
> without limitation the rights to use, copy, modify, merge, publish,
> and distribute the Software **as part of an application, website, or
> product**, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be
> included in all copies or substantial portions of the Software.
>
> **Commons Clause Restriction.** You may use this Software, including
> for any commercial purpose, **so long as you do not sell,
> sublicense, or redistribute the components themselves — whether
> alone, in a bundle, or as a ported version.**
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
> EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
> MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
> BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
> ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

React Bits components are incorporated into Ambient as part of its
user interface. They are not redistributed as a standalone library or
component bundle.

---

## Lucide icon geometry (derivative)

The inline-SVG icons defined in `src/components/Icons.tsx` are
hand-drawn copies that follow the Lucide icon set's geometric
conventions (24px viewBox, 2px stroke, round line caps and joins).
Lucide is distributed under the **ISC License**:
<https://github.com/lucide-icons/lucide/blob/main/LICENSE>.

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
