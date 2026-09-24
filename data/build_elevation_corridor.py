"""
FloodRoute data prep: build data/processed/elevation_corridor.tif
Source: AWS Terrain Tiles (Mapzen/Nextzen terrarium, SRTM-based), z13, 25 tiles.
Pure Python: PNG decode (zlib + filters) + Web Mercator -> EPSG:4326 resample
+ minimal uncompressed int16 GeoTIFF writer. Run once; output is the processed raster.
"""
import struct, zlib, math, os

RAW = 'data/raw/elevation/terrain_tiles_z13'
OUT = 'data/processed/elevation_corridor.tif'

# ---- output grid (EPSG:4326) -------------------------------------------------
LON0, LON1 = 80.10, 80.31
LAT1, LAT0 = 13.14, 12.91          # north, south
ARC = 7200                          # pixels per degree (0.5 arcsec ~15.5 m)
W = int(round((LON1 - LON0) * ARC)) # 1512
H = int(round((LAT1 - LAT0) * ARC)) # 1656

# ---- tile range covered ------------------------------------------------------
Z = 13
N = 1 << Z

def lonlat_to_global_px(lon, lat, z):
    n = 1 << z
    x = (lon + 180.0) / 360.0 * n * 256
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n * 256
    return x, y

gx0, gy0 = lonlat_to_global_px(LON0, LAT1, Z)
gx1, gy1 = lonlat_to_global_px(LON1, LAT0, Z)
TX0, TY0 = int(gx0 // 256), int(gy0 // 256)
TX1, TY1 = int(gx1 // 256), int(gy1 // 256)
print(f'global px range x {gx0:.1f}..{gx1:.1f} y {gy0:.1f}..{gy1:.1f}')
print(f'tiles x {TX0}..{TX1} y {TY0}..{TY1}')

def png_decode(data):
    """Minimal PNG decoder -> (w, h, rows) where rows is list of bytearray RGB."""
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos = 8
    w = h = bd = ct = None
    idat = bytearray()
    plte = None
    trns = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w, h, bd, ct, comp, filt, inter = struct.unpack('>IIBBBBB', chunk)
            assert bd == 8 and ct in (2, 6) and inter == 0, f'unsupported png: bd={bd} ct={ct} inter={inter}'
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'PLTE':
            plte = chunk
        elif typ == b'tRNS':
            trns = chunk
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(bytes(idat))
    ch = 3 if ct == 2 else 4
    stride = w * ch
    rows = [bytearray(w * ch) for _ in range(h)]
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 0:
            pass
        elif f == 1:  # Sub
            for i in range(ch, stride):
                line[i] = (line[i] + line[i-ch]) & 0xFF
        elif f == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:  # Average
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:  # Paeth
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                b = prev[i]
                c = prev[i-ch] if i >= ch else 0
                pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        else:
            raise ValueError(f'filter {f}')
        rows[y] = line
        prev = line
    return w, h, rows, ch

# ---- load tiles ---------------------------------------------------------------
tiles = {}
for tx in range(TX0, TX1 + 1):
    for ty in range(TY0, TY1 + 1):
        p = f'{RAW}/t_{tx}_{ty}.png'
        if not os.path.exists(p):
            raise SystemExit(f'missing tile {p} - rerun download')
        w, h, rows, ch = png_decode(open(p, 'rb').read())
        assert w == 256 and h == 256
        tiles[(tx, ty)] = rows
print(f'loaded {len(tiles)} tiles')

def elev_at_global(gpx, gpy):
    tx, ty = int(gpx // 256), int(gpy // 256)
    rows = tiles.get((tx, ty))
    if rows is None:
        return None
    ix = int(gpx) - tx * 256
    iy = int(gpy) - ty * 256
    ix = min(255, max(0, ix)); iy = min(255, max(0, iy))
    o = ix * 3
    r = rows[iy][o]; g = rows[iy][o+1]; b = rows[iy][o+2]
    return (r * 256 + g + b / 256.0) - 32768.0

# ---- resample to EPSG:4326 grid ------------------------------------------------
img = bytearray(W * H * 2)
nodata = 0
vmin, vmax = 1e9, -1e9
vsum = 0.0; nvalid = 0
for j in range(H):
    lat = LAT1 - (j + 0.5) / ARC
    lat_r = math.radians(lat)
    gy = (1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * N * 256
    for i in range(W):
        lon = LON0 + (i + 0.5) / ARC
        gx = (lon + 180.0) / 360.0 * N * 256
        e = elev_at_global(gx, gy)
        if e is None or e < -100 or e > 9000:
            v = -32768
            nodata += 1
        else:
            v = int(round(e))
            if v < vmin: vmin = v
            if v > vmax: vmax = v
            vsum += v; nvalid += 1
        o = (j * W + i) * 2
        img[o] = v & 0xFF
        img[o+1] = (v >> 8) & 0xFF
print(f'grid {W}x{H} | nodata {nodata} | valid {nvalid} | min {vmin} max {vmax} mean {vsum/max(1,nvalid):.2f}')

# ---- GeoTIFF writer (uncompressed, single strip, EPSG:4326) --------------------
def make_tiff(w, h, pix, sx, sy, lon0, lat0):
    entries = []  # (tag, type, count, value_bytes_or_None, inline_value)
    def e(tag, typ, count, val):
        entries.append((tag, typ, count, val))
    e(256, 3, 1, w)      # ImageWidth
    e(257, 3, 1, h)      # ImageLength
    e(258, 3, 1, 16)     # BitsPerSample
    e(259, 3, 1, 1)      # Compression = none
    e(262, 3, 1, 1)      # Photometric = BlackIsZero
    e(273, 4, 1, 'STRIP_OFF')
    e(277, 3, 1, 1)      # SamplesPerPixel
    e(278, 3, 1, h)      # RowsPerStrip
    e(279, 4, 1, len(pix))  # StripByteCounts
    e(284, 3, 1, 1)      # PlanarConfig
    e(296, 3, 1, 1)      # ResolutionUnit = none-ish (1)
    e(33550, 12, 3, (sx, sy, 0.0))          # ModelPixelScale
    e(33922, 12, 6, (0.0, 0.0, 0.0, lon0, lat0, 0.0))  # ModelTiepoint
    e(34735, 3, 16, (1,1,0,2, 1024,0,1,2, 1025,0,1,1, 2054,0,1,9102))  # GeoKeys: geographic, WGS84, degrees
    e(42113, 2, 6, '-32768')                # GDAL_NODATA
    entries.sort(key=lambda x: x[0])
    ifd_size = 2 + 12 * len(entries) + 4
    ext = b''
    ext_base = 8 + ifd_size
    ifd = struct.pack('<H', len(entries))
    for tag, typ, count, val in entries:
        if tag == 273:  # StripOffsets patched after ext section size is known
            ifd += struct.pack('<HHI', tag, typ, count) + b'\x00\x00\x00\x00'
            continue
        if typ == 3:
            payload = struct.pack('<H', val & 0xFFFF) if count == 1 else struct.pack(f'<{count}H', *val)
        elif typ == 4:
            payload = struct.pack('<I', val) if count == 1 else struct.pack(f'<{count}I', *val)
        elif typ == 12:
            payload = struct.pack(f'<{count}d', *val)
        elif typ == 2:
            payload = val.encode('ascii')
        else:
            raise ValueError(typ)
        if len(payload) <= 4:
            ifd += struct.pack('<HHI', tag, typ, count) + payload.ljust(4, b'\x00')
        else:
            ifd += struct.pack('<HHI', tag, typ, count) + struct.pack('<I', ext_base + len(ext))
            ext += payload
    strip_off = ext_base + len(ext)
    ifd = ifd.replace(struct.pack('<HHI', 273, 4, 1) + b'\x00\x00\x00\x00',
                      struct.pack('<HHI', 273, 4, 1) + struct.pack('<I', strip_off), 1)
    ifd += struct.pack('<I', 0)  # next IFD
    return b'II\x2a\x00' + struct.pack('<I', 8) + ifd + ext + pix

sx = 1.0 / ARC
tiff = make_tiff(W, H, bytes(img), sx, -sx, LON0, LAT1)
open(OUT, 'wb').write(tiff)
print(f'wrote {OUT} ({len(tiff)} bytes)')

# ---- self-check: reparse the tiff we just wrote + spot elevations --------------
d = tiff
off = struct.unpack('<I', d[4:8])[0]
n = struct.unpack('<H', d[off:off+2])[0]
tags = {}
for i in range(n):
    en = d[off+2+12*i: off+2+12*(i+1)]
    tag, typ, cnt = struct.unpack('<HHI', en[:8])
    if typ == 3 and cnt == 1:
        tags[tag] = struct.unpack('<H', en[8:10])[0]
    elif typ == 4 and cnt == 1:
        tags[tag] = struct.unpack('<I', en[8:12])[0]  # inline: value IS the 4 bytes
    elif typ == 12:
        o = struct.unpack('<I', en[8:12])[0]
        tags[tag] = struct.unpack(f'<{cnt}d', d[o:o+8*cnt])
    elif typ == 2:
        o = struct.unpack('<I', en[8:12])[0]
        tags[tag] = d[o:o+cnt].rstrip(b'\x00').decode()
vals = struct.unpack(f'<{W*H}h', d[tags[273]:tags[273]+W*H*2])
valid = [v for v in vals if v != -32768]
print(f'self-check: {W}x{H} nodata={len(vals)-len(valid)} min={min(valid)} max={max(valid)} mean={sum(valid)/len(valid):.2f}')
sc, tie = tags[33550], tags[33922]
print(f'self-check: pixel scale {sc[0]:.6f} deg | top-left center {tie[3]:.4f}, {tie[4]:.4f} | nodata {tags.get(42113)}')

def spot(lon, lat):
    ix = int((lon - LON0) / sx); iy = int((LAT1 - lat) / sx)
    if 0 <= ix < W and 0 <= iy < H:
        return vals[iy * W + ix]
    return None
for name, lon, lat in [('SRM Ramapuram', 80.2105, 13.0539),
                       ('Porur Jn', 80.2015, 13.0370),
                       ('Guindy (Kathipara)', 80.2010, 12.9940),
                       ('Saidapet', 80.2215, 13.0215),
                       ('Koyambedu', 80.2080, 13.0730)]:
    print(f'  {name}: {spot(lon, lat)} m')
