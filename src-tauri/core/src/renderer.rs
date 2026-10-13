// Pattern renderer — Rust replacement for the JS Canvas implementation
// deleted in Phase 5. Drives both:
//   1. Live preview in the Patterns tab (custom ambient:// URI scheme
//      → PNG bytes → <img>). Browser caches per-config URL.
//   2. Native-resolution export via the apply_pattern command, run
//      under spawn_blocking so the UI stays interactive even at 5K SSAA.
//
// The seeded LCG matches the JS implementation byte-for-byte
// (multiplier 1103515245, increment 12345, divisor 2^32), so the same
// PatternConfig.seed produces visually identical output across the
// pre-Phase-5 and post-Phase-5 builds for snapshot validation.

use std::path::PathBuf;

use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use serde::{Deserialize, Serialize};
use tiny_skia::{
    Color, FillRule, FilterQuality, GradientStop, LineJoin, LinearGradient, Paint, PathBuilder,
    Pixmap, PixmapPaint, Point, RadialGradient, Rect, SpreadMode, Stroke, Transform,
};

use crate::library_store::prepend_entry;
use crate::monitor::get_primary_monitor_pixels;
use crate::types::Wallpaper;
use crate::util::ms_since_epoch;

// Preview dimension caps — the frontend passes the live `.preview-wrap`
// element size × DPR so we render exactly to the displayed pixel grid
// (no browser scaling), but we cap at a sane ceiling to keep the per-
// frame budget bounded during rapid slider drags on big monitors.
const PREVIEW_MIN_DIM: u32 = 64;
// Previews are 1× (no SSAA) and only need to look crisp at the on-screen
// stage size, so cap them at a sane ceiling — keeps each preview render
// bounded (cost scales with pixel count) so rapid edits can't pile up
// into an OOM. Sized for a maximized window on an ultrawide (the window
// is resizable now); the frontend debounce means only settled configs
// render at full size.
const PREVIEW_MAX_W: u32 = 3840;
const PREVIEW_MAX_H: u32 = 2160;

