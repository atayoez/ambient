// Real-HDR encoding for the Pattern apply path.
//
// The earlier version of this file was effectively fake: it took the
// finished 8-bit sRGB pixmap, applied a blind "anything brighter than
// 0.85 → 400 nits" boost, PQ-encoded, and *tagged* the result BT.2020
// without ever converting sRGB primaries into BT.2020 primaries. So the
// colours were colorimetrically wrong on a real HDR display, gradients
// carried 8-bit banding into the 10-bit file, and the highlights were
// invented from clipped values.
//
// This version is genuinely HDR:
//
//   1. It consumes the *supersampled* render (w·ss × h·ss) and
//      downsamples in LINEAR light, averaging the ss² samples per output
//      pixel. Averaging N 8-bit samples recovers ~log2(N) extra bits, so
//      gradients come out smooth (effectively 10–12 bit) instead of
//      banded — and the geometry is identical to the SDR preview, so
//      there's no parallel renderer to drift out of sync.
//   2. It applies the real linear sRGB → linear BT.2020 primary matrix
//      (BT.709 and sRGB share primaries), so colours are correct under
//      the BT.2020/PQ tag.
//   3. Highlights are expanded hue-preservingly against real reference
//      levels: SDR diffuse white maps to 203 nits (ITU-R BT.2408), and
//      luminance above a knee rolls smoothly up toward HL_PEAK_NITS.
//      It's still reconstructed from an SDR-authored source (true
//      above-white emission would need the renderer to emit >1.0, i.e.
//      a float renderer or an explicit per-palette nits control), but
//      it's principled rather than a clip threshold.
//   4. 10-bit PQ (ST.2084), BT.2020-NCL YCbCr, full range, with the
//      colr box patched to BT.2020 + PQ.

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

// ITU-R BT.2408 HDR reference (diffuse) white. SDR "1.0" maps here, so
// midtones keep their familiar brightness and only genuine highlights
// exceed it.
pub const SDR_WHITE_NITS: f32 = 203.0;

// Highlight expansion. Linear (Rec.709) luminance above HL_KNEE rolls
// smoothly from SDR white up to HL_PEAK_NITS — bright pattern highlights
// light past SDR peak on an HDR display without crushing midtones.
const HL_KNEE: f32 = 0.80;
const HL_PEAK_NITS: f32 = 600.0;

