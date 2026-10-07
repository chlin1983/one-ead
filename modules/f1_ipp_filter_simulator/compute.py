"""F1 IPP IIR filter-design pipeline — pure DSP core.

Reused verbatim from the F1FilterSimulator desktop app, with the tkinter/
matplotlib GUI stripped away. Only numpy/scipy are required, so this runs
unchanged behind the portal's API.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import (
    firwin2, freqz, tf2sos, sos2tf, sosfreqz, minimum_phase,
)

# F1 DSP constants
FS = 33125   # fixed sampling rate (Hz)
FMIN = 100   # lower measurement limit (Hz)
FMAX = 10000  # upper measurement limit (Hz)

# Stimulus level used by Meas.HA_input_sine; deviation = level - STIMULUS_DBSPL.
STIMULUS_DBSPL = 70.0


def load_hxml_bytes(data: bytes) -> tuple:
    """Parse a Widex HA_input_sine HXML from raw bytes.

    Returns ``(freq, tf_db, serial, label)`` where ``tf_db = level - 70`` is the
    microphone deviation from the 70 dBSPL stimulus (same quantity the desktop
    app's ``load_hxml`` produces). Expects ``<curve name="f">`` and
    ``<curve name="level">`` elements.
    """
    import xml.etree.ElementTree as ET

    data = data.lstrip(b"\xef\xbb\xbf")
    root = ET.fromstring(data)

    sn_elem = root.find(".//serialNumber")
    sn = sn_elem.text.strip() if (sn_elem is not None and sn_elem.text) else ""
    label_elem = root.find(".//shortDataSetDesc")
    label = label_elem.text.strip() if (label_elem is not None and label_elem.text) else ""
    cd_elem = root.find(".//curvedata")
    if cd_elem is not None:
        cd_name = cd_elem.get("CurveDataName", "")
        if cd_name:
            label = f"{label}  [{cd_name}]" if label else cd_name

    freq_arr = None
    level_arr = None
    for curve in root.iter("curve"):
        name = curve.get("name", "")
        if name not in ("f", "level"):
            continue
        if (name == "f" and freq_arr is not None) or (name == "level" and level_arr is not None):
            continue
        text = (curve.text or "").strip().strip("[]")
        if not text:
            continue
        try:
            vals = np.array([float(v) for v in text.split()])
        except ValueError:
            continue  # skip complex/matrix curves; take the first plain-numeric one
        if name == "f":
            freq_arr = vals
        else:
            level_arr = vals
        if freq_arr is not None and level_arr is not None:
            break

    if freq_arr is None or level_arr is None:
        raise ValueError('HXML must contain both <curve name="f"> and <curve name="level">.')
    if len(freq_arr) != len(level_arr):
        raise ValueError(
            f"Frequency ({len(freq_arr)} pts) and level ({len(level_arr)} pts) arrays differ in length."
        )
    return freq_arr, level_arr - STIMULUS_DBSPL, sn, label


def load_filter_hxml_bytes(data: bytes) -> tuple:
    """Parse a device IIR filter HXML (curves ``f`` + ``magnitude``, e.g. SF3_SS2_*).

    Returns ``(freq, mag_db, serial, label)`` — the real ``H_IPP_IIR`` filter
    frequency response the device saved, for overlay/comparison.
    """
    import xml.etree.ElementTree as ET

    data = data.lstrip(b"\xef\xbb\xbf")
    root = ET.fromstring(data)

    sn_elem = root.find(".//serialNumber")
    sn = sn_elem.text.strip() if (sn_elem is not None and sn_elem.text) else ""
    label_elem = root.find(".//shortDataSetDesc")
    label = label_elem.text.strip() if (label_elem is not None and label_elem.text) else ""
    cd_elem = root.find(".//curvedata")
    if cd_elem is not None:
        cd_name = cd_elem.get("CurveDataName", "")
        if cd_name:
            label = f"{label}  [{cd_name}]" if label else cd_name

    freq_arr = None
    mag_arr = None
    for curve in root.iter("curve"):
        name = curve.get("name", "")
        if name not in ("f", "magnitude"):
            continue
        if (name == "f" and freq_arr is not None) or (name == "magnitude" and mag_arr is not None):
            continue
        text = (curve.text or "").strip().strip("[]")
        if not text:
            continue
        try:
            vals = np.array([float(v) for v in text.split()])
        except ValueError:
            continue
        if name == "f":
            freq_arr = vals
        else:
            mag_arr = vals
        if freq_arr is not None and mag_arr is not None:
            break

    if freq_arr is None or mag_arr is None:
        raise ValueError('Filter HXML must contain both <curve name="f"> and <curve name="magnitude">.')
    if len(freq_arr) != len(mag_arr):
        raise ValueError(
            f"Frequency ({len(freq_arr)} pts) and magnitude ({len(mag_arr)} pts) arrays differ in length."
        )
    return freq_arr, mag_arr, sn, label


def generate_mic_deviation(shape: str, freq: np.ndarray, amp: float = 1.0) -> np.ndarray:
    """Return a simulated microphone frequency-response deviation (dB)."""
    lg = np.log(freq / 1000.0)
    if shape == 'bumpy':
        tf = (2.5 * np.sin(0.8 * lg)
              + 1.5 * np.cos(1.2 * np.log(freq / 500))
              - 1.0 * np.sin(2.0 * np.log(freq / 3000)))
    elif shape == 'flat':
        tf = np.zeros_like(freq)
    elif shape == 'high_boost':
        tf = 3.0 * np.log10(freq / 1000.0)
    elif shape == 'low_boost':
        tf = -3.0 * np.log10(freq / 1000.0)
    elif shape == 'resonance':
        tf = 4.0 * np.exp(-((np.log10(freq) - np.log10(3000)) ** 2) / 0.02)
    elif shape == 'random':
        rng = np.random.default_rng(42)
        tf = np.cumsum(rng.normal(0, 0.3, size=len(freq)))
        tf -= np.interp(1000, freq, tf)   # anchor at 1 kHz
    else:
        tf = np.zeros_like(freq)
    return tf * amp


def normalize_at(freq: np.ndarray, tf: np.ndarray, fnorm: float) -> np.ndarray:
    """Subtract the value at fnorm so response = 0 dB at fnorm."""
    return tf - float(np.interp(fnorm, freq, tf))


def invert_db(tf: np.ndarray) -> np.ndarray:
    """Flip sign: correction target = -TF."""
    return -tf


def lf_floor(freq: np.ndarray, tf: np.ndarray, floor_hz: float) -> np.ndarray:
    """Clamp values below floor_hz to the value at floor_hz."""
    out = tf.copy()
    out[freq <= floor_hz] = float(np.interp(floor_hz, freq, tf))
    return out


def frac_octave_smooth(freq: np.ndarray, tf: np.ndarray, N: int) -> np.ndarray:
    """1/N fractional-octave moving average."""
    out = np.empty_like(tf)
    for i, fc in enumerate(freq):
        lo = fc * 2 ** (-0.5 / N)
        hi = fc * 2 ** (+0.5 / N)
        mask = (freq >= lo) & (freq <= hi)
        out[i] = tf[mask].mean() if mask.any() else tf[i]
    return out


def erbl_16band_smooth(freq: np.ndarray, tf: np.ndarray) -> np.ndarray:
    """Approximate 16-band ERB-aligned smoothing (SmoothSelect = 2)."""
    centers = np.array([
        100, 160, 250, 350, 450, 570, 700, 840,
        1000, 1200, 1500, 2000, 2700, 3700, 5300, 7500,
    ], dtype=float)
    centers = centers[(centers >= freq.min()) & (centers <= freq.max())]
    out = np.empty_like(tf)
    for i, f in enumerate(freq):
        idx = np.argmin(np.abs(np.log(f) - np.log(centers)))
        lo, hi = centers[idx] * 0.80, centers[idx] * 1.25
        mask = (freq >= lo) & (freq <= hi)
        out[i] = tf[mask].mean() if mask.any() else tf[i]
    return out


# 16-channel band-combine center frequencies (Hz), derived from the reference
# fftTo16chSmooth 48->16 band map. Same centers the device uses for SmoothSelect=2.
_CH16_CENTERS = np.array([
    100, 250, 500, 750, 1000, 1250, 1875, 2875, 3875,
    4875, 5875, 6875, 7875, 8875, 9875, 11125,
], dtype=float)

# (lower, upper) Hz band edges for each of the 16 channels (from the 48-band grid).
_CH16_LOWER = np.array([1, 125, 375, 625, 875, 1125, 1375, 2375, 3375,
                        4375, 5375, 6375, 7375, 8375, 9375, 10375], dtype=float)
_CH16_UPPER = np.array([225, 375, 625, 875, 1125, 1375, 2375, 3375, 4375,
                        5375, 6375, 7375, 8375, 9375, 10375, 11875], dtype=float)


def fft_to_16ch_smooth(freq: np.ndarray, h_lin: np.ndarray) -> tuple:
    """Faithful port of the reference `fftTo16chSmooth` (SmoothSelect = 2).

    Given a linear-magnitude correction target on the measurement grid, build a
    dense FIR power spectrum, average it into 16 channels (48->16 band-combine),
    and return ``(center_freqs_hz, magnitude_lin)`` including the [0, fs/2] edges.
    """
    fs = FS
    # Edge-extend exactly like GenerateFilterCoefs before smoothing.
    freqs_ext = np.concatenate([[0.0], np.asarray(freq, float), [fs / 2]])
    h_ext = np.concatenate([[h_lin[0]], np.asarray(h_lin, float), [h_lin[-1] / 10.0]])
    fn = np.clip(freqs_ext / (fs / 2), 0.0, 1.0)
    fn[0], fn[-1] = 0.0, 1.0

    # fir2(4096, ...) -> 4097-tap prototype, then its power spectrum on 4096 bins.
    h_sys = firwin2(4097, fn, h_ext)
    N = 4096
    w = np.linspace(0.0, np.pi, N, endpoint=False)
    _, H = freqz(h_sys, worN=w)
    power = np.abs(H) ** 2
    f_bins = np.linspace(0.0, fs / 2, N)

    ch16 = np.empty(16)
    for i in range(16):
        mask = (f_bins > _CH16_LOWER[i]) & (f_bins <= _CH16_UPPER[i])
        ch16[i] = power[mask].mean() if mask.any() else power[int(np.argmin(np.abs(f_bins - _CH16_CENTERS[i])))]

    fout = np.concatenate([[0.0], _CH16_CENTERS, [fs / 2]])
    out = np.sqrt(np.concatenate([[ch16[0]], ch16, [ch16[-1]]]))
    return fout, out


def fft_to_third_octave_weighted(freq: np.ndarray, h_lin: np.ndarray, x: float,
                                 smooth_start_freq: float = 100.0) -> tuple:
    """Faithful port of the reference `fftToThirdOctaveWeighted` (SmoothSelect = 1).

    1/x fractional-octave smoothing via a dense FIR power spectrum, Hann-weighted
    band RMS, with a fade from unsmoothed to smoothed above ``smooth_start_freq``.
    ``x`` is the SmoothFactor (3 = 1/3 octave, 6 = 1/6 octave, ...). Returns
    ``(center_freqs_hz, magnitude_lin)`` on the dense linear grid.
    """
    fs = FS
    freqs_ext = np.concatenate([[0.0], np.asarray(freq, float), [fs / 2]])
    h_ext = np.concatenate([[h_lin[0]], np.asarray(h_lin, float), [h_lin[-1] / 10.0]])
    fn = np.clip(freqs_ext / (fs / 2), 0.0, 1.0)
    fn[0], fn[-1] = 0.0, 1.0

    h_sys = firwin2(4097, fn, h_ext)
    N = 4096
    w = np.linspace(0.0, np.pi, N, endpoint=False)
    _, H = freqz(h_sys, worN=w)
    power = np.abs(H) ** 2
    f = np.linspace(0.0, fs / 2, N)

    factor = 2.0 ** (1.0 / max(x, 1e-6))
    lower = f / factor
    upper = f * factor
    octave = np.zeros(N)
    binband = np.zeros(N)
    fout = np.zeros(N)
    for i in range(N):
        lo = int(np.searchsorted(f, lower[i], "left"))
        hi = int(np.searchsorted(f, upper[i], "right"))
        cnt = hi - lo
        if cnt > 1:
            weight = np.hanning(cnt + 2)[1:-1]
            weight = weight / weight.sum()
            octave[i] = np.sqrt(np.sum(power[lo:hi] * weight))
            fout[i] = f[lo:hi].mean()
            center = int(round((lo + hi - 1) / 2.0))
            binband[i] = np.sqrt(power[center])
        else:
            octave[i] = np.sqrt(power[lo:hi].sum()) if cnt >= 1 else 0.0
            binband[i] = octave[i]
            fout[i] = f[i]

    out = binband.copy()
    freqspan = 1000.0
    fade = np.where((fout > smooth_start_freq) & (fout < smooth_start_freq + freqspan))[0]
    if fade.size:
        alpha = np.linspace(0.0, 1.0, fade.size)
        out[fade] = octave[fade] * alpha + binband[fade] * (1.0 - alpha)
    above = fout > smooth_start_freq + freqspan
    out[above] = octave[above]
    fout[0], fout[-1] = 0.0, fs / 2
    # Use the strictly-increasing linear grid for the FIR axis (fout ~= f).
    return f, out




def smooth_response(freq, tf, method: int, N: int) -> np.ndarray:
    if method == 0:
        return tf.copy()
    elif method == 1:
        return frac_octave_smooth(freq, tf, N)
    return erbl_16band_smooth(freq, tf)


def design_fir(freq: np.ndarray, tf_db: np.ndarray, n_taps: int) -> np.ndarray:
    """FIR prototype from a dB magnitude target using firwin2 (== MATLAB fir2)."""
    if n_taps % 2 == 0:
        n_taps += 1   # ensure Type I FIR (symmetric, odd length)

    fn = np.clip(freq / (FS / 2), 0.0, 1.0)
    h_lin = 10 ** (tf_db / 20.0)
    if fn[0] > 0:
        fn = np.concatenate([[0.0], fn])
        h_lin = np.concatenate([[h_lin[0]], h_lin])
    if fn[-1] < 1.0:
        fn = np.concatenate([fn, [1.0]])
        h_lin = np.concatenate([h_lin, [h_lin[-1] / 10.0]])
    return firwin2(n_taps, fn, h_lin)


def _polystab(a: np.ndarray) -> np.ndarray:
    """MATLAB polystab: move poles with |z| > 1 inside via 1/conj(z)."""
    if len(a) <= 1:
        return a.copy()
    poles = np.roots(a)
    unstable = np.abs(poles) > 1.0
    if not unstable.any():
        return a.copy()
    poles[unstable] = 1.0 / np.conj(poles[unstable])
    a_new = np.real(np.poly(poles))
    return a_new * (a[0] / a_new[0])


def _invfreqz_py(g: np.ndarray, w: np.ndarray,
                 nb: int, na: int,
                 wt: np.ndarray = None,
                 maxiter: int = 0,
                 tol: float = 0.01) -> tuple:
    """Python translation of MATLAB invfreqz.m (equation-error + Gauss-Newton)."""
    K = len(w)
    nk = 0
    T = 1
    nb_ext = nb + nk + 1
    nm = max(na, nb_ext + nk - 1)

    wf = np.ones(K) if wt is None else np.sqrt(np.maximum(wt, 0.0))

    OM = np.exp(-1j * np.outer(np.arange(nm + 1), w * T))

    # Phase 1: weighted equation-error LS
    Dva = OM[1:na + 1, :].T * g[:, np.newaxis]
    Dvb = -OM[nk:nk + nb_ext, :].T
    D = np.hstack([Dva, Dvb]) * wf[:, np.newaxis]
    R = np.real(D.conj().T @ D)
    Vd = np.real(D.conj().T @ (-g * wf))
    try:
        th = np.linalg.solve(R, Vd)
    except np.linalg.LinAlgError:
        th, _, _, _ = np.linalg.lstsq(R, Vd, rcond=None)
    a = np.concatenate([[1.0], th[:na].real])
    b = np.concatenate([np.zeros(nk), th[na:na + nb_ext].real])

    if maxiter <= 0:
        return b, a

    # Phase 2: Gauss-Newton output-error
    a = _polystab(a)
    indb = np.arange(nk, nk + nb_ext)
    indg = np.arange(na + 1)

    GC = (b @ OM[indb, :]) / (a @ OM[indg, :])
    e = (GC - g) * wf
    Vcap = float(np.real(e.conj() @ e))
    t = np.concatenate([a[1:na + 1], b[nk:]])

    gndir = np.ones(len(t)) * (2 * tol + 1)
    l = 0
    st = 0

    while np.linalg.norm(gndir) > tol and l < maxiter and st != 1:
        l += 1
        A_r = a @ OM[indg, :]
        D31 = OM[1:na + 1, :].T * (-GC / A_r)[:, np.newaxis]
        D32 = OM[indb, :].T / A_r[:, np.newaxis]
        D3 = np.hstack([D31, D32]) * wf[:, np.newaxis]
        e = (GC - g) * wf
        R3 = np.real(D3.conj().T @ D3)
        Vd3 = np.real(D3.conj().T @ e)
        try:
            gndir = np.linalg.solve(R3, Vd3)
        except np.linalg.LinAlgError:
            gndir = Vd3 / (np.linalg.norm(R3) + 1e-12) * len(R3)

        ll = 0
        k = 1.0
        V1 = Vcap + 1.0
        an = a.copy()
        bn = b.copy()
        GCn = GC.copy()
        tn = t.copy()
        while V1 > Vcap and ll < 20:
            t1 = (t - k * gndir) if ll < 19 else t.copy()
            ac = _polystab(np.concatenate([[1.0], t1[:na].real]))
            t1[:na] = ac[1:na + 1]
            bc = np.concatenate([np.zeros(nk), t1[na:].real])
            GCc = (bc @ OM[indb, :]) / (ac @ OM[indg, :])
            V1 = float(np.real(((GCc - g) * wf).conj() @ ((GCc - g) * wf)))
            an = ac
            bn = bc
            GCn = GCc
            tn = np.concatenate([ac[1:na + 1], bc[nk:]])
            k /= 2
            ll += 1
            if ll == 20:
                st = 1
            if ll == 10:
                gndir = Vd3 / (np.linalg.norm(R3) + 1e-12) * len(R3)
                k = 1.0

        t = tn
        Vcap = V1
        a = an
        b = bn
        GC = GCn

    return b, a


def _minphase_from_magnitude(mag_full: np.ndarray) -> np.ndarray:
    """Minimum-phase complex response whose magnitude equals mag_full (cepstral)."""
    log_mag = np.log(mag_full + 1e-12)
    cep = np.fft.ifft(log_mag).real
    N = len(cep)
    win = np.zeros(N)
    win[0] = 1.0
    win[1:N // 2] = 2.0
    win[N // 2] = 1.0
    min_log = np.fft.fft(cep * win)
    return np.exp(min_log)


def _refine_iir_biquads(b_init: np.ndarray, a_init: np.ndarray,
                        w: np.ndarray, target_db: np.ndarray,
                        weight: np.ndarray = None) -> tuple:
    """Output-error refinement of an IIR filter as a cascade of stable biquads."""
    try:
        from scipy.optimize import least_squares
    except Exception:
        return b_init, a_init

    sos = tf2sos(b_init, a_init)
    nsec = sos.shape[0]
    if weight is None:
        weight = np.ones(len(w))
    sw = np.sqrt(weight)
    ejw = np.exp(-1j * w)
    ejw2 = ejw ** 2

    def _pack(sos):
        p = []
        for row in sos:
            b0_, b1_, b2_, _, a1_, a2_ = row
            a2c = np.clip(a2_, -0.999, 0.999)
            x2 = np.arctanh(a2c)
            den = 1.0 + a2c
            x1 = np.arctanh(np.clip(a1_ / den if den != 0 else 0.0, -0.999, 0.999))
            b0s = b0_ if abs(b0_) > 1e-12 else 1e-12
            p += [x1, x2, b1_ / b0s, b2_ / b0s]
        g = float(np.prod([row[0] for row in sos]))
        p.append(np.log(abs(g) + 1e-9))
        return np.asarray(p)

    def _unpack(p):
        secs = np.empty((nsec, 6))
        for k in range(nsec):
            x1, x2, b1, b2 = p[4 * k:4 * k + 4]
            a2 = np.tanh(x2)
            a1 = (1.0 + a2) * np.tanh(x1)
            secs[k] = [1.0, b1, b2, 1.0, a1, a2]
        g = np.exp(p[-1])
        return secs, g

    def _resid(p):
        secs, g = _unpack(p)
        H = np.full(len(w), g, dtype=complex)
        for row in secs:
            b0_, b1_, b2_, _, a1_, a2_ = row
            H *= ((b0_ + b1_ * ejw + b2_ * ejw2)
                  / (1.0 + a1_ * ejw + a2_ * ejw2))
        mag = 20.0 * np.log10(np.abs(H) + 1e-12)
        return (mag - target_db) * sw

    p0 = _pack(sos)
    res = least_squares(_resid, p0, method='lm', max_nfev=200 * len(p0))
    secs, g = _unpack(res.x)
    secs[0, :3] *= g
    b, a = sos2tf(secs)

    if not is_stable(a):
        return b_init, a_init
    return b, a


def design_iir(h_fir: np.ndarray, h_mp: np.ndarray, order: int):
    """Fit a stable minimum-phase IIR filter to the FIR prototype's magnitude.

    An invfreqz-port estimate is polished by a scipy trust-region (LM) magnitude
    fit. The reference MATLAB uses its built-in ``invfreqz`` only, but our port
    needs the LM polish to reproduce the real device filter (~0.3 dB RMS vs
    realmeasurementdata/). Order SELECTION uses ``_design_iir_order_probe``
    instead, because the LM polish over-fits low orders and would always pick 6.
    """
    from scipy.signal import group_delay as _gd

    NFFT = 8192
    _, H_fir_full = freqz(h_fir, worN=NFFT, whole=True)
    mag_full = np.abs(H_fir_full)

    D_full = _minphase_from_magnitude(mag_full)
    w_full_8k = 2 * np.pi * np.arange(NFFT) / NFFT

    freq_d = np.logspace(np.log10(FMIN), np.log10(FMAX), 1000)
    w_d = 2 * np.pi * freq_d / FS
    half = NFFT // 2
    D_d = (np.interp(w_d, w_full_8k[:half], D_full[:half].real)
           + 1j * np.interp(w_d, w_full_8k[:half], D_full[:half].imag))

    tgt_db = 20 * np.log10(np.abs(D_d) + 1e-12)
    NFFT_GD = 512
    _, gd_vals = _gd((h_mp, 1), w=NFFT_GD)
    gd_w = (np.abs(gd_vals - gd_vals.min())) ** 2
    if gd_w.max() > 1e-12:
        gd_w = gd_w / gd_w.max()
    w_gd = np.linspace(0, np.pi, NFFT_GD)
    gd_weight = np.interp(w_d, w_gd, gd_w) + 1e-3
    mag_weight = 1.0 + np.abs(tgt_db) / 3.0
    weight = np.sqrt(gd_weight * mag_weight)

    try:
        b, a = _invfreqz_py(D_d, w_d, order, order, wt=weight ** 2, maxiter=200, tol=0.001)
        poles = np.roots(a)
        poles[np.abs(poles) >= 1.0] = 1.0 / np.conj(poles[np.abs(poles) >= 1.0])
        a = np.real(np.poly(poles))
        a = a / a[0]

        b, a = _refine_iir_biquads(b, a, w_d, tgt_db, weight=weight)
        zeros_b = np.roots(b)
        zeros_b[np.abs(zeros_b) >= 1.0] = 1.0 / np.conj(zeros_b[np.abs(zeros_b) >= 1.0])
        b = np.real(np.poly(zeros_b))
        return b, a
    except Exception:
        return None, None


def _design_iir_order_probe(h_mp: np.ndarray, order: int):
    """invfreqz-only IIR (no LM polish), mirroring the reference design_minphase_iir.

    Used purely to reproduce the reference's deviation-vs-order curve for order
    selection, where lower orders must deviate more so the tolerance break lands
    on the same order the device picks.
    """
    from scipy.signal import group_delay as _gd

    nFFT = 512
    _, gd_vals = _gd((h_mp, 1), w=nFFT)
    gd_w = (np.abs(gd_vals - gd_vals.min())) ** 2
    if gd_w.max() > 1e-12:
        gd_w = gd_w / gd_w.max()
    gd_w = np.maximum(gd_w, 1e-3)

    w_full, H = freqz(h_mp, worN=nFFT)
    try:
        b, a = _invfreqz_py(H, w_full, order, order, wt=gd_w, maxiter=10000, tol=0.001)
    except Exception:
        return None, None

    poles = np.roots(a)
    poles[np.abs(poles) >= 1.0] = 1.0 / np.conj(poles[np.abs(poles) >= 1.0])
    a = np.real(np.poly(poles))
    if a[0] == 0:
        return None, None
    a = a / a[0]
    zeros_b = np.roots(b)
    zeros_b[np.abs(zeros_b) >= 1.0] = 1.0 / np.conj(zeros_b[np.abs(zeros_b) >= 1.0])
    b = np.real(np.poly(zeros_b))
    return b, a


def is_stable(a: np.ndarray) -> bool:
    return bool(np.all(np.abs(np.roots(a)) < 1.0))


def is_min_phase(b: np.ndarray) -> bool:
    return bool(np.all(np.abs(np.roots(b)) < 1.0))


def gain_norm_sos(sos: np.ndarray, fnorm: float) -> np.ndarray:
    """Scale first SOS section so IIR magnitude = 0 dB at fnorm."""
    w_n = np.array([2 * np.pi * fnorm / FS])
    _, H = sosfreqz(sos, worN=w_n)
    g = abs(H[0])
    if g > 1e-10:
        sos = sos.copy()
        sos[0, :3] /= g
    return sos


def num2ME(x: float, exp_bits: int = 6, mant_bits: int = 13) -> float:
    """Quantize a scalar to F1 19-bit ME format and return the reconstructed float."""
    if x == 0.0:
        return 0.0
    max_exp = 2 ** (exp_bits - 1) - 1
    min_exp = -2 ** (exp_bits - 1)
    max_mant = 2 ** (mant_bits - 1) - 1

    exp = int(np.clip(int(np.ceil(np.log2(abs(x)))), min_exp, max_exp))
    mant_f = x / (2.0 ** exp)
    mant_i = int(np.clip(round(mant_f * max_mant), -(max_mant + 1), max_mant))
    return (mant_i / max_mant) * (2.0 ** exp)


def quantize_sos_me(sos: np.ndarray) -> np.ndarray:
    """Quantize SOS coefficients to 19-bit ME format (a1, a2 stored negated)."""
    q = np.zeros_like(sos)
    for i, row in enumerate(sos):
        for j, coef in enumerate(row):
            if j in (4, 5):
                q[i, j] = -num2ME(-coef)
            else:
                q[i, j] = num2ME(coef)
    return q


def run_pipeline_core(params: dict) -> dict:
    """Execute the complete F1 IPP IIR filter design pipeline."""
    # Stage 1-2: mic deviation
    if params.get('hxml_freq') is not None:
        freq_raw = params['hxml_freq']
        tf_raw_raw = params['hxml_tf']
        mask = (freq_raw >= FMIN * 0.95) & (freq_raw <= FMAX * 1.05)
        freq_raw = freq_raw[mask]
        tf_raw_raw = tf_raw_raw[mask]
        f_lo = max(FMIN, freq_raw.min())
        f_hi = min(FMAX, freq_raw.max())
        freq = np.logspace(np.log10(f_lo), np.log10(f_hi), 300)
        tf_raw = np.interp(freq, freq_raw, tf_raw_raw)
    else:
        freq = np.logspace(np.log10(FMIN), np.log10(FMAX), 300)
        tf_raw = generate_mic_deviation(params['shape'], freq, params['amp'])
    tf_norm = normalize_at(freq, tf_raw, params['fnorm'])
    tf_inv = invert_db(tf_norm)

    # Stage 3: LF floor
    tf_floor = lf_floor(freq, tf_inv, params['floor_hz'])

    # Stage 4-5: smoothing + FIR prototype.
    if params['smooth_method'] == 2:
        # Faithful reference path: 16-channel band-combine -> fir2 from those points.
        h_lin_target = 10.0 ** (tf_floor / 20.0)
        fout16, out16 = fft_to_16ch_smooth(freq, h_lin_target)
        taps = int(params['fir_taps']) | 1  # fir2 needs odd length (Type-I)
        h_fir = firwin2(taps, fout16 / (FS / 2), out16)
        tf_smooth = np.interp(freq, fout16, 20.0 * np.log10(out16 + 1e-12))
    elif params['smooth_method'] == 1:
        # Faithful 1/x fractional-octave smoothing (SmoothFactor = smooth_n).
        h_lin_target = 10.0 ** (tf_floor / 20.0)
        foct, outoct = fft_to_third_octave_weighted(freq, h_lin_target, max(1, int(params['smooth_n'])))
        taps = int(params['fir_taps']) | 1
        h_fir = firwin2(taps, foct / (FS / 2), outoct)
        tf_smooth = np.interp(freq, foct, 20.0 * np.log10(outoct + 1e-12))
    else:
        tf_smooth = smooth_response(freq, tf_floor, params['smooth_method'], params['smooth_n'])
        h_fir = design_fir(freq, tf_smooth, params['fir_taps'])

    # Stage 6: minimum-phase conversion
    try:
        h_mp = minimum_phase(h_fir, method='homomorphic')
    except Exception:
        h_mp = h_fir.copy()

    # Stage 7-8: IIR order optimization
    fe = np.logspace(np.log10(FMIN), np.log10(FMAX), 1000)
    w_ev = 2 * np.pi * fe / FS

    fe_tol = np.linspace(FMIN, FMAX, 1024)
    w_tol = 2 * np.pi * fe_tol / FS
    idx_fnorm = int(np.argmin(np.abs(fe_tol - params['fnorm'])))

    # Order-selection target = the minimum-phase FIR response, re-zeroed at fnorm
    # (matches the reference: deviation is measured between each IIR and this target).
    _, H_mp_tol = freqz(h_mp, worN=w_tol)
    H_target_db = 20 * np.log10(np.abs(H_mp_tol) + 1e-12)
    H_target_db = H_target_db - H_target_db[idx_fnorm]

    order_data: dict = {}
    ref_max_dev = None
    chosen_b = chosen_a = chosen_ord = None
    selection_done = False

    for ord_ in (12, 10, 8, 6):
        b, a = design_iir(h_fir, h_mp, ord_)
        if b is None:
            order_data[ord_] = {'status': 'failed'}
            if not selection_done and chosen_ord is not None:
                selection_done = True
            continue

        stable = is_stable(a)
        min_ph = is_min_phase(b)
        _, H_ord = freqz(b, a, worN=w_ev)
        H_ord_db = 20 * np.log10(np.abs(H_ord) + 1e-12)
        idx_fnorm_ev = int(np.argmin(np.abs(fe - params['fnorm'])))
        H_ord_db = H_ord_db - H_ord_db[idx_fnorm_ev]

        # Deviation of an invfreqz-only (probe) filter of THIS order from the
        # min-phase target — reproduces the reference's deviation-vs-order curve.
        pb, pa = _design_iir_order_probe(h_mp, ord_)
        if pb is not None:
            _, H_ord_tol = freqz(pb, pa, worN=w_tol)
            H_ord_tol_db = 20 * np.log10(np.abs(H_ord_tol) + 1e-12)
            H_ord_tol_db = H_ord_tol_db - H_ord_tol_db[idx_fnorm]
            max_dev = float(np.max(np.abs(H_ord_tol_db - H_target_db)))
        else:
            max_dev = float('inf')

        if ref_max_dev is None:
            ref_max_dev = max_dev

        within_tol = max_dev <= ref_max_dev + params['tol_db']
        order_data[ord_] = {
            'b': b, 'a': a,
            'stable': stable, 'min_ph': min_ph,
            'max_dev': max_dev, 'within_tol': within_tol,
            'H_db': H_ord_db, 'selected': False,
        }

        forced = params['force_order']
        if forced:
            if ord_ == forced and chosen_ord is None:
                chosen_b, chosen_a, chosen_ord = b, a, ord_
        elif not selection_done:
            if stable and within_tol:
                chosen_b, chosen_a, chosen_ord = b, a, ord_
            else:
                selection_done = True

    if chosen_ord is None:
        for ord_ in (12, 10, 8, 6):
            info = order_data.get(ord_, {})
            if 'b' in info and info.get('stable', False):
                chosen_b, chosen_a, chosen_ord = info['b'], info['a'], ord_
                break

    if chosen_ord is None:
        return {'error': 'IIR design failed for all orders. Try a different mic shape or fewer taps.'}

    order_data[chosen_ord]['selected'] = True

    # Stage 8: SOS factorization
    sos = tf2sos(chosen_b, chosen_a)

    # Stage 10: gain normalization
    sos = gain_norm_sos(sos, params['fnorm'])

    # Stage 11: ME quantization
    sos_q = quantize_sos_me(sos) if params['quantize'] else sos.copy()

    # Frequency responses for all plots
    _, H_fir = freqz(h_fir, worN=w_ev)
    _, H_mp = freqz(h_mp, worN=w_ev)
    _, H_iir = sosfreqz(sos, worN=w_ev)
    _, H_q = sosfreqz(sos_q, worN=w_ev)

    H_fir_db = 20 * np.log10(np.abs(H_fir) + 1e-12)
    H_mp_db = 20 * np.log10(np.abs(H_mp) + 1e-12)
    H_iir_db = 20 * np.log10(np.abs(H_iir) + 1e-12)
    H_q_db = 20 * np.log10(np.abs(H_q) + 1e-12)

    NFFT_cep = 4096
    _, H_fir_full_cep = freqz(h_fir, worN=NFFT_cep, whole=True)
    D_cep = _minphase_from_magnitude(np.abs(H_fir_full_cep))
    w_cep = 2 * np.pi * np.arange(NFFT_cep) / NFFT_cep
    hc = NFFT_cep // 2
    D_ev = (np.interp(w_ev, w_cep[:hc], D_cep[:hc].real)
            + 1j * np.interp(w_ev, w_cep[:hc], D_cep[:hc].imag))
    H_mp_correct_db = 20 * np.log10(np.abs(D_ev) + 1e-12)

    tf_norm_ev = np.interp(fe, freq, tf_norm)
    residual = tf_norm_ev + H_q_db
    residual_float = tf_norm_ev + H_iir_db

    level_raw_db = 70.0 + tf_norm_ev
    level_corrected_db = 70.0 + residual
    level_float_db = 70.0 + residual_float

    is_real_hxml = params.get('hxml_freq') is not None
    tf_raw_ev_abs = (np.interp(fe, freq, tf_raw) if is_real_hxml else tf_norm_ev)

    return {
        'freq': freq,
        'freq_eval': fe,
        'tf_norm': tf_norm,
        'tf_inv': tf_inv,
        'tf_floor': tf_floor,
        'tf_smooth': tf_smooth,
        'H_fir_db': H_fir_db,
        'H_mp_db': H_mp_db,
        'H_mp_correct_db': H_mp_correct_db,
        'H_iir_db': H_iir_db,
        'H_q_db': H_q_db,
        'quantize_on': params['quantize'],
        'residual': residual,
        'tf_norm_ev': tf_norm_ev,
        'tf_raw_ev_abs': tf_raw_ev_abs,
        'is_real_hxml': is_real_hxml,
        'level_raw_db': level_raw_db,
        'level_corrected_db': level_corrected_db,
        'level_float_db': level_float_db,
        'chosen_ord': chosen_ord,
        'order_data': order_data,
        'sos': sos,
        'sos_q': sos_q,
        'chosen_b': chosen_b,
        'chosen_a': chosen_a,
        'stable': is_stable(chosen_a),
        'min_ph': is_min_phase(chosen_b),
    }