// Monotonic generation for preview renders. Each render_preview call
// claims the next generation; if a newer call has since claimed a higher
// one, the older render abandons its result instead of wasting the encode
// + IPC (and the frontend ignores it anyway). This is the "cancel the old
// preview job when a new one arrives" mechanism — apply_pattern does NOT
// participate, so committing a wallpaper is never cancelled.
static PREVIEW_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PatternConfig {
    #[serde(rename = "type")]
    pub pattern_type: PatternType,
    pub colors: Vec<String>,
    pub density: f32,
    pub size: f32,
    pub emojis: Vec<String>,
    pub seed: u32,
    // Wire field — the JS side uses it to detect manual palette
    // overrides, but Rust just stores and ignores it.
    #[allow(dead_code)]
    #[serde(default)]
    pub color_preset_id: Option<String>,
    #[serde(default)]
    pub mesh_bubbles: Option<u32>,
    #[serde(default)]
    pub mesh_softness: Option<f32>,
    #[serde(default)]
    pub geometric_shape: Option<GeometricShape>,
    #[serde(default)]
    pub geometric_fill: Option<GeometricFill>,
    #[serde(default)]
    pub dots_jitter: Option<f32>,
    #[serde(default)]
    pub dots_size_var: Option<f32>,
    #[serde(default)]
    pub stripes_angle: Option<f32>,
    #[serde(default)]
    pub stripes_width_var: Option<f32>,
    #[serde(default)]
    pub emoji_rotation_max: Option<f32>,
    #[serde(default)]
    pub emoji_size_var: Option<f32>,
    #[serde(default)]
    pub emoji_spacing: Option<f32>,
    // Flower (Windows 11 "Bloom"-style): petal count + swirl (tangential
    // bend of each petal). Flowing translucent gradient petals radiating
    // from a luminous centre.
    #[serde(default)]
    pub flower_petals: Option<u32>,
    #[serde(default)]
    pub flower_twist: Option<f32>,
    // Flow: smooth wavy lines spanning the canvas edge-to-edge. Line
    // count, wave amplitude (0–1), and wave frequency (0–1).
    #[serde(default)]
    pub flow_lines: Option<u32>,
    #[serde(default)]
    pub flow_amplitude: Option<f32>,
    #[serde(default)]
    pub flow_frequency: Option<f32>,
    // Waves: stacked wavy translucent bands (layered-silk look).
    #[serde(default)]
    pub waves_layers: Option<u32>,
    #[serde(default)]
    pub waves_amplitude: Option<f32>,
    #[serde(default)]
    pub waves_frequency: Option<f32>,
    // Aurora: vertical northern-lights curtains (blurred gradient ribbons).
    #[serde(default)]
    pub aurora_bands: Option<u32>,
    #[serde(default)]
    pub aurora_spread: Option<f32>,
    #[serde(default)]
    pub aurora_amplitude: Option<f32>,
    // Matrix: density = column count; trail length + fall speed (0-1).
    #[serde(default)]
    pub matrix_trail: Option<f32>,
    #[serde(default)]
    pub matrix_speed: Option<f32>,
    /// Optional custom rain text (≤15 chars from MATRIX_CHARSET); empty →
    /// random glyphs from the whole charset.
    #[serde(default)]
    pub matrix_text: Option<String>,
    // CRT test pattern: scanline strength, tube curvature, noise (all 0-1).
    // Renders the broadcast-standard bar colours, not the palette.
    #[serde(default)]
    pub crt_scanlines: Option<f32>,
    #[serde(default)]
    pub crt_curvature: Option<f32>,
    #[serde(default)]
    pub crt_noise: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PatternType {
    Mesh,
    Geometric,
    Dots,
    Stripes,
    Emoji,
    #[serde(alias = "bloom")]
    Flower,
    Flow,
    Waves,
    Aurora,
    Bokeh,
    Matrix,
    Crt,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GeometricShape {
    Circles,
    Triangles,
    Squares,
    Hexagons,
    Stars,
    Plus,
    Mix,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GeometricFill {
    Solid,
    Outline,
    Mix,
}

pub struct SeededRng {
    state: u32,
}

impl SeededRng {
    pub fn new(seed: u32) -> Self {
        Self {
            state: if seed == 0 { 1 } else { seed },
        }
    }

    pub fn next(&mut self) -> f32 {
        self.state = self.state.wrapping_mul(1103515245).wrapping_add(12345);
        // Matches JS: `s / 0x100000000` where s is treated as uint32.
        self.state as f32 / 4_294_967_296.0
    }
}

pub fn halton(index: u32, base: u32) -> f32 {
    let mut result = 0.0;
    let mut f = 1.0 / base as f32;
    let mut i = index;
    while i > 0 {
        result += f * (i % base) as f32;
        i /= base;
        f /= base as f32;
    }
    result
}

fn remap(t: f32, min: f32, max: f32) -> f32 {
    min + t * (max - min)
}

// Knob defaults + the matrix charset, generated by core/build.rs from
// src/lib/patternManifest.json — the same manifest the TS layer derives
// its sliders, Randomize ranges, and WebGL uniform packing from, so the
// CPU renderers, the GPU uniform path (knobs), and the UI can't drift.
// Provides `MATRIX_CHARSET`, `MAX_COLORS`, and `mod knob_defaults`.
// (mesh's CPU renderer intentionally keeps its palette-derived bubble
// fallback for legacy configs — see render_mesh.)
include!(concat!(env!("OUT_DIR"), "/pattern_manifest.rs"));

/// Foreground palette: `colors[1..]` when a separate background color
/// exists, otherwise the whole list. Empty in → empty out — callers must
/// guard on empty before indexing.
fn foreground(cfg: &PatternConfig) -> Vec<&String> {
    if cfg.colors.len() > 1 {
        cfg.colors[1..].iter().collect()
    } else {
        cfg.colors.iter().collect()
    }
}

fn hex_to_color(hex: &str, alpha: f32) -> Color {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 {
        return Color::from_rgba8(0, 0, 0, (alpha.clamp(0.0, 1.0) * 255.0) as u8);
    }
    let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(0);
    Color::from_rgba8(r, g, b, (alpha.clamp(0.0, 1.0) * 255.0) as u8)
}

/// (p1, p2, p3) per type — the shader-uniform packing from
/// patternManifest.json (uniform tags), with generated knob defaults.
/// Shared by the GPU still path (gpu_render::uniforms) and the live-spec
/// stamping in live.rs, and mirrored by liveShader.ts, which resolves
/// the same manifest. density/size are always present in the Rust
/// config, so they pass through directly.
pub(crate) fn knobs(cfg: &PatternConfig) -> (f32, f32, f32) {
    match cfg.pattern_type {
        PatternType::Flow => (
            cfg.flow_lines.unwrap_or(knob_defaults::FLOW_LINES as u32) as f32,
            cfg.flow_amplitude.unwrap_or(knob_defaults::FLOW_AMPLITUDE),
            cfg.flow_frequency.unwrap_or(knob_defaults::FLOW_FREQUENCY),
        ),
        PatternType::Waves => (
            cfg.waves_layers.unwrap_or(knob_defaults::WAVES_LAYERS as u32) as f32,
            cfg.waves_amplitude.unwrap_or(knob_defaults::WAVES_AMPLITUDE),
            cfg.waves_frequency.unwrap_or(knob_defaults::WAVES_FREQUENCY),
        ),
        PatternType::Aurora => (
            cfg.aurora_bands.unwrap_or(knob_defaults::AURORA_BANDS as u32) as f32,
            cfg.aurora_amplitude.unwrap_or(knob_defaults::AURORA_AMPLITUDE),
            cfg.aurora_spread.unwrap_or(knob_defaults::AURORA_SPREAD),
        ),
        PatternType::Dots => (
            cfg.density,
            cfg.dots_jitter.unwrap_or(knob_defaults::DOTS_JITTER),
            cfg.dots_size_var.unwrap_or(knob_defaults::DOTS_SIZE_VAR),
        ),
        PatternType::Bokeh => (cfg.density, 0.0, 0.0),
        PatternType::Stripes => (
            cfg.stripes_angle.unwrap_or(knob_defaults::STRIPES_ANGLE),
            cfg.stripes_width_var.unwrap_or(knob_defaults::STRIPES_WIDTH_VAR),
            0.0,
        ),
        PatternType::Geometric => (
            cfg.density,
            shape_code(cfg.geometric_shape),
            fill_code(cfg.geometric_fill),
        ),
        PatternType::Flower => (
            cfg.flower_petals.unwrap_or(knob_defaults::FLOWER_PETALS as u32) as f32,
            cfg.flower_twist.unwrap_or(knob_defaults::FLOWER_TWIST),
            0.0,
        ),
        PatternType::Mesh => (
            cfg.mesh_bubbles.unwrap_or(knob_defaults::MESH_BUBBLES as u32) as f32,
            cfg.mesh_softness.unwrap_or(knob_defaults::MESH_SOFTNESS),
            0.0,
        ),
        PatternType::Matrix => (
            if cfg.density > 0.0 { cfg.density } else { knob_defaults::MATRIX_DENSITY },
            cfg.matrix_trail.unwrap_or(knob_defaults::MATRIX_TRAIL),
            cfg.matrix_speed.unwrap_or(knob_defaults::MATRIX_SPEED),
        ),
        PatternType::Crt => (
            cfg.crt_scanlines.unwrap_or(knob_defaults::CRT_SCANLINES),
            cfg.crt_curvature.unwrap_or(knob_defaults::CRT_CURVATURE),
            cfg.crt_noise.unwrap_or(knob_defaults::CRT_NOISE),
        ),
        PatternType::Emoji => (1.0, 0.5, 0.5),
    }
}

fn shape_code(s: Option<GeometricShape>) -> f32 {
    match s.unwrap_or(GeometricShape::Mix) {
        GeometricShape::Mix => 0.0,
        GeometricShape::Circles => 1.0,
        GeometricShape::Triangles => 2.0,
        GeometricShape::Squares => 3.0,
        GeometricShape::Hexagons => 4.0,
        GeometricShape::Stars => 5.0,
        GeometricShape::Plus => 6.0,
    }
}

fn fill_code(f: Option<GeometricFill>) -> f32 {
    match f.unwrap_or(GeometricFill::Solid) {
        GeometricFill::Solid => 0.0,
        GeometricFill::Outline => 1.0,
        GeometricFill::Mix => 2.0,
    }
}

// --- GPU shader render path -------------------------------------------------
// The static render runs the SAME fragment shaders as the live KDE wallpaper
// and the WebGL preview (the Qt `.frag`, via gpu.rs / naga), so all three
// match. Resolves a PatternConfig into the shader's uniforms; emoji has no
// shader (real glyph images), so it stays on tiny-skia. Desktop-only.

// GENERATED 5x7 bitmaps for MATRIX_CHARSET: rows 0-5 packed 5 bits each
// into .0, row 6 in .1 (bit = col). Same data as the GLSL FONT array.
const MATRIX_FONT: [(u32, u32); 88] = [(71447071, 2), (102672, 0), (285788132, 6), (138547359, 31), (312882120, 12), (623530948, 25), (142479812, 4), (142920644, 2), (138718146, 2), (554189343, 31), (277162314, 4), (143148034, 2), (616702238, 17), (69564994, 28), (142887473, 2), (143051716, 2), (138547342, 2), (142886564, 2), (138574862, 2), (35030049, 1), (4357252, 2), (14, 31), (751184414, 3), (141697476, 4), (138682896, 3), (587802954, 17), (34649121, 31), (142885407, 2), (538224838, 16), (726798788, 4), (138748447, 8), (101059086, 8), (1009059844, 17), (616966416, 1), (139432078, 28), (138829634, 4), (277094670, 31), (554648095, 31), (277380110, 6), (285787697, 4), (191043782, 13), (177767457, 3), (588826175, 17), (277366335, 6), (142622785, 3), (588826158, 14), (138547334, 31), (209994254, 31), (554058254, 31), (301279624, 8), (554186830, 15), (589136958, 14), (138551583, 4), (588728878, 30), (558679598, 15), (585443460, 17), (588752431, 15), (34636862, 30), (588826159, 15), (35095615, 31), (35095615, 1), (589071422, 30), (589284913, 17), (1073741823, 31), (554189328, 31), (311661881, 17), (34636833, 31), (725478961, 17), (865783409, 17), (588826158, 14), (35112511, 1), (488162862, 24), (307742255, 17), (554044462, 31), (138547359, 4), (588826161, 14), (145031729, 4), (344512165, 10), (346175825, 17), (138553361, 4), (69345566, 31), (414, 30), (408983952, 16), (214446273, 1), (350745732, 10), (139432068, 4), (31, 31), (1073741823, 31)];

/// Encode `matrix_text` into the shader's 16 text slots: up to 15 glyph
/// indices (uppercased, unknown chars dropped) + the count in slot 15.
pub(crate) fn matrix_text_slots(text: Option<&str>) -> [[f32; 4]; 4] {
    let mut flat = [0.0_f32; 16];
    let mut n = 0usize;
    if let Some(text) = text {
        for ch in text.to_uppercase().chars() {
            if n >= 15 {
                break;
            }
            if let Some(idx) = MATRIX_CHARSET.chars().position(|c| c == ch) {
                flat[n] = idx as f32;
                n += 1;
            }
        }
    }
    flat[15] = n as f32;
    let mut out = [[0.0_f32; 4]; 4];
    for (i, v) in flat.iter().enumerate() {
        out[i / 4][i % 4] = *v;
    }
    out
}

mod gpu_render {
    use super::{PatternConfig, PatternType};
    use crate::gpu::ShaderUniforms;

    macro_rules! frag {
        ($f:literal) => {
            include_str!(concat!(
                "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/",
                $f
            ))
        };
    }

    /// The Qt `.frag` for a type, or None for emoji (no shader).
    pub fn frag_source(t: PatternType) -> Option<&'static str> {
        Some(match t {
            PatternType::Flow => frag!("flow.frag"),
            PatternType::Waves => frag!("waves.frag"),
            PatternType::Aurora => frag!("aurora.frag"),
            PatternType::Dots => frag!("dots.frag"),
            PatternType::Bokeh => frag!("bokeh.frag"),
            PatternType::Stripes => frag!("stripes.frag"),
            PatternType::Geometric => frag!("geometric.frag"),
            PatternType::Flower => frag!("flower.frag"),
            PatternType::Mesh => frag!("mesh.frag"),
            PatternType::Matrix => frag!("matrix.frag"),
            PatternType::Crt => frag!("crt.frag"),
            PatternType::Emoji => return None,
        })
    }

    /// Resolve config + size into the shader uniforms (iTime stays 0 — the
    /// static render is the live shader's first frame).
    pub fn uniforms(cfg: &PatternConfig, w: u32, h: u32) -> ShaderUniforms {
        let (p1, p2, p3) = super::knobs(cfg);
        let mut colors = [[0.0f32, 0.0, 0.0, 1.0]; 6];
        let n = cfg.colors.len().min(6);
        for i in 0..n {
            let c = super::hex_to_color(&cfg.colors[i], 1.0);
            colors[i] = [c.red(), c.green(), c.blue(), 1.0];
        }
        ShaderUniforms {
            resolution: [w as f32, h as f32],
            time: 0.0,
            color_count: n.max(1) as i32,
            colors,
            seed: cfg.seed as f32,
            size: cfg.size,
            p1,
            p2,
            p3,
            text: super::matrix_text_slots(
                (cfg.pattern_type == PatternType::Matrix)
                    .then(|| cfg.matrix_text.as_deref())
                    .flatten(),
            ),
        }
    }
}

/// Render a pattern to a Pixmap. Generative types go through the GPU shader
/// path (so the static render matches the live wallpaper / preview exactly);
/// emoji and any GPU failure fall through to the tiny-skia renderers.
pub fn render(config: &PatternConfig, w: u32, h: u32) -> Pixmap {
    let w = w.max(1);
    let h = h.max(1);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(frag) = gpu_render::frag_source(config.pattern_type) {
        let u = gpu_render::uniforms(config, w, h);
        match crate::gpu::render_to_rgba8(frag, w, h, &u.to_std140()) {
            Ok(rgba) if rgba.len() == (w as usize) * (h as usize) * 4 => {
                if let Some(mut pix) = Pixmap::new(w, h) {
                    // Shader output is opaque (alpha 255) → straight == premult.
                    pix.data_mut().copy_from_slice(&rgba);
                    return pix;
                }
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("gpu shader render failed ({e}); using tiny-skia"),
        }
    }
    render_cpu(config, w, h)
}

/// tiny-skia (CPU) renderer — the fallback path, and the only path for emoji.
fn render_cpu(config: &PatternConfig, w: u32, h: u32) -> Pixmap {
    // Pixmap::new returns None for zero or absurdly large dimensions
    // (the backing buffer would exceed tiny-skia's limits). Halve until
    // the allocation succeeds instead of panicking — 1×1 always does.
    let (mut pw, mut ph) = (w.max(1), h.max(1));
    let mut pix = loop {
        match Pixmap::new(pw, ph) {
            Some(p) => break p,
            None => {
                tracing::warn!("pixmap alloc failed at {pw}x{ph}; halving");
                pw = (pw / 2).max(1);
                ph = (ph / 2).max(1);
            }
        }
    };
    match config.pattern_type {
        PatternType::Mesh => render_mesh(&mut pix, config),
        PatternType::Geometric => render_geometric(&mut pix, config),
        PatternType::Dots => render_dots(&mut pix, config),
        PatternType::Stripes => render_stripes(&mut pix, config),
        PatternType::Emoji => render_emoji(&mut pix, config),
        PatternType::Flower => render_flower(&mut pix, config),
        PatternType::Flow => render_flow(&mut pix, config),
        PatternType::Waves => render_waves(&mut pix, config),
        PatternType::Aurora => render_aurora(&mut pix, config),
        PatternType::Bokeh => render_bokeh(&mut pix, config),
        PatternType::Matrix => render_matrix(&mut pix, config),
        PatternType::Crt => render_crt(&mut pix, config),
    }
    pix
}

fn fill_rect_color(pix: &mut Pixmap, color: Color) {
    let mut paint = Paint::default();
    paint.set_color(color);
    let w = pix.width() as f32;
    let h = pix.height() as f32;
    if let Some(rect) = Rect::from_xywh(0.0, 0.0, w, h) {
        pix.fill_rect(rect, &paint, Transform::identity(), None);
    }
}

fn render_mesh(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }
    // The layer loop indexes cfg.colors directly — modulo-by-zero guard.
    if cfg.colors.is_empty() {
        return;
    }

    let layers = cfg
        .mesh_bubbles
        .unwrap_or_else(|| (cfg.colors.len() as u32 * 3).max(10));
    let seed_offset = (rng.next() * 1000.0) as u32;

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let max_dim = w_f.max(h_f);

    for i in 0..layers {
        let color_str = &cfg.colors[(i as usize + 1) % cfg.colors.len()];
        let cx = remap(halton(i + 1 + seed_offset, 2), -0.1, 1.1) * w_f;
        let cy = remap(halton(i + 1 + seed_offset, 3), -0.1, 1.1) * h_f;
        let radius = remap(rng.next(), 0.35, 0.75) * max_dim;
        let alpha = remap(rng.next(), 0.55, 0.9);
        let stops = vec![
            GradientStop::new(0.0, hex_to_color(color_str, alpha)),
            GradientStop::new(0.5, hex_to_color(color_str, alpha * 0.4)),
            GradientStop::new(1.0, hex_to_color(color_str, 0.0)),
        ];
        // tiny-skia 0.12 widened RadialGradient::new to the focal form
        // (focal_point, focal_radius, end_point, end_radius). For our
        // simple radial we keep focal_point == end_point and
        // focal_radius == 0 — same visual as the old 6-arg signature.
        let shader = match RadialGradient::new(
            Point::from_xy(cx, cy),
            0.0,
            Point::from_xy(cx, cy),
            radius,
            stops,
            SpreadMode::Pad,
            Transform::identity(),
        ) {
            Some(s) => s,
            None => continue,
        };
        let mut paint = Paint::default();
        paint.shader = shader;
        paint.anti_alias = true;
        if let Some(rect) = Rect::from_xywh(0.0, 0.0, w_f, h_f) {
            pix.fill_rect(rect, &paint, Transform::identity(), None);
        }
    }

    // Gaussian blur via the image crate — tiny-skia has no native blur.
    // Pixmap data is premultiplied RGBA; blurring premultiplied bytes
    // is approximately correct (per-channel blur, alpha co-blurred).
    let softness = cfg.mesh_softness.unwrap_or(knob_defaults::MESH_SOFTNESS);
    let blur_px = (max_dim * (0.005 + softness * 0.025)).round();
    if blur_px > 0.5 {
        apply_blur(pix, blur_px);
    }
}

fn apply_blur(pix: &mut Pixmap, sigma_px: f32) {
    let w = pix.width();
    let h = pix.height();
    let img = match image::RgbaImage::from_raw(w, h, pix.data().to_vec()) {
        Some(i) => i,
        None => return,
    };
    // fast_blur is a constant-time stack-blur approximation — visually
    // identical to the true Gaussian for our use (smooth-gradient
    // background art) but ~50× faster at the large sigmas the mesh
    // softness slider can produce. The slow `image::imageops::blur`
    // is what made the first preview render take 10+ seconds in dev
    // builds.
    let blurred = image::imageops::fast_blur(&img, sigma_px);
    pix.data_mut().copy_from_slice(blurred.as_raw());
}

fn render_geometric(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }
    let scale = w_f.max(h_f) / 1920.0;
    let base_size = cfg.size * scale;
    // Shape COUNT must be resolution-independent so the preview (rendered
    // at the small wrapper size) shows the exact same number of shapes as
    // the applied wallpaper (rendered at monitor resolution). `density` is
    // the shape count directly; `base_size` already scales with the canvas
    // so each shape keeps its relative size, and the shared seed places
    // them at the same relative positions — making the preview a faithful
    // miniature of the wallpaper. (Previously count was `density * scale²`,
    // i.e. proportional to pixel area, so a 4K wallpaper drew ~4× the
    // shapes of its 1080p-sized preview — the "preview has way fewer
    // shapes" inconsistency. The other pattern types scale their spacing
    // with the canvas, so their counts were already resolution-independent.)
    let count = cfg.density.round().max(0.0) as u32;
    let shape_filter = cfg.geometric_shape.unwrap_or(GeometricShape::Mix);
    let fill_mode = cfg.geometric_fill.unwrap_or(GeometricFill::Solid);

    // Shape code → drawer. 7 shapes for Mix; specific filters lock to
    // one. Lines (code 7) only show up in Mix because they're stroke-
    // only and don't have a meaningful "fill" mode.
    const SHAPE_CIRCLE: u8 = 0;
    const SHAPE_SQUARE: u8 = 1;
    const SHAPE_TRIANGLE: u8 = 2;
    const SHAPE_HEXAGON: u8 = 3;
    const SHAPE_STAR: u8 = 4;
    const SHAPE_PLUS: u8 = 5;
    const SHAPE_LINE: u8 = 6;
    const MIX_POOL_SIZE: u8 = 7;

    for _ in 0..count {
        let color_str = palette[(rng.next() * palette.len() as f32) as usize];
        let x = rng.next() * w_f;
        let y = rng.next() * h_f;
        let variation = (rng.next() - 0.5) * 0.4;
        let s = base_size * (1.0 + variation);
        let shape = match shape_filter {
            GeometricShape::Circles => SHAPE_CIRCLE,
            GeometricShape::Squares => SHAPE_SQUARE,
            GeometricShape::Triangles => SHAPE_TRIANGLE,
            GeometricShape::Hexagons => SHAPE_HEXAGON,
            GeometricShape::Stars => SHAPE_STAR,
            GeometricShape::Plus => SHAPE_PLUS,
            GeometricShape::Mix => (rng.next() * MIX_POOL_SIZE as f32) as u8,
        };
        let outline = shape != SHAPE_LINE
            && match fill_mode {
                GeometricFill::Outline => true,
                GeometricFill::Mix => rng.next() < 0.5,
                GeometricFill::Solid => false,
            };
        let alpha = remap(rng.next(), 0.55, 1.0);
        let color = hex_to_color(color_str, alpha);
        let mut paint = Paint::default();
        paint.set_color(color);
        paint.anti_alias = true;
        let stroke = Stroke {
            width: s * 0.18,
            ..Stroke::default()
        };

        match shape {
            SHAPE_CIRCLE => {
                let mut pb = PathBuilder::new();
                pb.push_circle(x, y, s);
                draw_or_stroke(pix, pb.finish(), &paint, outline, &stroke);
            }
            SHAPE_SQUARE => {
                let rotation = rng.next() * std::f32::consts::PI * 2.0;
                let transform =
                    Transform::from_translate(x, y).pre_rotate(rotation.to_degrees());
                if outline {
                    if let Some(rect) = Rect::from_xywh(-s, -s, s * 2.0, s * 2.0) {
                        let mut pb = PathBuilder::new();
                        pb.push_rect(rect);
                        if let Some(path) = pb.finish() {
                            pix.stroke_path(&path, &paint, &stroke, transform, None);
                        }
                    }
                } else if let Some(rect) =
                    Rect::from_xywh(-s, -s, s * 2.0, s * 2.0)
                {
                    pix.fill_rect(rect, &paint, transform, None);
                }
            }
            SHAPE_TRIANGLE => {
                let mut pb = PathBuilder::new();
                pb.move_to(x, y - s);
                pb.line_to(x - s * 0.866, y + s * 0.5);
                pb.line_to(x + s * 0.866, y + s * 0.5);
                pb.close();
                draw_or_stroke(pix, pb.finish(), &paint, outline, &stroke);
            }
            SHAPE_HEXAGON => {
                let mut pb = PathBuilder::new();
                let rotation = rng.next() * std::f32::consts::PI;
                for i in 0..6 {
                    let a =
                        rotation + i as f32 * std::f32::consts::PI / 3.0;
                    let px = x + a.cos() * s;
                    let py = y + a.sin() * s;
                    if i == 0 {
                        pb.move_to(px, py);
                    } else {
                        pb.line_to(px, py);
                    }
                }
                pb.close();
                draw_or_stroke(pix, pb.finish(), &paint, outline, &stroke);
            }
            SHAPE_STAR => {
                // 5-point star — 10 vertices alternating between outer
                // radius `s` and inner radius `s * 0.4`. The 0.4 ratio
                // is the classic "5-point star with golden proportions"
                // — anything narrower looks spidery.
                let mut pb = PathBuilder::new();
                let rotation = rng.next() * std::f32::consts::PI * 2.0
                    - std::f32::consts::FRAC_PI_2;
                for i in 0..10 {
                    let a = rotation
                        + i as f32 * std::f32::consts::PI / 5.0;
                    let r = if i % 2 == 0 { s } else { s * 0.4 };
                    let px = x + a.cos() * r;
                    let py = y + a.sin() * r;
                    if i == 0 {
                        pb.move_to(px, py);
                    } else {
                        pb.line_to(px, py);
                    }
                }
                pb.close();
                draw_or_stroke(pix, pb.finish(), &paint, outline, &stroke);
            }
            SHAPE_PLUS => {
                // Plus/cross — built as a 12-vertex outline so it can
                // be stroked OR filled with the same path.
                let arm = s * 0.36;
                let mut pb = PathBuilder::new();
                pb.move_to(x - arm, y - s);
                pb.line_to(x + arm, y - s);
                pb.line_to(x + arm, y - arm);
                pb.line_to(x + s, y - arm);
                pb.line_to(x + s, y + arm);
                pb.line_to(x + arm, y + arm);
                pb.line_to(x + arm, y + s);
                pb.line_to(x - arm, y + s);
                pb.line_to(x - arm, y + arm);
                pb.line_to(x - s, y + arm);
                pb.line_to(x - s, y - arm);
                pb.line_to(x - arm, y - arm);
                pb.close();
                draw_or_stroke(pix, pb.finish(), &paint, outline, &stroke);
            }
            _ => {
                // SHAPE_LINE — only reachable via Mix.
                let angle = rng.next() * std::f32::consts::PI * 2.0;
                let len = s * 3.0;
                let x1 = x - angle.cos() * len;
                let y1 = y - angle.sin() * len;
                let x2 = x + angle.cos() * len;
                let y2 = y + angle.sin() * len;
                let mut pb = PathBuilder::new();
                pb.move_to(x1, y1);
                pb.line_to(x2, y2);
                if let Some(path) = pb.finish() {
                    pix.stroke_path(
                        &path,
                        &paint,
                        &stroke,
                        Transform::identity(),
                        None,
                    );
                }
            }
        }
    }
}

fn draw_or_stroke(
    pix: &mut Pixmap,
    path: Option<tiny_skia::Path>,
    paint: &Paint,
    outline: bool,
    stroke: &Stroke,
) {
    let Some(path) = path else { return };
    if outline {
        pix.stroke_path(&path, paint, stroke, Transform::identity(), None);
    } else {
        pix.fill_path(&path, paint, FillRule::Winding, Transform::identity(), None);
    }
}

fn render_dots(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }
    let spacing = w_f.max(h_f) / cfg.density.max(8.0);
    let scale = w_f.max(h_f) / 1920.0;
    let base_radius = cfg.size * scale * 0.45;
    let jitter = cfg.dots_jitter.unwrap_or(knob_defaults::DOTS_JITTER);
    let size_var = cfg.dots_size_var.unwrap_or(knob_defaults::DOTS_SIZE_VAR);

    let mut row = 0;
    let mut y = spacing / 2.0;
    while y < h_f {
        let stagger = (row % 2) as f32 * spacing * 0.5;
        let mut x = stagger - spacing;
        while x < w_f + spacing {
            let jx = x + (rng.next() - 0.5) * spacing * jitter;
            let jy = y + (rng.next() - 0.5) * spacing * jitter;
            let r = (base_radius * (1.0 + (rng.next() - 0.5) * size_var)).max(2.0);
            let color_str = palette[(rng.next() * palette.len() as f32) as usize];
            // Solid anti-aliased circles. The earlier 0.85→1.0 radial-
            // gradient fade looked fine at full resolution but at small
            // preview canvases the gradient dominated the dot's pixels
            // and read as "blurry". tiny-skia's stroke / fill AA handles
            // the edge well enough — no need for the gradient halo.
            let mut pb = PathBuilder::new();
            pb.push_circle(jx, jy, r);
            if let Some(path) = pb.finish() {
                let mut paint = Paint::default();
                paint.set_color(hex_to_color(color_str, 1.0));
                paint.anti_alias = true;
                pix.fill_path(
                    &path,
                    &paint,
                    FillRule::Winding,
                    Transform::identity(),
                    None,
                );
            }
            x += spacing;
        }
        y += spacing;
        row += 1;
    }
}

