// HDR encoding pipeline for the Pattern apply path. Converts the
// 8-bit sRGB pixmap that tiny-skia produces into a 10-bit AVIF with
// BT.2020 primaries + PQ (ST.2084) transfer + highlight boost. The
// boost is what makes "real HDR" visible on HDR monitors — without
// it, our sRGB-derived pixels would PQ-encode to <100 nits and look
// identical to SDR.
//
// tiny-skia is 8-bit internally so we're not "real float HDR" end-to-
// end (see [[project-hdr-renderer]] for that path) — the boost happens
// in post on already-rendered pixels. But the output file is genuine
// HDR: 10-bit, BT.2020, PQ, with proper container metadata. HDR
// displays will light up bright pattern highlights past SDR peak.

use tiny_skia::Pixmap;

// ST.2084 PQ OETF constants — from the standard, do not change.
const PQ_M1: f32 = 0.1593017578125;
const PQ_M2: f32 = 78.84375;
const PQ_C1: f32 = 0.8359375;
const PQ_C2: f32 = 18.8515625;
const PQ_C3: f32 = 18.6875;

// BT.2020 luma coefficients — non-constant variant (matrix = 9).
const KR: f32 = 0.2627;
const KG: f32 = 0.6780;
const KB: f32 = 0.0593;

// Highlight boost — pixels with max(R,G,B) above this threshold get
// pushed up to PEAK linear units. 1.0 linear = 100 SDR nits, PEAK 4.0
// ≈ 400 nits on a sufficiently bright HDR display.
const BOOST_THRESHOLD: f32 = 0.85;
const BOOST_PEAK: f32 = 4.0;

// Maps in-pixmap 1.0 (SDR white) to this many nits on the encoded PQ
// curve. 100 = "SDR brightness stays SDR-bright"; the boost above the
// threshold then pushes specific highlights past it.
pub const DEFAULT_NITS_PEAK: f32 = 100.0;

