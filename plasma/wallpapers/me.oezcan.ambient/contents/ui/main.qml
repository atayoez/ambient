/*
    Ambient — animated generative wallpaper plugin for KDE Plasma 6.

    Renders the Flow / Waves / Aurora shaders (baked .qsb in ../shaders) that
    Ambient also uses for its in-app preview. The pattern + palette + knobs
    arrive as a JSON "Spec" written into this plugin's config by the Ambient
    app via plasmashell's scripting API; we parse it and drive a ShaderEffect.
    Plasma renders this itself, on the desktop layer, on X11 and Wayland.
*/
import QtQuick
import org.kde.plasma.plasmoid

WallpaperItem {
    id: root

    // The PatternConfig Ambient wrote (camelCase, same shape as the app's).
    readonly property var spec: {
        try {
            return JSON.parse(root.configuration.Spec || "{}");
        } catch (e) {
            return {};
        }
    }
    readonly property string patternType: (typeof spec.type === "string") ? spec.type : "aurora";
    readonly property bool isGenerative: (patternType === "flow" || patternType === "waves" || patternType === "aurora" || patternType === "dots" || patternType === "bokeh" || patternType === "stripes" || patternType === "geometric" || patternType === "flower" || patternType === "mesh" || patternType === "matrix" || patternType === "crt");
    readonly property bool isEmoji: patternType === "emoji";
    // Non-generative patterns are delivered as a rendered still (path written
    // into the spec by the app); they animate as a slow drift below.
    readonly property string imageSource: {
        var img = spec.image;
        return (typeof img === "string" && img.length > 0) ? ("file://" + img) : "";
    }
    readonly property var pcolors: (spec.colors instanceof Array && spec.colors.length > 0)
        ? spec.colors : ["#000000"]

    function colorAt(i) { return i < pcolors.length ? pcolors[i] : "transparent"; }
    // typeof guard (not `|| default`) so a legitimate 0 isn't replaced.
    function num(value, fallback) { return (typeof value === "number") ? value : fallback; }
    // Geometric's enums encode to numbers for the shader (see liveShader.ts).
    function geoShapeCode(s) {
        if (s === "circles") return 1;
        if (s === "triangles") return 2;
        if (s === "squares") return 3;
        if (s === "hexagons") return 4;
        if (s === "stars") return 5;
        if (s === "plus") return 6;
        return 0; // mix / unset
    }
    function geoFillCode(s) {
        if (s === "outline") return 1;
        if (s === "mix") return 2;
        return 0; // solid / unset
    }
    // Matrix custom text → glyph-index slots. The charset string is the
    // wire contract with the baked FONT in matrix.frag — mirrored from
    // MATRIX_CHARSET in src/lib/shaders.ts (regenerate together).
    readonly property string matrixCharset: "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:<>*+=-"
    readonly property var matrixSlots: {
        var out = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        var text = (patternType === "matrix" && typeof spec.matrixText === "string")
            ? spec.matrixText.toUpperCase() : "";
        var n = 0;
        for (var i = 0; i < text.length && n < 15; i++) {
            var idx = matrixCharset.indexOf(text.charAt(i));
            if (idx >= 0) out[n++] = idx;
        }
        out[15] = n;
        return out;
    }

    function knob(which) {
        var k;
        if (patternType === "flow")
            k = [num(spec.flowLines, 28), num(spec.flowAmplitude, 0.5), num(spec.flowFrequency, 0.4)];
        else if (patternType === "waves")
            k = [num(spec.wavesLayers, 7), num(spec.wavesAmplitude, 0.5), num(spec.wavesFrequency, 0.4)];
        else if (patternType === "dots")
            k = [num(spec.density, 18), num(spec.dotsJitter, 0.5), num(spec.dotsSizeVar, 0.7)];
        else if (patternType === "bokeh")
            k = [num(spec.density, 22), 0, 0];
        else if (patternType === "stripes")
            k = [num(spec.stripesAngle, 30), num(spec.stripesWidthVar, 0.5), 0];
        else if (patternType === "geometric")
            k = [num(spec.density, 40), geoShapeCode(spec.geometricShape), geoFillCode(spec.geometricFill)];
        else if (patternType === "flower")
            k = [num(spec.flowerPetals, 12), num(spec.flowerTwist, 0.5), 0];
        else if (patternType === "matrix")
            k = [num(spec.density, 48), num(spec.matrixTrail, 0.5), num(spec.matrixSpeed, 0.5)];
        else if (patternType === "crt")
            k = [num(spec.crtScanlines, 0.6), num(spec.crtCurvature, 0.4), num(spec.crtNoise, 0.25)];
        else if (patternType === "mesh")
            k = [num(spec.meshBubbles, 16), num(spec.meshSoftness, 0.5), 0];
        else
            k = [num(spec.auroraBands, 5), num(spec.auroraAmplitude, 0.5), num(spec.auroraSpread, 0.5)];
        return k[which];
    }

    // Solid base (the spec's background colour) shows while the shader
    // compiles, and guarantees an opaque desktop if it ever fails to load.
    Rectangle {
        anchors.fill: parent
        color: root.colorAt(0)
    }

    // --- Performance --------------------------------------------------
    // A full-res, vsync-rate ShaderEffect pegs the GPU at 100% on a 4K
    // desktop. The motion is slow and low-frequency, so we (1) advance the
    // clock from a ~30fps Timer instead of every vsync, and (2) render the
    // fragment shader into a reduced-resolution layer the scene graph
    // upscales — together cutting GPU work ~20-40x with no visible loss.
    property real iTime: 0
    // Render quality (resolution + fps caps) the app stamped into the spec
    // from the user's Settings; fall back to the Balanced defaults (1280px,
    // 30fps). maxRenderEdge == 0 means uncapped (Native).
    readonly property int maxRenderEdge: num(spec.maxRenderEdge, 1280)
    readonly property int targetFps: Math.max(1, num(spec.fps, 30))
    readonly property int frameMs: Math.max(8, Math.round(1000 / targetFps))
    // Cap the shader's internal render to maxRenderEdge px on the long edge.
    readonly property real renderScale: {
        var longEdge = Math.max(width, height, 1);
        return (maxRenderEdge > 0 && longEdge > maxRenderEdge) ? maxRenderEdge / longEdge : 1.0;
    }

    Timer {
        interval: root.frameMs // app-configured fps cap (GPU vs vsync-rate)
        repeat: true
        running: root.isGenerative // only the shader needs the clock
        onTriggered: root.iTime += root.frameMs / 1000.0
    }

    ShaderEffect {
        anchors.fill: parent
        blending: false
        visible: root.isGenerative
        // Render at reduced resolution, then upscale (smooth). The single
        // biggest GPU saving for a fullscreen fragment shader.
        layer.enabled: true
        layer.smooth: true
        layer.textureSize: Qt.size(Math.max(1, Math.round(width * root.renderScale)),
                                   Math.max(1, Math.round(height * root.renderScale)))

        property real iTime: root.iTime
        property vector2d iResolution: Qt.vector2d(width, height)
        property int colorCount: Math.min(root.pcolors.length, 6)
        property color c0: root.colorAt(0)
        property color c1: root.colorAt(1)
        property color c2: root.colorAt(2)
        property color c3: root.colorAt(3)
        property color c4: root.colorAt(4)
        property color c5: root.colorAt(5)
        property real seed: root.num(root.spec.seed, 0)
        property real gSize: root.num(root.spec.size, 80)
        property real p1: root.knob(0)
        property real p2: root.knob(1)
        property real p3: root.knob(2)
        property vector4d t0: Qt.vector4d(root.matrixSlots[0], root.matrixSlots[1], root.matrixSlots[2], root.matrixSlots[3])
        property vector4d t1: Qt.vector4d(root.matrixSlots[4], root.matrixSlots[5], root.matrixSlots[6], root.matrixSlots[7])
        property vector4d t2: Qt.vector4d(root.matrixSlots[8], root.matrixSlots[9], root.matrixSlots[10], root.matrixSlots[11])
        property vector4d t3: Qt.vector4d(root.matrixSlots[12], root.matrixSlots[13], root.matrixSlots[14], root.matrixSlots[15])

        // Our own pass-through vertex shader (see wallpaper.vert) — the
        // built-in one fails to link on the GL backend Plasma uses.
        vertexShader: Qt.resolvedUrl("../shaders/wallpaper.vert.qsb")
        // Swap the baked fragment shader by pattern type. For non-generative
        // types this item is hidden (visible: false) but we still point it at
        // a valid shader so Qt doesn't fall back to its default material
        // (which warns about a missing 'source' sampler).
        fragmentShader: Qt.resolvedUrl(
            "../shaders/" + (root.isGenerative ? root.patternType : "aurora") + ".frag.qsb")
    }

    // Static patterns animate as a slow Ken-Burns drift over their rendered
    // still. Cheap (just compositing one image), no per-fragment shader.
    Image {
        id: staticImage
        visible: !root.isGenerative && !root.isEmoji && root.imageSource !== ""
        source: root.imageSource
        fillMode: Image.PreserveAspectCrop
        width: parent.width
        height: parent.height
        anchors.centerIn: parent
        smooth: true
        asynchronous: true
        cache: false

        // One looping phase drives a gentle orbit + breathe. The ~1.12 base
        // scale keeps the ±3% drift from ever revealing an edge.
        property real driftPhase: 0
        NumberAnimation on driftPhase {
            from: 0
            to: 6.2831853
            duration: 60000
            loops: Animation.Infinite
            running: staticImage.visible
        }
        transform: [
            Translate {
                x: Math.sin(staticImage.driftPhase) * staticImage.width * 0.03
                y: Math.cos(staticImage.driftPhase * 0.7) * staticImage.height * 0.025
            },
            Scale {
                origin.x: staticImage.width / 2
                origin.y: staticImage.height / 2
                xScale: 1.12 + Math.sin(staticImage.driftPhase * 0.5) * 0.02
                yScale: 1.12 + Math.sin(staticImage.driftPhase * 0.5) * 0.02
            }
        ]
    }

    // Emoji pattern: a grid of glyphs, each drifting in its own random
    // direction at its own random speed and spinning at its own random
    // rate/direction. The app exports Microsoft Fluent 3D PNGs and lists
    // them in spec.emojiImages (parallel to spec.emojis); tiles render those
    // so the desktop matches the in-app art. A glyph with no exported image
    // (offline fetch miss) falls back to a system-font Text glyph.
    Item {
        id: emojiField
        anchors.fill: parent
        visible: root.isEmoji

        readonly property var glyphs: (root.spec.emojis instanceof Array && root.spec.emojis.length > 0)
            ? root.spec.emojis : ["✨"]
        readonly property var images: (root.spec.emojiImages instanceof Array) ? root.spec.emojiImages : []
        readonly property real glyphPx: root.num(root.spec.size, 90) * (Math.max(width, height) / 1920)
        readonly property real cell: Math.max(glyphPx * root.num(root.spec.emojiSpacing, 175) / 100, 1)
        readonly property int cols: Math.max(1, Math.ceil(width / cell) + 1)
        readonly property int rows: Math.max(1, Math.ceil(height / cell) + 1)
        readonly property int count: Math.min(cols * rows, 600)
        property real clock: 0

        function rnd(i, salt) {
            var x = Math.sin(i * 12.9898 + salt * 78.233 + root.num(root.spec.seed, 0) * 0.013) * 43758.5453;
            return x - Math.floor(x);
        }

        Timer {
            interval: 33
            repeat: true
            running: emojiField.visible
            onTriggered: emojiField.clock += 0.033
        }

        Repeater {
            model: emojiField.visible ? emojiField.count : 0
            delegate: Item {
                id: tile
                required property int index
                readonly property real sizeVar: root.num(root.spec.emojiSizeVar, 0.75)
                readonly property real px: emojiField.glyphPx
                    * (1.0 - sizeVar * 0.4 + sizeVar * 0.8 * emojiField.rnd(index, 8))
                readonly property string img: emojiField.images.length > 0
                    ? (emojiField.images[index % emojiField.glyphs.length] || "") : ""

                // Per-tile randoms are constants (deterministic in index +
                // seed) — hoisted so the 30fps clock bindings below don't
                // recompute ~7 sin() hashes per tile per frame (~4200/frame
                // at 600 tiles).
                readonly property real baseX: ((index % emojiField.cols) + 0.5) * emojiField.cell
                    + (emojiField.rnd(index, 1) - 0.5) * emojiField.cell * 0.5
                readonly property real baseY: (Math.floor(index / emojiField.cols) + 0.5) * emojiField.cell
                    + (emojiField.rnd(index, 2) - 0.5) * emojiField.cell * 0.5
                readonly property real driftSpeedX: 0.05 + emojiField.rnd(index, 3) * 0.12
                readonly property real driftSpeedY: 0.05 + emojiField.rnd(index, 4) * 0.12
                readonly property real phaseX: emojiField.rnd(index, 5) * 6.2832
                readonly property real phaseY: emojiField.rnd(index, 6) * 6.2832
                readonly property real spinRate: (emojiField.rnd(index, 7) - 0.5) * 12.0

                width: px
                height: px
                transformOrigin: Item.Center
                x: tile.baseX - width / 2
                   + Math.sin(emojiField.clock * tile.driftSpeedX + tile.phaseX) * emojiField.cell * 0.24
                y: tile.baseY - height / 2
                   + Math.cos(emojiField.clock * tile.driftSpeedY + tile.phaseY) * emojiField.cell * 0.24
                rotation: emojiField.clock * tile.spinRate

                Image {
                    anchors.fill: parent
                    visible: tile.img !== ""
                    source: tile.img !== "" ? "file://" + tile.img : ""
                    fillMode: Image.PreserveAspectFit
                    // Fixed decode size = one cached texture per glyph file
                    // (Qt keys its image cache on url+sourceSize; a per-tile
                    // size would decode every size variant separately).
                    sourceSize.width: 256
                    sourceSize.height: 256
                    asynchronous: true
                }
                Text {
                    anchors.centerIn: parent
                    visible: tile.img === ""
                    text: emojiField.glyphs[tile.index % emojiField.glyphs.length]
                    font.pixelSize: tile.px
                }
            }
        }
    }
}