fn render_stripes(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    // Stripe bands draw from the foreground palette (colors[1..]); the
    // background is colors[0] (filled above) — same background/foreground
    // split as the other pattern types.
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }
    let angle_deg = cfg
        .stripes_angle
        .unwrap_or(knob_defaults::STRIPES_ANGLE)
        .clamp(0.0, 90.0);
    let diag = ((w_f * w_f + h_f * h_f).sqrt() * 1.1).max(1.0);
    let scale = w_f.max(h_f) / 1920.0;
    let base_width = cfg.size * scale * 1.5;
    let width_var = cfg.stripes_width_var.unwrap_or(knob_defaults::STRIPES_WIDTH_VAR);

    let transform = Transform::from_translate(w_f / 2.0, h_f / 2.0).pre_rotate(angle_deg);

    let mut x = -diag;
    let mut i = 0usize;
    while x < diag {
        let stripe_w =
            (base_width * (1.0 + (rng.next() - 0.5) * width_var)).max(2.0);
        let color = hex_to_color(palette[i % palette.len()], 1.0);
        let mut paint = Paint::default();
        paint.set_color(color);
        if let Some(rect) =
            Rect::from_xywh(x - 1.0, -diag, stripe_w + 2.0, diag * 2.0)
        {
            pix.fill_rect(rect, &paint, transform, None);
        }
        x += stripe_w;
        i += 1;
    }
}

/// Windows 11 "Bloom"-style flower generator: flowing, translucent
/// gradient petals radiating from a luminous centre, optionally swirled.
/// Each petal is a leaf-shaped closed path filled with a linear gradient
/// between two palette colours; overlaps blend (SrcOver). Two layers (a
/// wide low-alpha back layer + a brighter front layer, angularly offset)
/// plus a soft central radial glow give depth.
///
/// Modifiers: `flower_petals` (count), `flower_twist` (0–1 tangential
/// swirl), plus global `size` (petal reach) and the foreground palette
/// (`colors[1..]`) over the `colors[0]` background.
fn render_flower(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }

    // Foreground palette as RGB, sampled cyclically per petal so the colour
    // wraps around the whole bloom with no seam regardless of how many
    // colours there are — mirrors the live shader's `paletteRing`.
    let pal: Vec<(f32, f32, f32)> = palette.iter().map(|h| hex_to_rgb(h)).collect();

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let min_dim = w_f.min(h_f);

    let petals = cfg.flower_petals.unwrap_or(knob_defaults::FLOWER_PETALS as u32).clamp(2, 64);
    let twist = cfg
        .flower_twist
        .unwrap_or(knob_defaults::FLOWER_TWIST)
        .clamp(0.0, 1.0);
    let two_pi = std::f32::consts::PI * 2.0;

    // Centre, slightly seed-jittered off the middle for an organic
    // composition rather than a perfectly symmetric flower.
    let cx = w_f * (0.5 + (rng.next() - 0.5) * 0.12);
    let cy = h_f * (0.5 + (rng.next() - 0.5) * 0.12);

    let size_scale = cfg.size.max(10.0) / 100.0; // 1.0 at size 100
    let base_r = min_dim * 0.02; // near-point convergence
    let length = min_dim * 0.55 * size_scale; // petal reach
    let global_rot = rng.next() * two_pi;

    // Luminous core: a soft radial bloom under the petals so the centre
    // glows instead of collapsing to a dark convergence point — the key
    // to the "bloom" read rather than "starburst". Uses the first
    // foreground accent; on a light background it's gentle, on dark it
    // lifts the middle.
    {
        let glow_r = length * 0.7;
        let glow_c = palette[0];
        let stops = vec![
            GradientStop::new(0.0, hex_to_color(glow_c, 0.55)),
            GradientStop::new(0.5, hex_to_color(glow_c, 0.22)),
            GradientStop::new(1.0, hex_to_color(glow_c, 0.0)),
        ];
        if let Some(shader) = RadialGradient::new(
            Point::from_xy(cx, cy),
            0.0,
            Point::from_xy(cx, cy),
            glow_r,
            stops,
            SpreadMode::Pad,
            Transform::identity(),
        ) {
            let paint = Paint {
                shader,
                anti_alias: true,
                ..Paint::default()
            };
            if let Some(rect) = Rect::from_xywh(0.0, 0.0, w_f, h_f) {
                pix.fill_rect(rect, &paint, Transform::identity(), None);
            }
        }
    }

    // Back layer: longer + wider + dimmer. Front layer: shorter, brighter,
    // angularly offset by half a petal step so it sits between the back
    // petals.
    for layer in 0..2 {
        let layer_f = layer as f32;
        let len = length * (1.0 - layer_f * 0.30);
        let half_w = len * 0.32;
        let bend = twist * len * 1.4; // tangential offset of the tip
        let alpha = if layer == 0 { 0.42 } else { 0.68 };
        let angle_off = global_rot + layer_f * (two_pi / petals as f32) * 0.5;
        for i in 0..petals {
            let t = i as f32 / petals as f32;
            let jitter_len = len * (1.0 + (rng.next() - 0.5) * 0.18);
            let angle = angle_off
                + t * two_pi
                + (rng.next() - 0.5) * (two_pi / petals as f32) * 0.25;
            // Cyclic colour position: one full ring of petals == one full
            // palette cycle, so petal `petals-1` blends back into petal 0
            // seamlessly for any palette size.
            let plen = pal.len() as f32;
            let t1 = (i as f32 + 1.0) / petals as f32;
            let c0 = cyclic_sample(&pal, t * plen);
            let c1 = cyclic_sample(&pal, t1 * plen);
            draw_petal(pix, cx, cy, base_r, jitter_len, half_w, bend, angle, c0, c1, alpha);
        }
    }
}

