//! Headless GPU renderer.
//!
//! Runs the *same* fragment shaders as the live KDE wallpaper plugin and the
//! in-app WebGL preview — the Qt `.frag` files in
//! `plasma/wallpapers/me.oezcan.ambient/contents/shaders/` — through wgpu
//! (naga's GLSL frontend) to an RGBA8 buffer, so the static PNG render matches
//! the animated look exactly. One algorithm, three deliveries (WebGL / Qt /
//! here). Desktop-only; callers fall back to the tiny-skia renderer if the GPU
//! is unavailable.
//!
//! The wgpu device + per-shader pipelines are created once and cached (the
//! debounced preview path renders on every edit), so only the first render
//! pays adapter/device init. The uniform block mirrors the `.frag` std140
//! layout byte-for-byte (`ShaderUniforms::to_std140`).

#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use wgpu::util::DeviceExt;

// Fullscreen-triangle vertex shader (GLSL, fed through naga like the frags).
// Emits qt_TexCoord0 in [0,1] with a top-left origin so the frag's
// `frag = qt_TexCoord0 * iResolution` matches the live plugin's orientation.
const VERT_GLSL: &str = r#"#version 440
layout(location = 0) out vec2 qt_TexCoord0;
void main() {
    vec2 uv = vec2(float((gl_VertexIndex << 1) & 2), float(gl_VertexIndex & 2));
    qt_TexCoord0 = vec2(uv.x, 1.0 - uv.y);
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
"#;

// The shaders write straight sRGB-ish values (they mix palette colours in
// sRGB, no gamma), so render into a non-sRGB target and store the bytes as-is
// — matching what the live plugin shows.
const TARGET_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// The shader uniforms, matching the `.frag` UBO. Resolved from a
/// PatternConfig by the caller (`gpu_render::uniforms` in renderer.rs).
pub struct ShaderUniforms {
    pub resolution: [f32; 2],
    pub time: f32,
    pub color_count: i32,
    /// Background = colors[0]; foreground = colors[1..]. Up to 6 (c0..c5).
    pub colors: [[f32; 4]; 6],
    pub seed: f32,
    pub size: f32,
    pub p1: f32,
    pub p2: f32,
    pub p3: f32,
}

impl ShaderUniforms {
    /// Pack into the exact std140 layout of the `.frag` `uniform buf` block:
    ///   mat4 qt_Matrix(0); float qt_Opacity(64); vec2 iResolution(72);
    ///   float iTime(80); int colorCount(84); vec4 c0..c5(96..192);
    ///   float seed(192) gSize(196) p1(200) p2(204) p3(208); size 224.
    pub fn to_std140(&self) -> [u8; 224] {
        let mut b = [0u8; 224];
        let put = |b: &mut [u8; 224], off: usize, v: f32| {
            b[off..off + 4].copy_from_slice(&v.to_le_bytes());
        };
        // qt_Matrix = identity (the frag only reads qt_Opacity from the block).
        for i in 0..4 {
            put(&mut b, i * 16 + i * 4, 1.0);
        }
        put(&mut b, 64, 1.0); // qt_Opacity
        put(&mut b, 72, self.resolution[0]);
        put(&mut b, 76, self.resolution[1]);
        put(&mut b, 80, self.time);
        b[84..88].copy_from_slice(&self.color_count.to_le_bytes());
        for (i, c) in self.colors.iter().enumerate() {
            let o = 96 + i * 16;
            for (j, v) in c.iter().enumerate() {
                put(&mut b, o + j * 4, *v);
            }
        }
        put(&mut b, 192, self.seed);
        put(&mut b, 196, self.size);
        put(&mut b, 200, self.p1);
        put(&mut b, 204, self.p2);
        put(&mut b, 208, self.p3);
        b
    }
}

/// Shared, app-lifetime GPU state: one device/queue, the vertex module, the
/// uniform bind-group layout, and a cache of per-fragment-shader pipelines.
struct GpuContext {
    device: wgpu::Device,
    queue: wgpu::Queue,
    vert: wgpu::ShaderModule,
    bgl: wgpu::BindGroupLayout,
    layout: wgpu::PipelineLayout,
    pipelines: Mutex<HashMap<usize, std::sync::Arc<wgpu::RenderPipeline>>>,
    _instance: wgpu::Instance,
    _adapter: wgpu::Adapter,
}

// Init once; an Err (e.g. no adapter) is cached too, so we don't retry the
// slow adapter probe on every render — callers just fall back to tiny-skia.
static GPU: OnceLock<Result<GpuContext, String>> = OnceLock::new();

fn context() -> Result<&'static GpuContext, String> {
    GPU.get_or_init(|| pollster::block_on(init_context()))
        .as_ref()
        .map_err(|e| e.clone())
}

async fn init_context() -> Result<GpuContext, String> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| "no GPU adapter found".to_string())?;
    // Use the adapter's real limits, not downlevel_defaults() — the latter
    // caps max_texture_dimension_2d at 2048, but the SSAA apply path renders
    // at 2×monitor resolution (well past 2048 on any modern display).
    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("ambient-gpu"),
                required_features: wgpu::Features::empty(),
                required_limits: adapter.limits(),
                memory_hints: wgpu::MemoryHints::Performance,
            },
            None,
        )
        .await
        .map_err(|e| format!("request_device: {e}"))?;

    let vert = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("ambient-vert"),
        source: wgpu::ShaderSource::Glsl {
            shader: Cow::Borrowed(VERT_GLSL),
            stage: wgpu::naga::ShaderStage::Vertex,
            defines: Default::default(),
        },
    });
    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("ambient-bgl"),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        }],
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("ambient-layout"),
        bind_group_layouts: &[&bgl],
        push_constant_ranges: &[],
    });

    Ok(GpuContext {
        device,
        queue,
        vert,
        bgl,
        layout,
        pipelines: Mutex::new(HashMap::new()),
        _instance: instance,
        _adapter: adapter,
    })
}

