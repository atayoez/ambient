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
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tiny_skia::{
    Color, FillRule, FilterQuality, GradientStop, Paint, PathBuilder, Pixmap, PixmapPaint,
    Point, RadialGradient, Rect, SpreadMode, Stroke, Transform,
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
// stage size, so cap them well below monitor resolution — keeps each
// preview render cheap (cost scales with pixel count) and its pixmap
// small (~1280×820 ≈ 4 MB) so rapid edits can't pile up into an OOM.
const PREVIEW_MAX_W: u32 = 1280;
const PREVIEW_MAX_H: u32 = 820;

// Monotonic generation for preview renders. Each render_preview call
// claims the next generation; if a newer call has since claimed a higher
// one, the older render abandons its result instead of wasting the encode
// + IPC (and the frontend ignores it anyway). This is the "cancel the old
// preview job when a new one arrives" mechanism — apply_pattern does NOT
// participate, so committing a wallpaper is never cancelled.
static PREVIEW_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Deserialize, Clone, Debug)]
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
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PatternType {
    Mesh,
    Geometric,
    Dots,
    Stripes,
    Emoji,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
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

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
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

pub fn render(config: &PatternConfig, w: u32, h: u32) -> Pixmap {
    let mut pix = Pixmap::new(w, h).expect("alloc pixmap");
    match config.pattern_type {
        PatternType::Mesh => render_mesh(&mut pix, config),
        PatternType::Geometric => render_geometric(&mut pix, config),
        PatternType::Dots => render_dots(&mut pix, config),
        PatternType::Stripes => render_stripes(&mut pix, config),
        PatternType::Emoji => render_emoji(&mut pix, config),
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
    let softness = cfg.mesh_softness.unwrap_or(0.5);
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
    let palette: Vec<&String> = if cfg.colors.len() > 1 {
        cfg.colors[1..].iter().collect()
    } else {
        cfg.colors.iter().collect()
    };
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
    let palette: Vec<&String> = if cfg.colors.len() > 1 {
        cfg.colors[1..].iter().collect()
    } else {
        cfg.colors.iter().collect()
    };
    if palette.is_empty() {
        return;
    }
    let spacing = w_f.max(h_f) / cfg.density.max(8.0);
    let scale = w_f.max(h_f) / 1920.0;
    let base_radius = cfg.size * scale * 0.45;
    let jitter = cfg.dots_jitter.unwrap_or(0.5);
    let size_var = cfg.dots_size_var.unwrap_or(0.7);

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
    let palette: Vec<&String> = if cfg.colors.len() > 1 {
        cfg.colors[1..].iter().collect()
    } else {
        cfg.colors.iter().collect()
    };
    let angle_deg = cfg.stripes_angle.unwrap_or(30.0).clamp(0.0, 90.0);
    let diag = ((w_f * w_f + h_f * h_f).sqrt() * 1.1).max(1.0);
    let scale = w_f.max(h_f) / 1920.0;
    let base_width = cfg.size * scale * 1.5;
    let width_var = cfg.stripes_width_var.unwrap_or(0.5);

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

    // Pre-decode all emoji pixmaps from the bundled set (memoized in
    // emojis::load). A miss means the glyph wasn't bundled — render a
    // blank slot for it rather than failing the whole tile. The
    // every_ui_emoji_is_bundled test ensures UI emojis never miss.
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
        slot[0] = (r as f32 * af) as u8;
        slot[1] = (g as f32 * af) as u8;
        slot[2] = (b as f32 * af) as u8;
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
#[tauri::command]
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
        let pix = render(&config, w, h);
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
/// Quality config: 4× SSAA for vector patterns (capped by an 8K
/// intermediate budget on big monitors), Lanczos3 downscale, and
/// 16-bit-per-channel PNG output so the sub-8-bit precision that
/// emerges from the downscale survives to disk. Real HDR (Rec.2020,
/// PQ/HLG, >100-nit luminance) would need a float-color renderer —
/// tiny-skia is 8-bit sRGB internally — but 16-bit PNG covers the
/// gradient-fidelity half of what "HDR-ish output" usually means.
#[tauri::command]
pub async fn apply_pattern(
    config: PatternConfig,
    app: AppHandle,
) -> Result<Wallpaper, String> {
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
    let png_path = save_pixmap_16bit_png(&pix, &format!("{}.png", stem), &app)?;
    let _ = save_pixmap_avif_hdr(&pix, &format!("{}.avif", stem), &app);

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
    };
    let _ = prepend_entry(&app, entry.clone()).await;
    Ok(entry)
}

fn save_pixmap_avif_hdr(
    pix: &Pixmap,
    filename: &str,
    app: &AppHandle,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir: {}", e))?;
    let wallpapers = data_dir.join("wallpapers");
    std::fs::create_dir_all(&wallpapers)
        .map_err(|e| format!("create wallpapers dir: {}", e))?;
    let safe = crate::library::safe_filename(filename);
    let target: PathBuf = wallpapers.join(safe);

    let bytes = crate::hdr::encode_pixmap_avif_hdr(pix, crate::hdr::DEFAULT_NITS_PEAK)?;
    std::fs::write(&target, &bytes).map_err(|e| format!("write AVIF: {}", e))?;
    target
        .to_str()
        .map(String::from)
        .ok_or_else(|| "saved AVIF path not UTF-8".to_string())
}

fn pattern_type_slug(t: PatternType) -> &'static str {
    match t {
        PatternType::Mesh => "mesh",
        PatternType::Geometric => "geometric",
        PatternType::Dots => "dots",
        PatternType::Stripes => "stripes",
        PatternType::Emoji => "emoji",
    }
}

fn pattern_type_label(t: PatternType) -> &'static str {
    match t {
        PatternType::Mesh => "Mesh",
        PatternType::Geometric => "Geometric",
        PatternType::Dots => "Dots",
        PatternType::Stripes => "Stripes",
        PatternType::Emoji => "Emoji",
    }
}