/// Draw one bloom petal. Built in local space (pointing along +x from
/// `r0` out to `r0+len`, bulging to ±`half_w` and bending tangentially by
/// `bend` toward +y at the tip), then rotated about `(cx, cy)` by
/// `angle_rad`. Filled with a base→tip linear gradient `c0`→`c1` at
/// `alpha`. The gradient shares the petal's transform so it follows the
/// rotation.
#[allow(clippy::too_many_arguments)]
fn draw_petal(
    pix: &mut Pixmap,
    cx: f32,
    cy: f32,
    r0: f32,
    len: f32,
    half_w: f32,
    bend: f32,
    angle_rad: f32,
    c0: (f32, f32, f32),
    c1: (f32, f32, f32),
    alpha: f32,
) {
    let r1 = r0 + len;
    let mut pb = PathBuilder::new();
    pb.move_to(r0, 0.0);
    // Top edge: base → tip, bulging out to +half_w then easing to the
    // bent tip.
    pb.cubic_to(
        r0 + len * 0.35,
        half_w,
        r0 + len * 0.72,
        half_w * 0.5 + bend * 0.7,
        r1,
        bend,
    );
    // Bottom edge: tip → base, mirrored.
    pb.cubic_to(
        r0 + len * 0.72,
        -half_w * 0.5 + bend * 0.7,
        r0 + len * 0.35,
        -half_w,
        r0,
        0.0,
    );
    pb.close();
    let path = match pb.finish() {
        Some(p) => p,
        None => return,
    };

    let transform = Transform::from_translate(cx, cy).pre_rotate(angle_rad.to_degrees());
    let stops = vec![
        GradientStop::new(0.0, rgb_color(c0, alpha)),
        GradientStop::new(1.0, rgb_color(c1, alpha)),
    ];
    let shader = match LinearGradient::new(
        Point::from_xy(r0, 0.0),
        Point::from_xy(r1, bend),
        stops,
        SpreadMode::Pad,
        transform,
    ) {
        Some(s) => s,
        None => return,
    };
    let paint = Paint {
        shader,
        anti_alias: true,
        ..Paint::default()
    };
    pix.fill_path(&path, &paint, FillRule::Winding, transform, None);

    // Defined edge: outline the petal in a deeper, slightly more saturated
    // shade of its own base hue (mirrors the live shader's per-petal rim) so
    // petals read as distinct instead of melting together.
    let mut edge_paint = Paint {
        anti_alias: true,
        ..Paint::default()
    };
    edge_paint.set_color(edge_shade(c0, alpha));
    let stroke = Stroke {
        width: (half_w * 0.06).max(1.0),
        line_join: LineJoin::Round,
        ..Stroke::default()
    };
    pix.stroke_path(&path, &edge_paint, &stroke, transform, None);
}

/// Parse `#rrggbb` into linear-ish sRGB floats (0..1) for cyclic blending.
fn hex_to_rgb(hex: &str) -> (f32, f32, f32) {
    let c = hex_to_color(hex, 1.0);
    (c.red(), c.green(), c.blue())
}

/// Build a tiny-skia colour from an RGB triple at `alpha`.
fn rgb_color(c: (f32, f32, f32), alpha: f32) -> Color {
    Color::from_rgba(c.0, c.1, c.2, alpha.clamp(0.0, 1.0)).unwrap_or(Color::TRANSPARENT)
}

/// Foreground palette as a closed cyclic ring: `pos` runs 0..len and wraps,
/// so a full revolution of petals lands back on the start hue with no seam,
/// for any palette size. Mirrors the live shader's `paletteRing`.
fn cyclic_sample(pal: &[(f32, f32, f32)], pos: f32) -> (f32, f32, f32) {
    let n = pal.len();
    if n == 0 {
        return (0.0, 0.0, 0.0);
    }
    if n == 1 {
        return pal[0];
    }
    let fln = n as f32;
    let p = pos - fln * (pos / fln).floor(); // wrap into [0, n)
    let i0 = (p.floor() as usize) % n;
    let i1 = (i0 + 1) % n;
    let f = p - p.floor();
    let a = pal[i0];
    let b = pal[i1];
    (
        a.0 + (b.0 - a.0) * f,
        a.1 + (b.1 - a.1) * f,
        a.2 + (b.2 - a.2) * f,
    )
}

/// A deeper, slightly more saturated shade of `c` for the petal rim: push
/// saturation up off the colour's own luma, then darken. Keeps the hue so
/// the edge reads as a shade of the petal, not a flat dark outline.
fn edge_shade(c: (f32, f32, f32), alpha: f32) -> Color {
    let lum = 0.299 * c.0 + 0.587 * c.1 + 0.114 * c.2;
    let s = |x: f32| (lum + (x - lum) * 1.3).clamp(0.0, 1.0) * 0.6;
    Color::from_rgba(s(c.0), s(c.1), s(c.2), alpha.clamp(0.0, 1.0)).unwrap_or(Color::BLACK)
}

/// "Flow" generator: smooth wavy lines that span the canvas edge-to-edge,
/// flowing together like wind-blown strands (the abstract "flowing lines"
/// look). Each line is a polyline sampled across the full width with a
/// coherent sinusoidal vertical displacement — neighbours share a slowly
/// advancing phase so they stay roughly parallel and silky rather than
/// crossing chaotically. Stroked with a left→right gradient between two
/// palette colours, semi-transparent with round caps so overlaps glow.
///
/// Modifiers: `flow_lines` (count), `flow_amplitude` (0–1 wave height),
/// `flow_frequency` (0–1 → wave cycles across the width), global `size`
/// (line thickness), and the foreground palette over the background.
fn render_flow(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let scale = w_f.max(h_f) / 1920.0;
    let two_pi = std::f32::consts::PI * 2.0;

    let lines = cfg.flow_lines.unwrap_or(knob_defaults::FLOW_LINES as u32).clamp(2, 220);
    let amp = cfg
        .flow_amplitude
        .unwrap_or(knob_defaults::FLOW_AMPLITUDE)
        .clamp(0.0, 1.0);
    let freq = cfg
        .flow_frequency
        .unwrap_or(knob_defaults::FLOW_FREQUENCY)
        .clamp(0.0, 1.0);

    let thickness = (cfg.size * scale * 0.12).max(1.0);
    let cycles = remap(freq, 0.5, 3.0); // wave cycles across the width
    let amp_px = amp * h_f * 0.16; // max vertical displacement
    let samples = 160usize; // polyline resolution across the width
    let gphase = rng.next() * two_pi;
    let margin = thickness * 2.0;

    for i in 0..lines {
        let li = i as f32;
        let baseline = (li + 0.5) / lines as f32 * h_f;
        // Slowly advancing per-line phase keeps neighbours nearly in
        // phase → coherent, parallel flow instead of a tangle.
        let phase = gphase + li * 0.22;
        let amp_i = amp_px * (0.8 + rng.next() * 0.4);

        let wave_at = |u: f32| -> f32 {
            // Primary cycle + a slower secondary harmonic for organic,
            // non-repeating waviness.
            let a = (phase + u * cycles * two_pi).sin();
            let b = (phase * 1.7 + u * cycles * 1.9 * two_pi).sin();
            baseline + amp_i * (a + 0.4 * b) * 0.7
        };

        let mut pb = PathBuilder::new();
        let x0 = -margin;
        pb.move_to(x0, wave_at(x0 / w_f));
        for s in 1..=samples {
            let x = -margin + (w_f + margin * 2.0) * (s as f32 / samples as f32);
            pb.line_to(x, wave_at(x / w_f));
        }
        let path = match pb.finish() {
            Some(p) => p,
            None => continue,
        };

        let c0 = palette[i as usize % palette.len()];
        let c1 = palette[(i as usize + 1) % palette.len()];
        let alpha = 0.7;
        let shader = match LinearGradient::new(
            Point::from_xy(0.0, 0.0),
            Point::from_xy(w_f, 0.0),
            vec![
                GradientStop::new(0.0, hex_to_color(c0, alpha)),
                GradientStop::new(1.0, hex_to_color(c1, alpha)),
            ],
            SpreadMode::Pad,
            Transform::identity(),
        ) {
            Some(s) => s,
            None => continue,
        };
        let paint = Paint {
            shader,
            anti_alias: true,
            ..Paint::default()
        };
        let stroke = Stroke {
            width: thickness,
            line_cap: tiny_skia::LineCap::Round,
            ..Stroke::default()
        };
        pix.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
    }
}

/// "Waves" generator: translucent wavy bands stacked back-to-front like
/// layered silk / paper hills. Each layer is a filled region under a
/// wavy top edge, drawn from a higher baseline (back) to a lower one
/// (front), with a vertical gradient fill and slight translucency so the
/// layers behind show through — giving depth.
///
/// Modifiers: `waves_layers` (count), `waves_amplitude` (0–1 crest
/// height), `waves_frequency` (0–1 → cycles across the width), and the
/// foreground palette over the background.
fn render_waves(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let two_pi = std::f32::consts::PI * 2.0;

    let layers = cfg.waves_layers.unwrap_or(knob_defaults::WAVES_LAYERS as u32).clamp(2, 24);
    let amp = cfg
        .waves_amplitude
        .unwrap_or(knob_defaults::WAVES_AMPLITUDE)
        .clamp(0.0, 1.0);
    let freq = cfg
        .waves_frequency
        .unwrap_or(knob_defaults::WAVES_FREQUENCY)
        .clamp(0.0, 1.0);
    let cycles = remap(freq, 0.5, 3.0);
    let amp_px = amp * h_f * 0.11;
    // Sample ~every 4px so the wave edge stays a smooth curve rather
    // than a visibly faceted polyline at apply (4K) resolution.
    let samples = ((w_f / 4.0) as usize).clamp(200, 1200);
    let gphase = rng.next() * two_pi;

    for layer in 0..layers {
        let t = if layers > 1 {
            layer as f32 / (layers - 1) as f32
        } else {
            0.5
        };
        // Back layers sit high, front layers low — they march down the
        // frame so each new (closer) band overlaps the one behind.
        let baseline = remap(t, h_f * 0.12, h_f * 0.9);
        let phase = gphase + layer as f32 * 0.7;
        let amp_l = amp_px * (0.6 + rng.next() * 0.6);
        let c_top = palette[layer as usize % palette.len()];
        let c_bot = palette[(layer as usize + 1) % palette.len()];

        let wave_at = |u: f32| -> f32 {
            let a = (phase + u * cycles * two_pi).sin();
            let b = (phase * 1.6 + u * cycles * 2.1 * two_pi).sin();
            baseline + amp_l * (a + 0.35 * b)
        };

        let mut pb = PathBuilder::new();
        pb.move_to(0.0, h_f);
        pb.line_to(0.0, wave_at(0.0));
        for s in 1..=samples {
            let u = s as f32 / samples as f32;
            pb.line_to(u * w_f, wave_at(u));
        }
        pb.line_to(w_f, h_f);
        pb.close();
        let path = match pb.finish() {
            Some(p) => p,
            None => continue,
        };

        // Vertical gradient from the crest colour down to the next
        // palette colour. Opaque, so each band's top edge is a crisp,
        // sharp boundary against the band behind it (the layered-paper
        // look) rather than a muddy translucent blend.
        let shader = match LinearGradient::new(
            Point::from_xy(0.0, baseline - amp_l),
            Point::from_xy(0.0, h_f),
            vec![
                GradientStop::new(0.0, hex_to_color(c_top, 1.0)),
                GradientStop::new(1.0, hex_to_color(c_bot, 1.0)),
            ],
            SpreadMode::Pad,
            Transform::identity(),
        ) {
            Some(s) => s,
            None => continue,
        };
        let paint = Paint {
            shader,
            anti_alias: true,
            ..Paint::default()
        };
        pix.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
    }
}