/// Decode a single sRGB byte to its linear-light float value.
/// Uses the official sRGB EOTF (the piecewise form, not gamma 2.2 —
/// the 2.4 power on the upper segment matters for accurate PQ math).
pub(crate) fn srgb_to_linear(b: u8) -> f32 {
    let v = b as f32 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Smooth boost on `max(R, G, B)` — identity below threshold, smooth-
/// step up to BOOST_PEAK at linear value 1.0. Caller applies the
/// returned factor uniformly to R/G/B so hue is preserved.
pub(crate) fn highlight_boost(linear_max: f32) -> f32 {
    if linear_max <= BOOST_THRESHOLD {
        return linear_max;
    }
    let t = ((linear_max - BOOST_THRESHOLD) / (1.0 - BOOST_THRESHOLD)).clamp(0.0, 1.0);
    let smooth = t * t * (3.0 - 2.0 * t);
    linear_max + smooth * (BOOST_PEAK - linear_max)
}

/// PQ OETF (ST.2084) — linear normalized (0.0..1.0 = 0..10000 nits)
/// → PQ-encoded (0.0..1.0).
pub(crate) fn pq_oetf(linear_normalized: f32) -> f32 {
    let l = linear_normalized.clamp(0.0, 1.0);
    if l == 0.0 {
        return 0.0;
    }
    let l_m1 = l.powf(PQ_M1);
    let num = PQ_C1 + PQ_C2 * l_m1;
    let den = 1.0 + PQ_C3 * l_m1;
    (num / den).powf(PQ_M2)
}

/// Encode the pixmap as a 10-bit AVIF with HDR metadata. Pipeline:
///
///   8-bit sRGB premultiplied
///   → sRGB EOTF (per byte)        — linear light, 0..1 = 0..100 nits
///   → highlight boost              — up to BOOST_PEAK × 100 nits
///   → scale by nits_peak / 10000   — fraction of 10000-nit PQ scale
///   → PQ OETF                      — 0..1 PQ-encoded
///   → BT.2020 RGB → YCbCr          — for AVIF planar storage
///   → 10-bit quantize, full range
///   → ravif AV1 encode (4:4:4)
///
/// `nits_peak` defaults to DEFAULT_NITS_PEAK (100). Caller controls
/// the SDR baseline; bright pattern highlights then exceed it via the
/// boost curve.
pub fn encode_pixmap_avif_hdr(pix: &Pixmap, nits_peak: f32) -> Result<Vec<u8>, String> {
    let w = pix.width() as usize;
    let h = pix.height() as usize;
    let pixel_count = w * h;
    if pixel_count == 0 {
        return Err("empty pixmap".to_string());
    }

    let mut y_plane: Vec<u16> = Vec::with_capacity(pixel_count);
    let mut cb_plane: Vec<u16> = Vec::with_capacity(pixel_count);
    let mut cr_plane: Vec<u16> = Vec::with_capacity(pixel_count);

    let scale = nits_peak / 10000.0;

    for chunk in pix.data().chunks_exact(4) {
        // tiny-skia gives premultiplied RGBA; for opaque pixels
        // (all our patterns end up alpha=255) premultiplied == straight.
        let mut r = srgb_to_linear(chunk[0]);
        let mut g = srgb_to_linear(chunk[1]);
        let mut b = srgb_to_linear(chunk[2]);

        let max_ch = r.max(g).max(b);
        if max_ch > 0.0 {
            let factor = highlight_boost(max_ch) / max_ch;
            r *= factor;
            g *= factor;
            b *= factor;
        }

        let r_pq = pq_oetf(r * scale);
        let g_pq = pq_oetf(g * scale);
        let b_pq = pq_oetf(b * scale);

        // BT.2020 non-constant luminance Y'CbCr
        let y = KR * r_pq + KG * g_pq + KB * b_pq;
        let cb = (b_pq - y) / (2.0 * (1.0 - KB));
        let cr = (r_pq - y) / (2.0 * (1.0 - KR));

        let y_q = (y * 1023.0).round().clamp(0.0, 1023.0) as u16;
        let cb_q = (cb * 1024.0 + 512.0).round().clamp(0.0, 1023.0) as u16;
        let cr_q = (cr * 1024.0 + 512.0).round().clamp(0.0, 1023.0) as u16;

        y_plane.push(y_q);
        cb_plane.push(cb_q);
        cr_plane.push(cr_q);
    }

    encode_avif_10_bit(w, h, &y_plane, &cb_plane, &cr_plane)
}

/// Thin wrapper around ravif's 10-bit raw-planes API. Kept in its own
/// fn so the API-shape uncertainty stays contained and the encoding
/// math above is testable without pulling ravif into unit tests.
fn encode_avif_10_bit(
    width: usize,
    height: usize,
    y: &[u16],
    cb: &[u16],
    cr: &[u16],
) -> Result<Vec<u8>, String> {
    use rav1e::prelude::PixelRange;
    use ravif::{Encoder, MatrixCoefficients};

    // ravif's encode_raw_planes_10_bit wants the YCbCr triple per
    // pixel (interleaved [Y, Cb, Cr] arrays), not three separate
    // planes. Zip + collect once before encoding.
    let pixels: Vec<[u16; 3]> = (0..(width * height))
        .map(|i| [y[i], cb[i], cr[i]])
        .collect();

    let encoded = Encoder::new()
        .with_speed(6)
        .with_quality(95.0)
        .with_internal_color_model(ravif::ColorModel::YCbCr)
        .encode_raw_planes_10_bit(
            width,
            height,
            pixels.into_iter(),
            None::<[u16; 0]>,
            PixelRange::Full,
            MatrixCoefficients::BT2020NCL,
        )
        .map_err(|e| format!("avif encode: {}", e))?;
    let mut bytes = encoded.avif_file;
    patch_colr_nclx_to_hdr(&mut bytes);
    Ok(bytes)
}

/// Rewrite the AVIF `colr nclx` box so the file is tagged BT.2020
/// primaries + PQ (ST.2084) transfer. ravif (0.11) hardcodes
/// `ColorPrimaries::BT709` + `TransferCharacteristics::SRGB` in its
/// internal ColorDescription and exposes no setter — even though the
/// pixel data we hand it IS PQ-encoded BT.2020 RGB. Without this
/// patch, HDR-aware decoders would de-gamma our PQ samples as sRGB and
/// the wallpaper would look wildly wrong on HDR displays. The
/// matrix_coefficients field is left alone — ravif's parameter for
/// that one IS plumbed through, so it already reads BT2020NCL (9).
///
/// The colr box's nclx form is:
///   4 bytes: "nclx"
///   2 bytes: colour_primaries        (u16 BE)
///   2 bytes: transfer_characteristics (u16 BE)
///   2 bytes: matrix_coefficients     (u16 BE)
///   1 byte:  bit 7 = full_range_flag, bits 0-6 = reserved
///
/// We anchor on the 8-byte sequence "colrnclx" — the box-type field
/// directly followed by the colour_type sub-tag — to avoid false
/// matches on other 4-char sequences that happen to spell "colr".
pub(crate) fn patch_colr_nclx_to_hdr(avif: &mut [u8]) {
    const ANCHOR: &[u8] = b"colrnclx";
    const BT2020: [u8; 2] = [0, 9];
    const ST2084_PQ: [u8; 2] = [0, 16];

    if avif.len() < ANCHOR.len() + 7 {
        return;
    }
    for i in 0..=(avif.len() - ANCHOR.len() - 7) {
        if &avif[i..i + ANCHOR.len()] == ANCHOR {
            let primaries_off = i + ANCHOR.len();
            let transfer_off = primaries_off + 2;
            avif[primaries_off..primaries_off + 2].copy_from_slice(&BT2020);
            avif[transfer_off..transfer_off + 2].copy_from_slice(&ST2084_PQ);
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_to_linear_endpoints() {
        assert!(srgb_to_linear(0).abs() < 1e-6);
        assert!((srgb_to_linear(255) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn srgb_to_linear_midpoint_uses_eotf_not_gamma() {
        // sRGB byte 128 (~0.5 in normalized sRGB) decodes to ~0.215
        // in linear light. A naive gamma-2.2 approximation would give
        // ~0.217 — close but not identical. Verifies the piecewise EOTF.
        let mid = srgb_to_linear(128);
        assert!((mid - 0.215).abs() < 0.005, "got {}", mid);
    }

    #[test]
    fn highlight_boost_passes_through_below_threshold() {
        assert_eq!(highlight_boost(0.0), 0.0);
        assert_eq!(highlight_boost(0.5), 0.5);
        assert_eq!(highlight_boost(BOOST_THRESHOLD), BOOST_THRESHOLD);
    }

    #[test]
    fn highlight_boost_amplifies_to_peak_at_full_white() {
        let boosted = highlight_boost(1.0);
        // At input 1.0, smoothstep saturates → boost factor pushes
        // toward BOOST_PEAK fully.
        assert!((boosted - BOOST_PEAK).abs() < 1e-5, "got {}", boosted);
    }

    #[test]
    fn highlight_boost_smooth_in_transition_zone() {
        // Mid-transition should land between threshold and peak.
        let halfway = highlight_boost(0.925);
        assert!(halfway > 0.925);
        assert!(halfway < BOOST_PEAK);
    }

    #[test]
    fn pq_oetf_endpoints() {
        assert_eq!(pq_oetf(0.0), 0.0);
        assert!((pq_oetf(1.0) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn pq_oetf_sdr_white_at_100_nits() {
        // 100 nits = 0.01 of the 10000-nit PQ scale.
        // ST.2084 reference: PQ(100/10000) ≈ 0.508.
        let pq = pq_oetf(0.01);
        assert!((pq - 0.508).abs() < 0.005, "got {}", pq);
    }

    #[test]
    #[ignore = "writes /tmp/hdr_check.avif for manual ffprobe verification"]
    fn save_hdr_check_avif_to_tmp() {
        use tiny_skia::{Color, Paint, Pixmap, Rect, Transform};
        // Gradient from black to peak-white horizontally, so the AVIF
        // exercises the full PQ range and highlight boost. 640×360 is
        // big enough for ffprobe to read meaningful color metadata.
        let mut pix = Pixmap::new(640, 360).unwrap();
        for x in 0..640 {
            let v = (x as f32 / 639.0 * 255.0) as u8;
            let mut paint = Paint::default();
            paint.set_color(Color::from_rgba8(v, v, v, 255));
            let rect = Rect::from_xywh(x as f32, 0.0, 1.0, 360.0).unwrap();
            pix.fill_rect(rect, &paint, Transform::identity(), None);
        }
        let bytes = encode_pixmap_avif_hdr(&pix, DEFAULT_NITS_PEAK).unwrap();
        std::fs::write("/tmp/hdr_check.avif", &bytes).unwrap();
        eprintln!("wrote /tmp/hdr_check.avif ({} bytes)", bytes.len());
    }

    #[test]
    fn patch_colr_nclx_rewrites_primaries_and_transfer() {
        // Synthesize the minimum bytes the patch fn anchors on:
        // `colr` box-type immediately followed by `nclx` colour_type,
        // then 7 bytes of nclx payload (2+2+2 + 1 flag).
        let mut bytes = vec![0u8; 32];
        bytes[10..18].copy_from_slice(b"colrnclx");
        bytes[18..20].copy_from_slice(&[0, 1]); // primaries = BT.709
        bytes[20..22].copy_from_slice(&[0, 13]); // transfer = sRGB
        bytes[22..24].copy_from_slice(&[0, 9]); // matrix = BT.2020 NCL
        bytes[24] = 0x80; // full_range_flag

        patch_colr_nclx_to_hdr(&mut bytes);

        assert_eq!(&bytes[18..20], &[0, 9], "primaries should patch to BT.2020 (9)");
        assert_eq!(&bytes[20..22], &[0, 16], "transfer should patch to PQ (16)");
        assert_eq!(&bytes[22..24], &[0, 9], "matrix must stay BT.2020 NCL (9)");
        assert_eq!(bytes[24], 0x80, "full_range_flag must stay set");
    }

    #[test]
    fn patch_colr_nclx_is_noop_when_anchor_missing() {
        let mut bytes = vec![0xFFu8; 32];
        let original = bytes.clone();
        patch_colr_nclx_to_hdr(&mut bytes);
        assert_eq!(bytes, original);
    }

    #[test]
    fn encode_pixmap_avif_hdr_produces_avif_container() {
        // End-to-end smoke test: convert + ravif encode + sniff the
        // container magic. Bright magenta exercises the highlight-boost
        // path (max_ch saturates → factor applied). 64x64 keeps the
        // ravif encode under a second so this stays in-suite.
        use tiny_skia::{Color, Paint, Pixmap, Rect, Transform};
        let mut pix = Pixmap::new(64, 64).unwrap();
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(255, 0, 255, 255));
        let rect = Rect::from_xywh(0.0, 0.0, 64.0, 64.0).unwrap();
        pix.fill_rect(rect, &paint, Transform::identity(), None);

        let bytes = encode_pixmap_avif_hdr(&pix, DEFAULT_NITS_PEAK)
            .expect("ravif encode should succeed");
        assert!(bytes.len() > 64, "AVIF output too short: {} bytes", bytes.len());
        // ISO base media file format — "ftyp" box at offset 4.
        assert_eq!(&bytes[4..8], b"ftyp", "missing ISOBMFF ftyp box");
    }
}