/// Decode a single sRGB byte to its linear-light float value (official
/// piecewise sRGB EOTF, not a gamma-2.2 approximation).
pub(crate) fn srgb_to_linear(b: u8) -> f32 {
    let v = b as f32 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear sRGB / BT.709 → linear BT.2020 primary conversion (both D65,
/// so this is a pure 3×3 primary rotation — no white adaptation). These
/// are the canonical BT.709→BT.2020 RGB coefficients.
pub(crate) fn linear_srgb_to_bt2020(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let r2 = 0.627_403_9 * r + 0.329_283_0 * g + 0.043_313_1 * b;
    let g2 = 0.069_097_3 * r + 0.919_540_6 * g + 0.011_362_3 * b;
    let b2 = 0.016_391_4 * r + 0.088_013_2 * g + 0.895_595_8 * b;
    (r2, g2, b2)
}

/// Per-pixel white level in nits. SDR white (203) for everything up to
/// the knee; smoothstep up to HL_PEAK_NITS as linear luminance
/// approaches 1.0. Returned as a single scalar applied to all channels
/// so hue/saturation are preserved.
pub(crate) fn white_nits_for_luma(luma_linear: f32) -> f32 {
    if luma_linear <= HL_KNEE {
        return SDR_WHITE_NITS;
    }
    let t = ((luma_linear - HL_KNEE) / (1.0 - HL_KNEE)).clamp(0.0, 1.0);
    let smooth = t * t * (3.0 - 2.0 * t);
    SDR_WHITE_NITS + smooth * (HL_PEAK_NITS - SDR_WHITE_NITS)
}

/// PQ OETF (ST.2084): linear normalized (0..1 = 0..10000 nits) →
/// PQ-encoded (0..1).
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

/// Encode the supersampled render as a 10-bit BT.2020 + PQ AVIF.
///
/// `big` is the w·ss × h·ss pixmap; `out_w`/`out_h` are the native
/// dimensions. The ss² samples per output pixel are averaged in linear
/// light (the precision win that removes banding). Pipeline per output
/// pixel:
///
///   ss² sRGB samples → linear (EOTF) → average  (effective >8-bit)
///   → linear sRGB → linear BT.2020   (primary matrix)
///   → × white-nits(luma) / 10000     (HDR luminance, hue-preserving)
///   → PQ OETF → BT.2020-NCL Y'CbCr → 10-bit full-range
///   → ravif AV1 (4:4:4) → patch colr to BT.2020 + PQ
pub fn encode_supersampled_avif_hdr(
    big: &Pixmap,
    out_w: u32,
    out_h: u32,
) -> Result<Vec<u8>, String> {
    let bw = big.width();
    let bh = big.height();
    if out_w == 0 || out_h == 0 || bw == 0 || bh == 0 {
        return Err("empty pixmap".to_string());
    }
    // Integer supersample factor per axis. apply_pattern always renders
    // at an exact multiple, but guard against a mismatch by flooring and
    // clamping to ≥1.
    let sx = (bw / out_w).max(1);
    let sy = (bh / out_h).max(1);
    let inv_samples = 1.0 / (sx * sy) as f32;

    let data = big.data();
    let row_bytes = bw as usize * 4;

    let pixel_count = (out_w * out_h) as usize;
    let mut pixels: Vec<[u16; 3]> = Vec::with_capacity(pixel_count);

    for oy in 0..out_h {
        for ox in 0..out_w {
            // Average the ss² block in linear light.
            let mut lr = 0.0f32;
            let mut lg = 0.0f32;
            let mut lb = 0.0f32;
            for dy in 0..sy {
                let py = oy * sy + dy;
                let row = py as usize * row_bytes;
                for dx in 0..sx {
                    let px = ox * sx + dx;
                    let i = row + px as usize * 4;
                    // tiny-skia is premultiplied; our patterns are fully
                    // opaque (alpha 255) so premultiplied == straight.
                    lr += srgb_to_linear(data[i]);
                    lg += srgb_to_linear(data[i + 1]);
                    lb += srgb_to_linear(data[i + 2]);
                }
            }
            lr *= inv_samples;
            lg *= inv_samples;
            lb *= inv_samples;

            // Rec.709 linear luminance drives the highlight expansion;
            // computed on the sRGB-primary linear values before the
            // gamut rotation (luma weighting is for the source gamut).
            let luma = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
            let white = white_nits_for_luma(luma);
            let scale = white / 10000.0;

            let (r2, g2, b2) = linear_srgb_to_bt2020(lr, lg, lb);

            let r_pq = pq_oetf(r2 * scale);
            let g_pq = pq_oetf(g2 * scale);
            let b_pq = pq_oetf(b2 * scale);

            // BT.2020 non-constant luminance Y'CbCr.
            let y = KR * r_pq + KG * g_pq + KB * b_pq;
            let cb = (b_pq - y) / (2.0 * (1.0 - KB));
            let cr = (r_pq - y) / (2.0 * (1.0 - KR));

            let y_q = (y * 1023.0).round().clamp(0.0, 1023.0) as u16;
            let cb_q = (cb * 1024.0 + 512.0).round().clamp(0.0, 1023.0) as u16;
            let cr_q = (cr * 1024.0 + 512.0).round().clamp(0.0, 1023.0) as u16;
            pixels.push([y_q, cb_q, cr_q]);
        }
    }

    encode_avif_10_bit(out_w as usize, out_h as usize, pixels)
}

/// Thin wrapper around ravif's 10-bit raw-planes API.
fn encode_avif_10_bit(
    width: usize,
    height: usize,
    pixels: Vec<[u16; 3]>,
) -> Result<Vec<u8>, String> {
    use rav1e::prelude::PixelRange;
    use ravif::{Encoder, MatrixCoefficients};

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

/// Rewrite the AVIF `colr nclx` box to BT.2020 primaries + PQ (ST.2084)
/// transfer. ravif hardcodes BT.709 + sRGB in its ColorDescription and
/// exposes no setter, even though the samples we hand it are PQ-encoded
/// BT.2020. Without this an HDR decoder would de-gamma our PQ samples as
/// sRGB and the wallpaper would look wildly wrong. matrix_coefficients
/// is already BT2020NCL via ravif's plumbed parameter, so it's left
/// alone.
///
/// The colr nclx form is: "nclx" + colour_primaries(u16) +
/// transfer_characteristics(u16) + matrix_coefficients(u16) + 1 flag
/// byte (bit 7 = full_range). We anchor on "colrnclx" to avoid matching
/// other 4-char "colr" sequences.
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
    use tiny_skia::{Color, Paint, Pixmap, Rect, Transform};

    #[test]
    fn srgb_to_linear_endpoints() {
        assert!(srgb_to_linear(0).abs() < 1e-6);
        assert!((srgb_to_linear(255) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn srgb_to_linear_midpoint_uses_eotf_not_gamma() {
        // sRGB byte 128 decodes to ~0.215 linear via the piecewise EOTF.
        let mid = srgb_to_linear(128);
        assert!((mid - 0.215).abs() < 0.005, "got {}", mid);
    }

    #[test]
    fn bt2020_matrix_preserves_neutral_white() {
        // A neutral (R=G=B) input must stay neutral after the primary
        // rotation — the rows each sum to ~1.0.
        let (r, g, b) = linear_srgb_to_bt2020(1.0, 1.0, 1.0);
        assert!((r - 1.0).abs() < 1e-3, "r {}", r);
        assert!((g - 1.0).abs() < 1e-3, "g {}", g);
        assert!((b - 1.0).abs() < 1e-3, "b {}", b);
    }

    #[test]
    fn bt2020_matrix_desaturates_pure_primaries() {
        // sRGB pure red, expressed in the wider BT.2020 gamut, must have
        // some green/blue content (it sits inside BT.2020's red) — i.e.
        // it is NOT pure (1,0,0) any more. This is exactly what the old
        // "tag but don't convert" path got wrong.
        let (r, g, b) = linear_srgb_to_bt2020(1.0, 0.0, 0.0);
        assert!(r > 0.5 && r < 1.0, "r {}", r);
        assert!(g > 0.0, "g {}", g);
        assert!(b > 0.0, "b {}", b);
    }

    #[test]
    fn white_nits_sdr_below_knee() {
        assert_eq!(white_nits_for_luma(0.0), SDR_WHITE_NITS);
        assert_eq!(white_nits_for_luma(0.5), SDR_WHITE_NITS);
        assert_eq!(white_nits_for_luma(HL_KNEE), SDR_WHITE_NITS);
    }

    #[test]
    fn white_nits_expands_to_peak_at_white() {
        assert!((white_nits_for_luma(1.0) - HL_PEAK_NITS).abs() < 1e-3);
    }

    #[test]
    fn white_nits_monotonic_in_knee() {
        let a = white_nits_for_luma(0.85);
        let b = white_nits_for_luma(0.95);
        assert!(a > SDR_WHITE_NITS && a < b && b < HL_PEAK_NITS, "{a} {b}");
    }

    #[test]
    fn pq_oetf_endpoints() {
        assert_eq!(pq_oetf(0.0), 0.0);
        assert!((pq_oetf(1.0) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn pq_oetf_203_nit_white() {
        // SDR white now lands at 203 nits = 0.0203 of the PQ scale.
        // ST.2084 reference: PQ(0.0203) ≈ 0.578.
        let pq = pq_oetf(SDR_WHITE_NITS / 10000.0);
        assert!((pq - 0.578).abs() < 0.01, "got {}", pq);
    }

    #[test]
    fn patch_colr_nclx_rewrites_primaries_and_transfer() {
        let mut bytes = vec![0u8; 32];
        bytes[10..18].copy_from_slice(b"colrnclx");
        bytes[18..20].copy_from_slice(&[0, 1]); // primaries = BT.709
        bytes[20..22].copy_from_slice(&[0, 13]); // transfer = sRGB
        bytes[22..24].copy_from_slice(&[0, 9]); // matrix = BT.2020 NCL
        bytes[24] = 0x80; // full_range_flag

        patch_colr_nclx_to_hdr(&mut bytes);

        assert_eq!(&bytes[18..20], &[0, 9], "primaries → BT.2020 (9)");
        assert_eq!(&bytes[20..22], &[0, 16], "transfer → PQ (16)");
        assert_eq!(&bytes[22..24], &[0, 9], "matrix stays BT.2020 NCL (9)");
        assert_eq!(bytes[24], 0x80, "full_range_flag stays set");
    }

    #[test]
    fn patch_colr_nclx_is_noop_when_anchor_missing() {
        let mut bytes = vec![0xFFu8; 32];
        let original = bytes.clone();
        patch_colr_nclx_to_hdr(&mut bytes);
        assert_eq!(bytes, original);
    }

    #[test]
    #[ignore = "writes /tmp/hdr_check.avif for manual ffprobe verification"]
    fn save_hdr_check_avif_to_tmp() {
        // Horizontal black→white gradient at 2× supersample so the file
        // exercises the full PQ range + highlight rolloff + linear
        // downscale. ffprobe should report bt2020 / smpte2084 / 10-bit.
        let mut big = Pixmap::new(1280, 720).unwrap();
        for x in 0..1280 {
            let v = (x as f32 / 1279.0 * 255.0) as u8;
            let mut paint = Paint::default();
            paint.set_color(Color::from_rgba8(v, v, v, 255));
            let rect = Rect::from_xywh(x as f32, 0.0, 1.0, 720.0).unwrap();
            big.fill_rect(rect, &paint, Transform::identity(), None);
        }
        let bytes = encode_supersampled_avif_hdr(&big, 640, 360).unwrap();
        std::fs::write("/tmp/hdr_check.avif", &bytes).unwrap();
        eprintln!("wrote /tmp/hdr_check.avif ({} bytes)", bytes.len());
    }

    #[test]
    fn encode_supersampled_avif_hdr_produces_avif_container() {
        // 2× supersampled bright magenta → exercises the linear-average
        // downscale + highlight + ravif encode end to end. 128→64.
        let mut big = Pixmap::new(128, 128).unwrap();
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(255, 0, 255, 255));
        let rect = Rect::from_xywh(0.0, 0.0, 128.0, 128.0).unwrap();
        big.fill_rect(rect, &paint, Transform::identity(), None);

        let bytes = encode_supersampled_avif_hdr(&big, 64, 64)
            .expect("ravif encode should succeed");
        assert!(bytes.len() > 64, "AVIF too short: {}", bytes.len());
        assert_eq!(&bytes[4..8], b"ftyp", "missing ISOBMFF ftyp box");
    }
}