/// "Aurora" generator: vertical northern-lights curtains. Each band is a
/// soft vertical ribbon that sways horizontally down the frame, filled
/// with a gradient that fades in at the top and out at the bottom;
/// everything is heavily blurred for the luminous, smoky quality.
///
/// Modifiers: `aurora_bands` (count), `aurora_spread` (0–1 curtain
/// width), `aurora_amplitude` (0–1 horizontal sway), over the palette.
fn render_aurora(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let two_pi = std::f32::consts::PI * 2.0;

    let bands = cfg.aurora_bands.unwrap_or(knob_defaults::AURORA_BANDS as u32).clamp(2, 16);
    let spread = cfg
        .aurora_spread
        .unwrap_or(knob_defaults::AURORA_SPREAD)
        .clamp(0.0, 1.0);
    let amp = cfg
        .aurora_amplitude
        .unwrap_or(knob_defaults::AURORA_AMPLITUDE)
        .clamp(0.0, 1.0);
    let curtain_w = w_f * remap(spread, 0.05, 0.2);
    let sway = amp * w_f * 0.1;
    let samples = 80usize;
    let gphase = rng.next() * two_pi;

    for band in 0..bands {
        let bx = (band as f32 + 0.5) / bands as f32 * w_f
            + (rng.next() - 0.5) * (w_f / bands as f32) * 0.5;
        let phase = gphase + band as f32 * 0.9;
        let hw = curtain_w * (0.6 + rng.next() * 0.7) * 0.5;
        let color = palette[band as usize % palette.len()];

        let center_at = |v: f32| -> f32 {
            bx + sway * ((phase + v * 1.6 * two_pi).sin() + 0.4 * (phase * 1.9 + v * two_pi).sin())
        };

        let mut pb = PathBuilder::new();
        // Left edge, top → bottom.
        pb.move_to(center_at(0.0) - hw, 0.0);
        for s in 1..=samples {
            let v = s as f32 / samples as f32;
            pb.line_to(center_at(v) - hw, v * h_f);
        }
        // Right edge, bottom → top.
        for s in (0..=samples).rev() {
            let v = s as f32 / samples as f32;
            pb.line_to(center_at(v) + hw, v * h_f);
        }
        pb.close();
        let path = match pb.finish() {
            Some(p) => p,
            None => continue,
        };

        // Vertical fade: transparent top → bright middle → transparent
        // bottom, like a hanging curtain of light.
        let shader = match LinearGradient::new(
            Point::from_xy(0.0, 0.0),
            Point::from_xy(0.0, h_f),
            vec![
                GradientStop::new(0.0, hex_to_color(color, 0.0)),
                GradientStop::new(0.45, hex_to_color(color, 0.75)),
                GradientStop::new(0.75, hex_to_color(color, 0.5)),
                GradientStop::new(1.0, hex_to_color(color, 0.0)),
            ],
            SpreadMode::Pad,
            Transform::identity(),
        ) {
            Some(s) => s,
            None => continue,
        };
        let paint = Paint {
            shader,
            anti_alias: true,
            ..Paint::default()
        };
        pix.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
    }
}

/// "Bokeh" generator: soft glowing orbs of light scattered with varying
/// size + opacity (a defocused, depth-of-field look). Each orb is a
/// radial gradient (bright centre → transparent edge); overlaps blend,
/// and the radial alpha falloff gives each orb a naturally soft edge —
/// no blur needed.
///
/// Modifiers: count = `density`, orb radius = `size`, over the palette.
fn render_bokeh(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let max_dim = w_f.max(h_f);
    let scale = max_dim / 1920.0;

    let count = cfg.density.max(4.0) as u32;
    let base_r = (cfg.size.max(4.0) * scale * 2.2).max(8.0);
    let seed_off = (rng.next() * 1000.0) as u32;

    for i in 0..count {
        let cx = halton(i + 1 + seed_off, 2) * w_f;
        let cy = halton(i + 1 + seed_off, 3) * h_f;
        let r = base_r * remap(rng.next(), 0.4, 1.5);
        let alpha = remap(rng.next(), 0.18, 0.6);
        let color = palette[i as usize % palette.len()];
        // Brighter rim than centre reads as an out-of-focus light disc
        // rather than a filled dot.
        let stops = vec![
            GradientStop::new(0.0, hex_to_color(color, alpha * 0.5)),
            GradientStop::new(0.72, hex_to_color(color, alpha)),
            GradientStop::new(0.92, hex_to_color(color, alpha * 0.9)),
            GradientStop::new(1.0, hex_to_color(color, 0.0)),
        ];
        let shader = match RadialGradient::new(
            Point::from_xy(cx, cy),
            0.0,
            Point::from_xy(cx, cy),
            r,
            stops,
            SpreadMode::Pad,
            Transform::identity(),
        ) {
            Some(s) => s,
            None => continue,
        };
        let paint = Paint {
            shader,
            anti_alias: true,
            ..Paint::default()
        };
        if let Some(rect) = Rect::from_xywh(cx - r, cy - r, r * 2.0, r * 2.0) {
            pix.fill_rect(rect, &paint, Transform::identity(), None);
        }
    }
}

/// CPU fallback for the Matrix rain — one frozen frame of the shader's
/// cell math (same hashes, quadratic trail fade) drawing the same baked
/// 5×7 glyphs, so mobile / GPU-fail stills read like a paused instant of
/// the live rain. Custom text rains down each column in sequence, exactly
/// like the shader.
fn render_matrix(pix: &mut Pixmap, cfg: &PatternConfig) {
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }
    let palette = foreground(cfg);
    if palette.is_empty() {
        return;
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let cols = if cfg.density > 0.0 {
        cfg.density.max(8.0)
    } else {
        knob_defaults::MATRIX_DENSITY
    };
    let trail = 5.0
        + cfg
            .matrix_trail
            .unwrap_or(knob_defaults::MATRIX_TRAIL)
            .clamp(0.0, 1.0)
            * 25.0;
    let cell_w = w_f / cols;
    let cell_h = cell_w * 1.5;
    let rows = (h_f / cell_h).ceil().max(1.0) as i32;

    // Same hashes as the shader, keyed on the seed, so still and live
    // frames come from one distribution.
    let seed = cfg.seed as f32;
    let hash1 = |n: f32| ((n * 12.9898 + seed * 0.013).sin() * 43758.5453_f32).fract().abs();
    let hash2 = |x: f32, y: f32| {
        ((x * 127.1 + y * 311.7 + seed * 0.013).sin() * 43758.5453_f32)
            .fract()
            .abs()
    };

    // Custom text as glyph indices (sequential down the column); empty →
    // random full-charset glyphs.
    let text_indices: Vec<usize> = cfg
        .matrix_text
        .as_deref()
        .unwrap_or("")
        .to_uppercase()
        .chars()
        .filter_map(|ch| MATRIX_CHARSET.chars().position(|c| c == ch))
        .take(15)
        .collect();

    let mut paint = Paint::default();
    paint.anti_alias = false;
    let cycle = rows as f32 + trail;

    for cx in 0..(cols.ceil() as i32) {
        let col_r = hash1(cx as f32 * 7.31);
        let offset = hash1(cx as f32 * 13.7);
        let head = offset * cycle;
        let color = hex_to_color(palette[(col_r * 101.0) as usize % palette.len()], 1.0);
        for cy in 0..rows {
            let age = head - cy as f32;
            if age < 0.0 {
                continue;
            }
            let mut bright = (1.0 - age / trail).clamp(0.0, 1.0);
            bright *= bright; // phosphor-decay ease
            if bright <= 0.02 {
                continue;
            }
            let glow = if age <= 1.0 { 0.75 } else { 0.0 };
            let (r, g, b) = (
                color.red() + (1.0 - color.red()) * glow,
                color.green() + (1.0 - color.green()) * glow,
                color.blue() + (1.0 - color.blue()) * glow,
            );
            let Some(c) = Color::from_rgba(r, g, b, bright) else {
                continue;
            };
            paint.set_color(c);

            let glyph_idx = if text_indices.is_empty() {
                (hash2(cx as f32 * 3.17, cy as f32 * 3.17) * MATRIX_FONT.len() as f32)
                    as usize
                    % MATRIX_FONT.len()
            } else {
                text_indices
                    [((cy as f32 + (offset * 977.0).floor()) as usize) % text_indices.len()]
            };
            let (lo, hi) = MATRIX_FONT[glyph_idx % MATRIX_FONT.len()];

            // 5×7 glyph inside a 6×8 sub-grid (one sub-cell of padding).
            let (bx, by) = (cx as f32 * cell_w, cy as f32 * cell_h);
            let (sw, sh) = (cell_w / 6.0, cell_h / 8.0);
            for row in 0..7u32 {
                let bits = if row < 6 { lo >> (row * 5) } else { hi };
                for col in 0..5u32 {
                    if (bits >> col) & 1 == 0 {
                        continue;
                    }
                    if let Some(rect) = Rect::from_xywh(
                        bx + col as f32 * sw,
                        by + row as f32 * sh,
                        sw.max(1.0),
                        sh.max(1.0),
                    ) {
                        pix.fill_rect(rect, &paint, Transform::identity(), None);
                    }
                }
            }
        }
    }
}

/// CPU fallback for the CRT test pattern: the SMPTE bar layout + scanlines.
/// Curvature/noise/roll are shader-only flourishes — the GPU path is the
/// primary look; this keeps mobile / GPU-fail stills recognisably the same
/// test card. Broadcast-standard colours by design (the palette is not
/// consulted — a test card isn't a test card in pastel).
fn render_crt(pix: &mut Pixmap, cfg: &PatternConfig) {
    const BARS: [(f32, f32, f32); 7] = [
        (0.75, 0.75, 0.75),
        (0.75, 0.75, 0.0),
        (0.0, 0.75, 0.75),
        (0.0, 0.75, 0.0),
        (0.75, 0.0, 0.75),
        (0.75, 0.0, 0.0),
        (0.0, 0.0, 0.75),
    ];
    const CASTELLATION: [(f32, f32, f32); 7] = [
        (0.0, 0.0, 0.75),
        (0.0, 0.0, 0.0),
        (0.75, 0.0, 0.75),
        (0.0, 0.0, 0.0),
        (0.0, 0.75, 0.75),
        (0.0, 0.0, 0.0),
        (0.75, 0.75, 0.75),
    ];
    // (right edge as fraction of width, colour) — -I, white, +Q, black,
    // PLUGE steps, black.
    const BOTTOM: [(f32, (f32, f32, f32)); 8] = [
        (0.125, (0.0, 0.129, 0.298)),
        (0.25, (1.0, 1.0, 1.0)),
        (0.375, (0.192, 0.0, 0.42)),
        (0.625, (0.0, 0.0, 0.0)),
        (0.708, (0.015, 0.015, 0.015)),
        (0.791, (0.045, 0.045, 0.045)),
        (0.875, (0.09, 0.09, 0.09)),
        (1.0, (0.0, 0.0, 0.0)),
    ];

    fill_rect_color(pix, Color::from_rgba8(0, 0, 0, 255));
    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let mut paint = Paint::default();
    paint.anti_alias = false;

    let mut fill = |x: f32, y: f32, w: f32, h: f32, (r, g, b): (f32, f32, f32), pix: &mut Pixmap| {
        if let (Some(rect), Some(c)) = (Rect::from_xywh(x, y, w, h), Color::from_rgba(r, g, b, 1.0)) {
            paint.set_color(c);
            pix.fill_rect(rect, &paint, Transform::identity(), None);
        }
    };

    let bar_w = w_f / 7.0;
    for (i, &c) in BARS.iter().enumerate() {
        fill(i as f32 * bar_w, 0.0, bar_w + 1.0, h_f * 0.67, c, pix);
    }
    for (i, &c) in CASTELLATION.iter().enumerate() {
        fill(i as f32 * bar_w, h_f * 0.67, bar_w + 1.0, h_f * 0.08, c, pix);
    }
    let mut left = 0.0_f32;
    for &(right, c) in BOTTOM.iter() {
        fill(
            left * w_f,
            h_f * 0.75,
            (right - left) * w_f + 1.0,
            h_f * 0.25,
            c,
            pix,
        );
        left = right;
    }

    // Scanlines: darken every other row-band, scaled so ~540 bands cover
    // any resolution (band height grows with the pixmap).
    let strength = cfg
        .crt_scanlines
        .unwrap_or(knob_defaults::CRT_SCANLINES)
        .clamp(0.0, 1.0);
    if strength > 0.0 {
        let band = (h_f / 1080.0).max(1.0);
        if let Some(dark) = Color::from_rgba(0.0, 0.0, 0.0, strength * 0.3) {
            paint.set_color(dark);
            let mut y = 0.0;
            while y < h_f {
                if let Some(rect) = Rect::from_xywh(0.0, y, w_f, band) {
                    pix.fill_rect(rect, &paint, Transform::identity(), None);
                }
                y += band * 2.0;
            }
        }
    }
}