/// Pipeline for `frag_glsl`, cached by its (stable, 'static) string pointer.
fn pipeline_for(
    c: &GpuContext,
    frag_glsl: &'static str,
) -> std::sync::Arc<wgpu::RenderPipeline> {
    let key = frag_glsl.as_ptr() as usize;
    if let Some(p) = c.pipelines.lock().unwrap().get(&key) {
        return p.clone();
    }
    let frag = c.device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("ambient-frag"),
        source: wgpu::ShaderSource::Glsl {
            shader: Cow::Borrowed(frag_glsl),
            stage: wgpu::naga::ShaderStage::Fragment,
            defines: Default::default(),
        },
    });
    let pipeline = std::sync::Arc::new(c.device.create_render_pipeline(
        &wgpu::RenderPipelineDescriptor {
            label: Some("ambient-pipeline"),
            layout: Some(&c.layout),
            vertex: wgpu::VertexState {
                module: &c.vert,
                entry_point: Some("main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &frag,
                entry_point: Some("main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: TARGET_FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        },
    ));
    c.pipelines.lock().unwrap().insert(key, pipeline.clone());
    pipeline
}

/// Render `frag_glsl` (a `'static` Qt `.frag`) at `width`×`height` with
/// `uniforms` (std140 bytes). Returns tightly-packed RGBA8 (`width*height*4`),
/// top row first. Errors (no adapter, map failure) → caller falls back to
/// tiny-skia.
pub fn render_to_rgba8(
    frag_glsl: &'static str,
    width: u32,
    height: u32,
    uniforms: &[u8],
) -> Result<Vec<u8>, String> {
    let c = context()?;
    let pipeline = pipeline_for(c, frag_glsl);
    pollster::block_on(render_with(c, &pipeline, width, height, uniforms))
}

async fn render_with(
    c: &GpuContext,
    pipeline: &wgpu::RenderPipeline,
    width: u32,
    height: u32,
    uniforms: &[u8],
) -> Result<Vec<u8>, String> {
    let ubuf = c.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("ambient-uniforms"),
        contents: uniforms,
        usage: wgpu::BufferUsages::UNIFORM,
    });
    let bind_group = c.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: &c.bgl,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: ubuf.as_entire_binding(),
        }],
    });

    let tex = c.device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: TARGET_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());

    let unpadded = width * 4;
    let padded = unpadded.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
        * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let out_buf = c.device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: (padded * height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut enc = c
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
    {
        let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        rp.set_pipeline(pipeline);
        rp.set_bind_group(0, &bind_group, &[]);
        rp.draw(0..3, 0..1);
    }
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &out_buf,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    c.queue.submit(Some(enc.finish()));

    let slice = out_buf.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    c.device.poll(wgpu::Maintain::Wait).panic_on_timeout();
    rx.recv()
        .map_err(|e| format!("map channel: {e}"))?
        .map_err(|e| format!("buffer map: {e}"))?;

    let data = slice.get_mapped_range();
    let mut out = Vec::with_capacity((unpadded * height) as usize);
    for row in 0..height {
        let start = (row * padded) as usize;
        out.extend_from_slice(&data[start..start + unpadded as usize]);
    }
    drop(data);
    out_buf.unmap();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hexc(h: &str) -> [f32; 4] {
        let h = h.trim_start_matches('#');
        let n = u32::from_str_radix(h, 16).unwrap();
        [
            ((n >> 16) & 255) as f32 / 255.0,
            ((n >> 8) & 255) as f32 / 255.0,
            (n & 255) as f32 / 255.0,
            1.0,
        ]
    }

    // Spike: validates naga accepts our GLSL + the color/orientation match.
    // Needs a GPU, so it's ignored in normal/CI runs:
    //   cargo test --release -p ambient-core gpu::tests::spike_flower -- --ignored --nocapture
    #[test]
    #[ignore]
    fn spike_flower() {
        let frag = include_str!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/flower.frag"
        );
        let u = ShaderUniforms {
            resolution: [800.0, 600.0],
            time: 0.0,
            color_count: 5,
            colors: [
                hexc("#0c0a1f"),
                hexc("#7c5cff"),
                hexc("#ec4899"),
                hexc("#fbbf24"),
                hexc("#f1ecff"),
                [0.0, 0.0, 0.0, 1.0],
            ],
            seed: 7.0,
            size: 100.0,
            p1: 12.0,
            p2: 0.5,
            p3: 0.0,
        };
        let rgba = render_to_rgba8(frag, 800, 600, &u.to_std140()).expect("gpu render");
        let img = image::RgbaImage::from_raw(800, 600, rgba).expect("image");
        img.save("/tmp/spike_flower.png").expect("save");
        eprintln!("wrote /tmp/spike_flower.png");
    }
}