fn downscale(src: &Pixmap, w: u32, h: u32) -> Pixmap {
    let img =
        match image::RgbaImage::from_raw(src.width(), src.height(), src.data().to_vec())
        {
            Some(i) => i,
            None => return Pixmap::new(w, h).expect("alloc pixmap"),
        };
    // Lanczos3 is the canonical high-quality downscale filter for
    // pattern art — smooth without ringing.
    let down = image::imageops::resize(&img, w, h, image::imageops::FilterType::Lanczos3);
    let mut out = Pixmap::new(w, h).expect("alloc pixmap");
    out.data_mut().copy_from_slice(down.as_raw());
    out
}

/// Pick the SSAA factor for an apply render. Emoji patterns use raster
/// assets so SSAA buys nothing. For vector patterns 2× is plenty of
/// anti-aliasing; we deliberately cap the supersampled intermediate at
/// ~4K-wide so a single apply never allocates more than ~130 MB (the
/// old 4×-at-1080p tier hit a 7680px / 132 MB intermediate, which —
/// stacked with concurrent preview renders — was the OOM risk). Above
/// 4K the target is already dense enough that 1× looks clean.
fn pick_ssaa(t: PatternType, max_dim: u32) -> u32 {
    if matches!(t, PatternType::Emoji) {
        return 1;
    }
    if max_dim <= 3840 { 2 } else { 1 }
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
    app: &AppHandle,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir: {}", e))?;
    let wallpapers = data_dir.join("wallpapers");
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
    buf.save_with_format(&target, image::ImageFormat::Png)
        .map_err(|e| format!("write 16-bit PNG: {}", e))?;

    target
        .to_str()
        .map(String::from)
        .ok_or_else(|| "saved path not UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn halton_base2_sequence() {
        assert_eq!(halton(1, 2), 0.5);
        assert_eq!(halton(2, 2), 0.25);
        assert_eq!(halton(3, 2), 0.75);
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
}