fn render_emoji(pix: &mut Pixmap, cfg: &PatternConfig) {
    let mut rng = SeededRng::new(cfg.seed);
    if let Some(base) = cfg.colors.first() {
        fill_rect_color(pix, hex_to_color(base, 1.0));
    }

    let emojis: Vec<&String> = cfg
        .emojis
        .iter()
        .filter(|e| !e.trim().is_empty())
        .collect();
    if emojis.is_empty() {
        return;
    }

    let w_f = pix.width() as f32;
    let h_f = pix.height() as f32;
    let scale = w_f.max(h_f) / 1920.0;
    let size = cfg.size * scale * 1.3;
    let grid = size * (cfg.emoji_spacing.unwrap_or(175.0) / 100.0);
    let rot_max_rad =
        cfg.emoji_rotation_max.unwrap_or(34.0) * std::f32::consts::PI / 180.0;
    let size_var = cfg.emoji_size_var.unwrap_or(0.75);

    // Pre-decode each emoji pixmap via emojis::load (memoized:
    // in-memory → bundled asset → on-disk fetch cache). apply_pattern /
    // render_preview call emojis::preload first, so on-demand glyphs are
    // already cached by now; a still-missing glyph renders a blank slot
    // rather than failing the whole tile.
    let pixmaps: Vec<Option<Pixmap>> = emojis
        .iter()
        .map(|e| {
            crate::emojis::load(e).and_then(|img| {
                let rgba = img.to_rgba8();
                let mut pm = Pixmap::new(rgba.width(), rgba.height())?;
                premultiply_into_pixmap(&rgba, &mut pm);
                Some(pm)
            })
        })
        .collect();

    let mut row = 0;
    let mut y = grid / 2.0;
    while y < h_f + grid {
        let offset = (row % 2) as f32 * grid * 0.5;
        let mut x = -grid + offset;
        while x < w_f + grid {
            let jx = x + (rng.next() - 0.5) * grid * 0.55;
            let jy = y + (rng.next() - 0.5) * grid * 0.55;
            let rotation = (rng.next() - 0.5) * 2.0 * rot_max_rad;
            let size_mul = 1.0 - size_var / 2.0 + rng.next() * size_var;
            let draw_size = size * size_mul;
            let ei = (rng.next() * emojis.len() as f32) as usize;
            let flip = rng.next() < 0.4;

            if let Some(ref emoji_pix) = pixmaps[ei] {
                let src_size = emoji_pix.width().max(emoji_pix.height()) as f32;
                let scale_factor = draw_size / src_size;

                let mut transform = Transform::from_translate(jx, jy);
                if rotation != 0.0 {
                    transform = transform.pre_rotate(rotation.to_degrees());
                }
                if flip {
                    transform = transform.pre_scale(-1.0, 1.0);
                }
                transform = transform
                    .pre_scale(scale_factor, scale_factor)
                    .pre_translate(
                        -(emoji_pix.width() as f32) / 2.0,
                        -(emoji_pix.height() as f32) / 2.0,
                    );

                // Bicubic, not the default Nearest — Nearest made the
                // 256px Fluent art read as blocky/aliased once scaled (and
                // jagged when rotated/flipped). Bicubic resamples smoothly
                // both up and down. The 256px source is still the detail
                // ceiling, but this removes the "low quality" look.
                let paint = PixmapPaint {
                    quality: FilterQuality::Bicubic,
                    ..PixmapPaint::default()
                };
                pix.draw_pixmap(0, 0, emoji_pix.as_ref(), &paint, transform, None);
            }

            x += grid;
        }
        y += grid;
        row += 1;
    }
}

fn premultiply_into_pixmap(src: &image::RgbaImage, dst: &mut Pixmap) {
    let bytes = dst.data_mut();
    for (pixel, slot) in src.pixels().zip(bytes.chunks_exact_mut(4)) {
        let [r, g, b, a] = pixel.0;
        let af = a as f32 / 255.0;
        // Round, not truncate: `as u8` floors, which biased every
        // anti-aliased rim pixel darker and made emoji edges read
        // harsher than the source art.
        slot[0] = (r as f32 * af + 0.5) as u8;
        slot[1] = (g as f32 * af + 0.5) as u8;
        slot[2] = (b as f32 * af + 0.5) as u8;
        slot[3] = a;
    }
}

// ---------------------------------------------------------------------
// Tauri command + URI scheme entry points
// ---------------------------------------------------------------------

/// JPEG encode — way faster than PNG (~5-10×) and ~5× smaller wire
/// payload. The image crate's JPEG encoder only accepts Rgb8 / L8
/// (JPEG itself has no alpha channel), so we drop the alpha byte
/// per pixel before encoding. Patterns always render onto an opaque
/// base (fill_rect first thing in every render fn) so RGB = the
/// final visible color; no unpremultiply pass needed.
///
/// Used for previews; the apply path stays on lossless PNG.
pub fn encode_pixmap_jpeg(pix: &Pixmap, quality: u8) -> Result<Vec<u8>, String> {
    let pixel_count = (pix.width() as usize) * (pix.height() as usize);
    let mut rgb = Vec::with_capacity(pixel_count * 3);
    for chunk in pix.data().chunks_exact(4) {
        rgb.push(chunk[0]);
        rgb.push(chunk[1]);
        rgb.push(chunk[2]);
    }
    let mut buf: Vec<u8> = Vec::with_capacity(pixel_count);
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .encode(&rgb, pix.width(), pix.height(), ExtendedColorType::Rgb8)
        .map_err(|e| format!("encode JPEG: {}", e))?;
    Ok(buf)
}

/// WYSIWYG preview render. Internally renders at the primary monitor
/// resolution (the same resolution the apply path uses) so the shape
/// count + blur + grid spacing exactly match what the user will get
/// when they click Apply — no more "preview shows 5 shapes but the
/// wallpaper has 80." Then downscales to the live wrapper size
/// (passed in width/height) before encoding so the transport stays
/// small and the browser does no scaling.
///
/// JPEG quality 85 is visually lossless for our patterns (no fine text)
/// and encodes ~5-10× faster than PNG. Returned as a
/// `data:image/jpeg;base64,…` string — round-tripping through
/// `tauri::ipc::Response` was producing blank previews in 2.x, and
/// the data-URL form binds straight to `<img src=…>` with no Blob
/// bookkeeping. ~33% wire overhead is fine at preview sizes.
/// Preview render. Width/height come from the live `.preview-wrap`
/// element × devicePixelRatio so the browser does no scaling. We
/// render directly at the displayed resolution (not at the user's
/// full monitor resolution) — at 1280×720 the per-frame budget is
/// 20-40ms and slider drags stay responsive. The trade is that
/// density-derived shape counts in preview lag the final apply value
/// (count scales with canvas_area), but the gap is small enough at
/// preview sizes that the user can still tell low-density from
/// high-density at a glance.
///
/// Returned as a `data:image/jpeg;base64,…` string — round-tripping
/// raw bytes through `tauri::ipc::Response` produced blank previews
/// in 2.x, and the data-URL form binds straight to `<img src=…>`.
pub async fn render_preview(
    config: PatternConfig,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let w = width.clamp(PREVIEW_MIN_DIM, PREVIEW_MAX_W);
    let h = height.clamp(PREVIEW_MIN_DIM, PREVIEW_MAX_H);

    // Fetch any not-yet-cached emoji glyphs before the sync render reads
    // them (the picker offers more than we bundle).
    if matches!(config.pattern_type, PatternType::Emoji) {
        crate::emojis::preload(&config.emojis).await;
    }

    use std::sync::atomic::Ordering;
    // Claim this render's generation; a later call bumps it past ours.
    let my_gen = PREVIEW_GEN.fetch_add(1, Ordering::Relaxed).wrapping_add(1);

    let pix = tokio::task::spawn_blocking(move || {
        // Superseded before we started — skip the render entirely.
        if PREVIEW_GEN.load(Ordering::Relaxed) != my_gen {
            return None;
        }
        // Emoji previews supersample 2× then Lanczos3-downscale so the
        // preview's edge quality matches the applied wallpaper (WYSIWYG).
        // Preview dims are small (≤1280×820), so the 2× intermediate is
        // only ~16 MB and a few ms to downscale — cheap enough to keep
        // the preview responsive. Vector previews stay 1×; tiny-skia
        // already anti-aliases their edges.
        let pix = if matches!(config.pattern_type, PatternType::Emoji) {
            let big = render(&config, w * 2, h * 2);
            downscale(&big, w, h)
        } else {
            render(&config, w, h)
        };
        // Superseded while rendering — drop it before the costly encode.
        if PREVIEW_GEN.load(Ordering::Relaxed) != my_gen {
            return None;
        }
        Some(pix)
    })
    .await
    .map_err(|e| format!("render task join: {}", e))?;

    let Some(pix) = pix else {
        return Err("preview superseded".to_string());
    };

    // Quality 75 is the sweet spot for preview encode time — visually
    // indistinguishable from 85 on pattern art, ~2× faster to encode.
    let bytes = encode_pixmap_jpeg(&pix, 75)?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

/// Render at native monitor resolution and save to disk under
/// app_data/wallpapers/. Library prepend handled here; the caller
/// (TS or rotation task) is expected to invoke set_wallpaper next.
///
/// Quality config: SSAA per pick_ssaa (capped to a ~7680px intermediate
/// on big monitors), Lanczos3 downscale, 16-bit-per-channel PNG output
/// so the sub-8-bit precision from the downscale survives to disk.
///
/// (Real HDR AVIF output was prototyped then removed 2026-06-03 —
/// desktop wallpapers are SDR-composited on every current OS, so a
/// PQ/BT.2020 file renders dark as a wallpaper. Preserved in git history
/// for revival if HDR desktop support ever materializes.)
pub async fn apply_pattern(config: PatternConfig) -> Result<Wallpaper, String> {
    // Fetch any not-yet-cached emoji glyphs before the sync render.
    if matches!(config.pattern_type, PatternType::Emoji) {
        crate::emojis::preload(&config.emojis).await;
    }

    let (w, h) = match get_primary_monitor_pixels() {
        Ok(info) => (info.width, info.height),
        Err(_) => (1920, 1080),
    };
    let ss: u32 = pick_ssaa(config.pattern_type, w.max(h));

    let config_for_render = config.clone();
    let pix = tokio::task::spawn_blocking(move || {
        let big = render(&config_for_render, w * ss, h * ss);
        if ss > 1 {
            downscale(&big, w, h)
        } else {
            big
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    // Content-addressed filename: hash the whole config, not just the
    // seed. Two renders that differ only in shape count / size / shape
    // type / colors (same seed) used to collide on `pattern-<type>-<seed>`
    // and overwrite each other — and because KDE's
    // plasma-apply-wallpaperimage caches by path, re-applying the same
    // path silently kept showing the old image ("Apply does nothing after
    // editing shapes"). Keying on the full config gives every distinct
    // wallpaper its own path (so the compositor reloads), while identical
    // re-applies still resolve to one file (so we don't litter duplicates).
    let stem = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        format!("{config:?}").hash(&mut hasher);
        format!(
            "pattern-{}-{:016x}",
            pattern_type_slug(config.pattern_type),
            hasher.finish()
        )
    };
    // Always write the 16-bit PNG — it's the universal fallback that
    // every OS image-decoder handles and what the Library tab + thumb
    // cache point at. We then try to also write an AVIF HDR sibling;
    // if that succeeds, set_wallpaper will prefer it for the actual
    // OS desktop background on HDR-capable systems.
    let png_path = save_pixmap_16bit_png(&pix, &format!("{}.png", stem))?;

    let entry = Wallpaper {
        path: png_path,
        source: "generated".to_string(),
        added_at: ms_since_epoch(),
        prompt: None,
        title: Some(format!(
            "{} ({} colors)",
            pattern_type_label(config.pattern_type),
            config.colors.len()
        )),
        mode: crate::types::WallpaperMode::Both,
    };
    let _ = prepend_entry(entry.clone()).await;

    // Remember the committed config so the tray "Random wallpaper" action
    // can re-roll it later without the webview running.
    if let Ok(cfg_json) = serde_json::to_value(&config) {
        let _ = crate::state::settings()
            .patch(serde_json::json!({ "lastPattern": cfg_json }))
            .await;
    }
    Ok(entry)
}

/// Tiny xorshift64* RNG for tray-triggered randomization — cosmetic
/// shuffling only, so no rand dependency; seeded from the clock.
struct TrayRng(u64);

impl TrayRng {
    fn new() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9e37_79b9_7f4a_7c15);
        Self(nanos | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in [0, 1).
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + self.unit() * (b - a)
    }

    fn pick<'a>(&mut self, opts: &[&'a str]) -> &'a str {
        opts[(self.next() % opts.len() as u64) as usize]
    }
}

// The curated color presets — the SAME file the frontend imports
// (src/lib/colorPresets.json), so the tray "Random wallpaper" rolls from
// the identical palette + emoji sets the in-app preset picker offers.
// Each entry: { id, name, emojis: [..], dark: [5 hex], light: [5 hex] }.
static COLOR_PRESETS: std::sync::LazyLock<Vec<serde_json::Value>> =
    std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!("../../../src/lib/colorPresets.json"))
            .expect("colorPresets.json parses")
    });

