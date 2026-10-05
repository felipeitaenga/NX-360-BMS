"""Gera ícones PWA do NX-360 BMS a partir do ícone 'Wind' do lucide-react.
Cor do stroke: #38bdf8 (sky-400 — mesma do logo da tela de Login)
Fundo: #0b0f19 (slate-950)
"""
import cairosvg
from pathlib import Path

OUT = Path("/app/frontend/public/icons")
OUT.mkdir(parents=True, exist_ok=True)

# Paths exatos do Wind icon (lucide-react 0.544)
WIND_PATHS = [
    "M12.8 19.6A2 2 0 1 0 14 16H2",
    "M17.5 8a2.5 2.5 0 1 1 2 4H2",
    "M9.8 4.4A2 2 0 1 1 11 8H2",
]

BG = "#0b0f19"
FG = "#38bdf8"  # sky-400


def svg_for(size: int, maskable: bool = False) -> str:
    """Gera o SVG completo. Em maskable usamos um safe-zone de ~20% nas bordas."""
    # Fator de margem: maskable precisa de safe-zone (ícone menor dentro da área total)
    pad_pct = 0.22 if maskable else 0.14
    # viewbox do lucide é 24x24; vamos escalar
    vb = 24
    outer_corner = 0 if maskable else int(size * 0.22)  # cantos arredondados só p/ regular (OS vai mascarar)
    inner_box = size * (1 - 2 * pad_pct)
    offset = (size - inner_box) / 2
    scale = inner_box / vb
    stroke_w = max(2.5 * scale, 2.5)  # Wind usa stroke-width 2 no viewbox
    paths = "\n    ".join(f'<path d="{p}"/>' for p in WIND_PATHS)
    bg_shape = (
        f'<rect width="{size}" height="{size}" fill="{BG}"/>'  # maskable: fundo cheio
        if maskable
        else f'<rect width="{size}" height="{size}" rx="{outer_corner}" ry="{outer_corner}" fill="{BG}"/>'
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  {bg_shape}
  <g transform="translate({offset},{offset}) scale({scale})"
     fill="none" stroke="{FG}" stroke-width="{stroke_w / scale}" stroke-linecap="round" stroke-linejoin="round">
    {paths}
  </g>
</svg>"""


def render(size: int, out_name: str, maskable: bool = False):
    svg = svg_for(size, maskable=maskable)
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    (OUT / out_name).write_bytes(png)
    print(f"  {out_name:35s} {size}x{size}  {'maskable' if maskable else 'regular'}")


print("Gerando ícones PWA em", OUT)
render(192, "icon-192.png")
render(512, "icon-512.png")
render(512, "icon-512-maskable.png", maskable=True)
render(180, "apple-touch-icon.png")
render(32, "favicon-32.png")
# Favicon.ico (16+32)
cairosvg.svg2png(bytestring=svg_for(32).encode(),
                 output_width=32, output_height=32,
                 write_to=str(OUT / "favicon.png"))
# Copy a 32px PNG to /app/frontend/public/favicon.ico (browsers accept PNG inside .ico)
(Path("/app/frontend/public/favicon.ico")).write_bytes(
    cairosvg.svg2png(bytestring=svg_for(32).encode(), output_width=32, output_height=32)
)
print("OK — ícones gerados.")