/// Mirror of the frontend's randomizedModifiers (src/lib/patterns.ts):
/// re-roll every knob the pattern type exposes across its full slider
/// range, plus the enum knobs. Keep these tables in lockstep with
/// MODIFIER_RANGES / MODIFIER_CHOICES in src/lib/patterns.ts.
fn randomize_modifiers(
    obj: &mut serde_json::Map<String, serde_json::Value>,
    rng: &mut TrayRng,
) {
    let ty = obj
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("mesh")
        .to_string();

    // (key, min, max, integer)
    let ranges: &[(&str, f64, f64, bool)] = match ty.as_str() {
        "mesh" => &[("meshBubbles", 6.0, 40.0, true), ("meshSoftness", 0.0, 1.0, false)],
        "geometric" => &[("density", 10.0, 200.0, true), ("size", 12.0, 120.0, true)],
        "dots" => &[
            ("density", 8.0, 60.0, true),
            ("size", 6.0, 80.0, true),
            ("dotsJitter", 0.0, 1.0, false),
            ("dotsSizeVar", 0.0, 1.0, false),
        ],
        "stripes" => &[
            ("size", 10.0, 140.0, true),
            ("stripesAngle", 0.0, 90.0, true),
            ("stripesWidthVar", 0.0, 1.0, false),
        ],
        "emoji" => &[
            ("size", 40.0, 140.0, true),
            ("emojiSpacing", 50.0, 300.0, true),
            ("emojiRotationMax", 0.0, 90.0, true),
            ("emojiSizeVar", 0.0, 1.0, false),
        ],
        "flower" | "bloom" => &[
            ("size", 40.0, 160.0, true),
            ("flowerPetals", 5.0, 40.0, true),
            ("flowerTwist", 0.0, 1.0, false),
        ],
        "flow" => &[
            ("size", 6.0, 120.0, true),
            ("flowLines", 6.0, 120.0, true),
            ("flowAmplitude", 0.0, 1.0, false),
            ("flowFrequency", 0.0, 1.0, false),
        ],
        "waves" => &[
            ("wavesLayers", 3.0, 20.0, true),
            ("wavesAmplitude", 0.0, 1.0, false),
            ("wavesFrequency", 0.0, 1.0, false),
        ],
        "aurora" => &[
            ("auroraBands", 3.0, 14.0, true),
            ("auroraSpread", 0.0, 1.0, false),
            ("auroraAmplitude", 0.0, 1.0, false),
        ],
        "bokeh" => &[("density", 8.0, 60.0, true), ("size", 10.0, 120.0, true)],
        "matrix" => &[
            ("density", 16.0, 96.0, true),
            ("matrixTrail", 0.0, 1.0, false),
            ("matrixSpeed", 0.0, 1.0, false),
        ],
        "crt" => &[
            ("crtScanlines", 0.0, 1.0, false),
            ("crtCurvature", 0.0, 1.0, false),
            ("crtNoise", 0.0, 1.0, false),
        ],
        _ => &[],
    };
    for &(key, min, max, int) in ranges {
        let v = rng.range(min, max);
        let value = if int {
            serde_json::json!(v.round() as i64)
        } else {
            serde_json::json!(v)
        };
        obj.insert(key.to_string(), value);
    }

    if ty == "geometric" {
        obj.insert(
            "geometricShape".to_string(),
            serde_json::json!(rng.pick(&[
                "mix", "circles", "triangles", "squares", "hexagons", "stars", "plus"
            ])),
        );
        obj.insert(
            "geometricFill".to_string(),
            serde_json::json!(rng.pick(&["solid", "outline", "mix"])),
        );
    }
}

/// Full tray re-roll of a pattern config: fresh seed, every modifier
/// re-rolled, and a random CURATED preset applied — its theme-matching
/// palette variant plus its emoji set, exactly as if the user had picked
/// that preset in the app (colorPresetId stamped so the UI shows it).
fn reroll_config(value: &mut serde_json::Value, dark: bool) {
    let mut rng = TrayRng::new();
    if let Some(obj) = value.as_object_mut() {
        randomize_modifiers(obj, &mut rng);
        obj.insert(
            "seed".to_string(),
            serde_json::json!((rng.next() % 1_000_000) as u32),
        );

        let presets = &*COLOR_PRESETS;
        if !presets.is_empty() {
            // Avoid re-rolling into the preset that's already applied —
            // on patterns where only the background is visible (emoji),
            // a same-preset roll would look like nothing happened.
            let current = obj
                .get("colorPresetId")
                .and_then(|v| v.as_str())
                .map(str::to_owned);
            let preset = {
                let mut pick =
                    &presets[(rng.next() % presets.len() as u64) as usize];
                if presets.len() > 1 {
                    while pick.get("id").and_then(|v| v.as_str())
                        == current.as_deref()
                    {
                        pick = &presets[(rng.next() % presets.len() as u64) as usize];
                    }
                }
                pick
            };
            let variant = if dark { "dark" } else { "light" };
            if let (Some(colors), Some(emojis), Some(id)) = (
                preset.get(variant),
                preset.get("emojis"),
                preset.get("id"),
            ) {
                obj.insert("colors".to_string(), colors.clone());
                obj.insert("emojis".to_string(), emojis.clone());
                obj.insert("colorPresetId".to_string(), id.clone());
            }
        }
    }
}

/// Tray "Random wallpaper": re-roll the pattern that currently owns the
/// desktop — new seed, new knob values, new palette (the frontend's
/// Shuffle + Colors buttons in one) — and re-apply it. Live wallpaper →
/// through the live pipeline; last committed static pattern (only while it
/// is still the applied wallpaper) → re-render + set. Err when the current
/// wallpaper isn't a pattern, so the caller can fall back to a library
/// shuffle. `dark` picks the palette pole (caller resolves ThemeMode).
pub async fn randomize_current(dark: bool) -> Result<(), String> {
    let cfg = crate::state::settings().get().await;

    if let Some(mut live) = cfg.live_wallpaper {
        // A video / GIF has nothing to re-roll.
        if crate::live::is_video_spec(&live) {
            return Err("current wallpaper is a video".to_string());
        }
        reroll_config(&mut live, dark);
        return crate::live::apply_live_pattern(live).await;
    }

    // Only randomize the stored pattern while it's still on the desktop —
    // pattern renders are content-addressed `pattern-*` files, so the
    // filename of lastApplied tells us whether a photo replaced it since.
    let pattern_on_desktop = cfg.last_applied.as_deref().is_some_and(|p| {
        std::path::Path::new(p)
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("pattern-"))
    });
    let Some(mut value) = cfg.last_pattern.filter(|_| pattern_on_desktop) else {
        return Err("current wallpaper is not a pattern".to_string());
    };
    reroll_config(&mut value, dark);
    let parsed: PatternConfig =
        serde_json::from_value(value).map_err(|e| format!("parse last pattern: {e}"))?;
    let wallpaper = apply_pattern(parsed).await?;
    crate::desktop::apply_wallpaper(&wallpaper.path).await
}

fn pattern_type_slug(t: PatternType) -> &'static str {
    match t {
        PatternType::Mesh => "mesh",
        PatternType::Geometric => "geometric",
        PatternType::Dots => "dots",
        PatternType::Stripes => "stripes",
        PatternType::Emoji => "emoji",
        PatternType::Flower => "flower",
        PatternType::Flow => "flow",
        PatternType::Waves => "waves",
        PatternType::Aurora => "aurora",
        PatternType::Bokeh => "bokeh",
        PatternType::Matrix => "matrix",
        PatternType::Crt => "crt",
    }
}

fn pattern_type_label(t: PatternType) -> &'static str {
    match t {
        PatternType::Mesh => "Mesh",
        PatternType::Geometric => "Geometric",
        PatternType::Dots => "Dots",
        PatternType::Stripes => "Stripes",
        PatternType::Emoji => "Emoji",
        PatternType::Flower => "Flower",
        PatternType::Flow => "Flow",
        PatternType::Waves => "Waves",
        PatternType::Aurora => "Aurora",
        PatternType::Bokeh => "Bokeh",
        PatternType::Matrix => "Matrix",
        PatternType::Crt => "CRT Test",
    }
}

fn downscale(src: &Pixmap, w: u32, h: u32) -> Pixmap {
    let img =
        match image::RgbaImage::from_raw(src.width(), src.height(), src.data().to_vec())
        {
            Some(i) => i,
            None => {
                // Source buffer/dimension mismatch — shouldn't happen, but
                // returning the (correctly sized) source beats panicking.
                tracing::warn!("downscale: source pixmap not convertible; skipping");
                return src.clone();
            }
        };
    // Lanczos3 is the canonical high-quality downscale filter for
    // pattern art — smooth without ringing.
    let down = image::imageops::resize(&img, w, h, image::imageops::FilterType::Lanczos3);
    match Pixmap::new(w, h) {
        Some(mut out) => {
            out.data_mut().copy_from_slice(down.as_raw());
            out
        }
        None => {
            // Target too large (or zero) for tiny-skia — keep the
            // unscaled source rather than panicking.
            tracing::warn!("downscale: target alloc {w}x{h} failed; keeping source size");
            src.clone()
        }
    }
}

/// Pick the SSAA factor for an apply render. We deliberately cap the
/// supersampled intermediate at ~7680-wide so a single apply never
/// allocates more than ~130 MB — the budget that, stacked with
/// concurrent preview renders, kept us clear of OOM.
///
/// Emoji are raster sprites, but they still benefit from SSAA: each
/// glyph is rotated/scaled/flipped, and at 1× the alpha *coverage* at
/// the sprite boundary is rasterized one sample per output pixel — a
/// hard, jagged edge that Bicubic's interior resampling can't soften.
/// Supersampling + the Lanczos3 downscale gives 4–9 coverage samples
/// per final pixel, which is what actually anti-aliases those edges.
/// So emoji gets the more aggressive tier (3× at ≤1440p) while vector
/// patterns, whose edges are already analytically anti-aliased by
/// tiny-skia, only need 2×.
fn pick_ssaa(t: PatternType, max_dim: u32) -> u32 {
    match t {
        PatternType::Emoji => {
            if max_dim <= 2560 {
                3
            } else if max_dim <= 3840 {
                2
            } else {
                1
            }
        }
        _ => {
            if max_dim <= 3840 {
                2
            } else {
                1
            }
        }
    }
}

/// Save the pixmap as 16-bit-per-channel PNG. tiny-skia is 8-bit
/// internally so the high byte of each channel just replicates the low
/// byte (`b << 8 | b` — preserves 0 → 0, 255 → 65535 exactly), but the
/// extra precision DOES show up: the Lanczos3 downscale produces
/// fractional pixel values, and rounding them to 8 bits at save time
/// is what introduces gradient banding. Writing 16-bit lets those
/// intermediate values survive to the OS image decoder.
fn save_pixmap_16bit_png(
    pix: &Pixmap,
    filename: &str,
) -> Result<String, String> {
    let wallpapers = crate::library::wallpaper_dir()?;
    std::fs::create_dir_all(&wallpapers)
        .map_err(|e| format!("create wallpapers dir: {}", e))?;
    let safe = crate::library::safe_filename(filename);
    let target: PathBuf = wallpapers.join(safe);

    let w = pix.width();
    let h = pix.height();
    let mut buf: image::ImageBuffer<image::Rgba<u16>, Vec<u16>> =
        image::ImageBuffer::new(w, h);
    for (out_pixel, chunk) in buf.pixels_mut().zip(pix.data().chunks_exact(4)) {
        let r = chunk[0] as u16;
        let g = chunk[1] as u16;
        let b = chunk[2] as u16;
        let a = chunk[3] as u16;
        *out_pixel = image::Rgba([
            (r << 8) | r,
            (g << 8) | g,
            (b << 8) | b,
            (a << 8) | a,
        ]);
    }
    // Temp-file + rename: this path is content-addressed, so a same-config
    // re-apply rewrites the exact file the OS wallpaper points at — an
    // in-place truncate risks a torn read by the shell mid-write.
    let tmp = target.with_extension("tmp");
    buf.save_with_format(&tmp, image::ImageFormat::Png)
        .map_err(|e| format!("write 16-bit PNG: {}", e))?;
    std::fs::rename(&tmp, &target)
        .map_err(|e| format!("finalize 16-bit PNG: {}", e))?;
    crate::library::schedule_cache_enforcement();

    target
        .to_str()
        .map(String::from)
        .ok_or_else(|| "saved path not UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pins the Rust uniform packer to patternManifest.json: for every
    // pattern type, a default-knob config must pack exactly the values the
    // manifest's uniform tags + defaults describe. Fails if knobs() and the
    // manifest (which also drives the TS packer and the knob UI) drift.
    #[test]
    fn knobs_match_pattern_manifest() {
        let manifest: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/lib/patternManifest.json"))
                .expect("patternManifest.json parses");
        for ty in manifest["types"].as_array().unwrap() {
            let id = ty["id"].as_str().unwrap();
            if id == "emoji" {
                continue; // no shader → no uniform contract
            }
            let knob_default = |key: &str| -> Option<f64> {
                ty["knobs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|k| k["key"] == key)
                    .and_then(|k| k["default"].as_f64())
            };
            let density = knob_default("density").unwrap_or(40.0);
            let size = knob_default("size").unwrap_or(80.0);
            let cfg: PatternConfig = serde_json::from_value(serde_json::json!({
                "type": id,
                "colors": ["#000000"],
                "density": density,
                "size": size,
                "emojis": [],
                "seed": 1,
            }))
            .unwrap();
            let (p1, p2, p3) = knobs(&cfg);

            let mut want = [0.0f32; 3];
            for knob in ty["knobs"].as_array().unwrap() {
                let Some(uniform) = knob["uniform"].as_str() else {
                    continue;
                };
                let slot = match uniform {
                    "p1" => 0,
                    "p2" => 1,
                    "p3" => 2,
                    other => panic!("unknown uniform tag {other}"),
                };
                want[slot] = if let Some(choices) = knob["choices"].as_array() {
                    let default = knob["default"].as_str().unwrap();
                    choices.iter().position(|c| c["id"] == default).unwrap() as f32
                } else if knob["key"] == "density" {
                    density as f32
                } else {
                    knob["default"].as_f64().unwrap() as f32
                };
            }
            assert_eq!([p1, p2, p3], want, "uniform packing drifted for type {id}");
        }
    }

    #[test]
    fn seeded_rng_matches_js_lcg() {
        // First three outputs of the JS LCG with seed 1:
        // s = 1 * 1103515245 + 12345 = 1103527590
        // s / 2^32 = 0.2569963...
        let mut rng = SeededRng::new(1);
        let first = rng.next();
        // Allow for f32 precision difference
        assert!((first - 0.2569963).abs() < 1e-4, "got {}", first);
    }

    #[test]
    fn tray_reroll_applies_a_different_curated_preset() {
        let mut value = serde_json::json!({
            "type": "geometric",
            "colors": ["#000000"],
            "density": 40,
            "size": 80,
            "emojis": [],
            "seed": 1,
            "colorPresetId": "cosmic"
        });
        reroll_config(&mut value, true);
        let obj = value.as_object().unwrap();

        // A curated preset was applied: id stamped (never the one we
        // started on), its dark palette + emoji set copied over.
        let preset_id = obj["colorPresetId"].as_str().unwrap();
        assert_ne!(preset_id, "cosmic");
        let preset = COLOR_PRESETS
            .iter()
            .find(|p| p["id"].as_str() == Some(preset_id))
            .expect("stamped id exists in colorPresets.json");
        assert_eq!(&obj["colors"], preset.get("dark").unwrap());
        assert_eq!(&obj["emojis"], preset.get("emojis").unwrap());

        // Knobs rerolled within the frontend slider ranges.
        let density = obj["density"].as_i64().unwrap();
        assert!((10..=200).contains(&density));
        assert!(obj.contains_key("geometricShape"));
        assert!(obj.contains_key("geometricFill"));

        // The rerolled JSON still parses as a renderer config.
        let parsed: PatternConfig = serde_json::from_value(value).unwrap();
        assert!(matches!(parsed.pattern_type, PatternType::Geometric));
    }

    #[test]
    fn color_presets_json_is_well_formed() {
        assert!(COLOR_PRESETS.len() >= 10);
        for p in COLOR_PRESETS.iter() {
            assert!(p["id"].is_string());
            for variant in ["dark", "light"] {
                let colors = p[variant].as_array().expect("variant array");
                assert_eq!(colors.len(), 5, "{}: 5 colors", p["id"]);
                for c in colors {
                    let s = c.as_str().unwrap();
                    assert!(s.starts_with('#') && s.len() == 7, "bad hex {s}");
                }
            }
            assert!(!p["emojis"].as_array().expect("emojis").is_empty());
        }
    }

    #[test]
    fn halton_base2_sequence() {
        assert_eq!(halton(1, 2), 0.5);
        assert_eq!(halton(2, 2), 0.25);
        assert_eq!(halton(3, 2), 0.75);
    }

    // GPU path end-to-end: render each generative type via `render()` (which
    // routes through the GPU shaders) to a Pixmap PNG, to eyeball against the
    // live wallpaper + confirm the byte order. Needs a GPU, so it's ignored:
    //   cargo test -p ambient-core renderer::tests::gpu_render_all -- --ignored --nocapture
    #[test]
    #[ignore]
    fn gpu_render_all() {
        use serde_json::json;
        let pal = json!(["#0c0a1f", "#7c5cff", "#ec4899", "#fbbf24", "#f1ecff"]);
        let cases = [
            ("bokeh", json!({"type":"bokeh","density":22,"size":60})),
            ("stripes", json!({"type":"stripes","density":20,"size":60,"stripesAngle":30,"stripesWidthVar":0.5})),
            ("geometric", json!({"type":"geometric","density":40,"size":60,"geometricShape":"mix","geometricFill":"mix"})),
            ("mesh", json!({"type":"mesh","density":14,"size":80,"meshBubbles":14,"meshSoftness":0.5})),
            ("dots", json!({"type":"dots","density":18,"size":28,"dotsJitter":0.5,"dotsSizeVar":0.7})),
            ("flow", json!({"type":"flow","density":20,"size":40,"flowLines":28})),
        ];
        for (name, mut spec) in cases {
            spec["colors"] = pal.clone();
            spec["emojis"] = json!([]);
            spec["seed"] = json!(777);
            let cfg: PatternConfig = serde_json::from_value(spec).expect("config");
            // 2560×1440 exercises the >2048px path (catches an SSAA-size limit
            // that would silently fall back to tiny-skia).
            let pix = render(&cfg, 2560, 1440);
            std::fs::write(format!("/tmp/gpu_{name}.png"), pix.encode_png().unwrap()).unwrap();
            eprintln!("wrote /tmp/gpu_{name}.png");
        }
    }

    #[test]
    fn hex_to_color_parses_hash_prefix() {
        let c = hex_to_color("#ff0000", 1.0);
        let cu = c.to_color_u8();
        assert_eq!(cu.red(), 255);
        assert_eq!(cu.green(), 0);
        assert_eq!(cu.blue(), 0);
        assert_eq!(cu.alpha(), 255);
    }

    #[test]
    fn hex_to_color_parses_no_hash() {
        let c = hex_to_color("00ff00", 0.5);
        let cu = c.to_color_u8();
        assert_eq!(cu.red(), 0);
        assert_eq!(cu.green(), 255);
        assert_eq!(cu.blue(), 0);
        // 0.5 * 255 = 127.5 → 127 (truncated)
        assert_eq!(cu.alpha(), 127);
    }

    #[test]
    fn encode_pixmap_jpeg_returns_non_empty_bytes() {
        // Regression: image crate's JpegEncoder rejects Rgba8 — we have
        // to strip alpha. If this test starts producing empty Vec, the
        // preview will silently render blank in the frontend.
        let pix = Pixmap::new(16, 16).unwrap();
        let bytes = encode_pixmap_jpeg(&pix, 85).expect("encode should succeed");
        assert!(!bytes.is_empty());
        // JPEG SOI marker
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn render_mesh_produces_non_empty_pixmap() {
        let cfg = PatternConfig {
            pattern_type: PatternType::Mesh,
            colors: vec!["#000000".into(), "#ff0000".into(), "#00ff00".into()],
            density: 40.0,
            size: 80.0,
            emojis: vec![],
            seed: 42,
            color_preset_id: None,
            mesh_bubbles: Some(4),
            mesh_softness: Some(0.0),
            geometric_shape: None,
            geometric_fill: None,
            dots_jitter: None,
            dots_size_var: None,
            stripes_angle: None,
            stripes_width_var: None,
            emoji_rotation_max: None,
            emoji_size_var: None,
            emoji_spacing: None,
            flower_petals: None,
            flower_twist: None,
            flow_lines: None,
            flow_amplitude: None,
            flow_frequency: None,
            waves_layers: None,
            waves_amplitude: None,
            waves_frequency: None,
            aurora_bands: None,
            aurora_spread: None,
            aurora_amplitude: None,
            matrix_trail: None,
            matrix_speed: None,
            matrix_text: None,
            crt_scanlines: None,
            crt_curvature: None,
            crt_noise: None,
        };
        let pix = render(&cfg, 100, 100);
        // Background is #000000 + bubbles in red/green. At least some
        // pixels should be non-black.
        let any_non_black = pix
            .data()
            .chunks_exact(4)
            .any(|p| p[0] > 5 || p[1] > 5 || p[2] > 5);
        assert!(any_non_black, "mesh render produced all-black pixmap");
    }

    // Every generator must paint *something* over its background — a
    // cheap guard against a render fn that silently no-ops (bad path,
    // empty palette handling, etc.). Dark base + bright foreground, so
    // any lit pixel proves the generator drew.
    fn assert_paints(pattern_type: PatternType) {
        let cfg = PatternConfig {
            pattern_type,
            ..base_cfg()
        };
        let pix = render(&cfg, 320, 180);
        let lit = pix
            .data()
            .chunks_exact(4)
            .any(|p| p[0] > 40 || p[1] > 30 || p[2] > 60);
        assert!(lit, "{pattern_type:?} render produced only background pixels");
    }

    #[test]
    fn render_flower_produces_non_background_pixels() {
        assert_paints(PatternType::Flower);
    }

    #[test]
    fn render_flow_produces_non_background_pixels() {
        assert_paints(PatternType::Flow);
    }

    #[test]
    fn render_waves_produces_non_background_pixels() {
        assert_paints(PatternType::Waves);
    }

    #[test]
    fn render_aurora_produces_non_background_pixels() {
        assert_paints(PatternType::Aurora);
    }

    #[test]
    fn render_matrix_produces_non_background_pixels() {
        assert_paints(PatternType::Matrix);
    }

    #[test]
    fn render_crt_produces_non_background_pixels() {
        assert_paints(PatternType::Crt);
    }

    #[test]
    fn render_bokeh_produces_non_background_pixels() {
        assert_paints(PatternType::Bokeh);
    }

    // Regression: an empty color list must never panic (mesh and stripes
    // used to modulo by cfg.colors.len() / palette.len() == 0). Renders
    // through render_cpu directly so the tiny-skia paths are exercised
    // even on machines where the GPU path would succeed.
    #[test]
    fn empty_colors_does_not_panic() {
        for pattern_type in [
            PatternType::Mesh,
            PatternType::Geometric,
            PatternType::Dots,
            PatternType::Stripes,
            PatternType::Emoji,
            PatternType::Flower,
            PatternType::Flow,
            PatternType::Waves,
            PatternType::Aurora,
            PatternType::Bokeh,
            PatternType::Matrix,
            PatternType::Crt,
        ] {
            let cfg = PatternConfig {
                pattern_type,
                colors: vec![],
                ..base_cfg()
            };
            let pix = render_cpu(&cfg, 64, 64);
            assert_eq!(pix.width(), 64, "{pattern_type:?}");
        }
    }

    // Shared config: dark base + violet/pink/amber foreground, all
    // per-type knobs left at their renderer defaults (None).
    fn base_cfg() -> PatternConfig {
        PatternConfig {
            pattern_type: PatternType::Mesh,
            colors: vec![
                "#0c0a1f".into(),
                "#7c5cff".into(),
                "#ec4899".into(),
                "#fbbf24".into(),
            ],
            density: 40.0,
            size: 100.0,
            emojis: vec![],
            seed: 7,
            color_preset_id: None,
            mesh_bubbles: None,
            mesh_softness: None,
            geometric_shape: None,
            geometric_fill: None,
            dots_jitter: None,
            dots_size_var: None,
            stripes_angle: None,
            stripes_width_var: None,
            emoji_rotation_max: None,
            emoji_size_var: None,
            emoji_spacing: None,
            flower_petals: None,
            flower_twist: None,
            flow_lines: None,
            flow_amplitude: None,
            flow_frequency: None,
            waves_layers: None,
            waves_amplitude: None,
            waves_frequency: None,
            aurora_bands: None,
            aurora_spread: None,
            aurora_amplitude: None,
            matrix_trail: None,
            matrix_speed: None,
            matrix_text: None,
            crt_scanlines: None,
            crt_curvature: None,
            crt_noise: None,
        }
    }
}
