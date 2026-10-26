# Generates docs/assets/terminal.gif — an animated terminal demo for the README.
#
# The transcript below is real mocktape output (captured from the actual CLI),
# rendered frame-by-frame with Pillow: typewriter commands, scrolling buffer,
# blinking cursor. Same approach as charmbracelet/vhs, minus the dependencies.
#
# Usage: python scripts/generate-terminal-gif.py   (writes docs/assets/terminal.gif)
from PIL import Image, ImageDraw, ImageFont
import os

# ---------------------------------------------------------------- palette
BG = (13, 17, 23)
CHROME = (22, 27, 34)
CHROME_LINE = (45, 51, 59)
TEXT = (230, 237, 243)
DIM = (139, 148, 158)
GREEN = (63, 185, 80)
CYAN = (57, 197, 207)
BLUE = (121, 192, 255)
STRLIT = (165, 214, 255)
PURPLE = (210, 168, 255)
MAGENTA = (188, 140, 255)
RED = (248, 81, 73)
YELLOW = (210, 153, 34)

COLORS = [BG, CHROME, CHROME_LINE, TEXT, DIM, GREEN, CYAN, BLUE, STRLIT, PURPLE, MAGENTA, RED, YELLOW]


def build_palette_image():
    """Fixed palette: exact colors plus bg->color ramps for anti-aliased text."""
    entries = [(0, 0, 0)]  # index 0 reserved (transparent in palette image)
    for color in COLORS:
        entries.append(color)
        for i in range(1, 12):
            t = i / 11
            entries.append(tuple(round(BG[k] + (color[k] - BG[k]) * t) for k in range(3)))
    entries += [(0, 0, 0)] * (256 - len(entries))
    img = Image.new("P", (16, 16))
    img.putpalette([v for rgb in entries[:256] for v in rgb])
    return img


PALETTE = build_palette_image()

# ---------------------------------------------------------------- fonts
FONT_SIZE = 15
LINE_H = 22
PAD = 26
COLS = 92
ROWS = 20
WIDTH = PAD * 2 + COLS * 9
HEIGHT = 46 + ROWS * LINE_H + 18

font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", FONT_SIZE)
font_bold = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", FONT_SIZE)


def glyph_ok(ch):
    """True if the font has a real glyph — tofu boxes have a bbox too, so
    compare against a known-missing private-use character's mask."""
    tofu = font.getmask("\ue000")
    mask = font.getmask(ch)
    if mask.size == (0, 0):
        return False
    if mask.size == tofu.size and bytes(mask) == bytes(tofu):
        return False
    return True


GLYPH_CHECK = {c: glyph_ok(c) for c in ["✓", "→", "…", "ℹ", "▶", "●", "—"]}
FALLBACK = {"✓": "+", "→": "->", "…": "...", "ℹ": "*", "▶": ">", "●": "*", "—": "-"}


def sym(ch):
    """Use the pretty glyph when the font has it, ASCII otherwise."""
    return ch if GLYPH_CHECK.get(ch, False) else FALLBACK.get(ch, ch)

# ---------------------------------------------------------------- transcript
# Segments: (text, color, bold). JSON lines are tokenized automatically.


def p(text):  # plain
    return (text, TEXT, False)


def dim(text):
    return (text, DIM, False)


def tokenize_json(line):
    segs, i, n = [], 0, len(line)
    while i < n:
        ch = line[i]
        if ch == '"':
            end = i + 1
            while end < n and line[end] != '"':
                end += 2 if line[end] == "\\" else 1
            raw = line[i : end + 1]
            j = end + 1
            while j < n and line[j] == " ":
                j += 1
            is_key = j < n and line[j] == ":"
            segs.append((raw, BLUE if is_key else STRLIT, False))
            i = end + 1
        elif ch.isdigit():
            j = i
            while j < n and (line[j].isdigit() or line[j] == "."):
                j += 1
            segs.append((line[i:j], PURPLE, False))
            i = j
        elif ch in "{}[]<>":
            segs.append((ch, DIM, False))
            i += 1
        else:
            segs.append((ch, TEXT, False))
            i += 1
    return segs


def request_line(ts, method, path, status, dur, badge, badge_color):
    method_color = {"GET": GREEN, "POST": CYAN, "DELETE": RED, "PATCH": YELLOW}.get(method, TEXT)
    return [
        (ts + " ", DIM, False),
        (method + " ", method_color, True),
        (path + " ", TEXT, True),
        (sym("→") + " ", DIM, False),
        (status + " ", GREEN, True),
        (f"({dur}) ", DIM, False),
        (badge, badge_color, True),
    ]


SCENES = [
    {
        "cmd": 'mocktape init',
        "out": [
            [(sym("✓") + " ", GREEN, True), p("created "), ("mocktape.json", TEXT, True)],
            [dim("Next steps: try "), ("mocktape dev", CYAN, False), dim("  # serve on http://localhost:3000")],
        ],
    },
    {
        "cmd": "mocktape dev",
        "out": [
            [(sym("ℹ") + " ", CYAN, False), dim("config: mocktape.json")],
            [(sym("ℹ") + " ", CYAN, False), dim("mocktape dev server listening on "), ("http://localhost:3000", TEXT, False)],
            [(sym("ℹ") + " ", CYAN, False), dim("dashboard: "), ("http://localhost:3001", TEXT, False)],
        ],
    },
    {
        "cmd": 'curl "localhost:3000/users?role=admin"',
        "out": [tokenize_json(line) for line in [
            "[",
            '  { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com",',
            '    "role": "admin" }',
            "]",
        ]],
    },
    {
        "cmd": "curl -X POST localhost:3000/users \\",
        "cmd2": '    -d \'{"name": "Grace Hopper", "role": "engineer"}\'',
        "out": [tokenize_json(line) for line in [
            "{",
            '  "name": "Grace Hopper",',
            '  "role": "engineer",',
            '  "id": 5',
            "}",
        ]],
    },
    {
        "cmd": "curl -X DELETE localhost:3000/users/5",
        "out": [[("204", GREEN, True), dim(" No Content")]],
    },
    {
        "cmd": "mocktape record --upstream https://api.example.com",
        "out": [
            [dim("  Recording from "), ("https://api.example.com", TEXT, True)],
            [dim("  Cassette  "), ("cassettes/cassette-2026-10-25.yaml", TEXT, False)],
            request_line("20:51:03", "GET", "/repos/acme/widget", "200", "86ms", "proxy", MAGENTA),
        ],
    },
    {
        "cmd": "mocktape replay cassettes" + ("   # offline, zero network" if True else ""),
        "out": [
            [dim("  Replaying "), ("cassettes", TEXT, True), dim(" " + sym("—") + " "), dim("128 interactions")],
            request_line("20:51:37", "GET", "/repos/acme/widget", "200", "0ms", "replay", CYAN),
        ],
    },
]

# ---------------------------------------------------------------- renderer


def render_frame(rows, cursor_line_idx=None, cursor_col=None, show_cursor=True):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)

    # window chrome
    d.rectangle([0, 0, WIDTH, 34], fill=CHROME)
    d.line([0, 34, WIDTH, 34], fill=CHROME_LINE, width=1)
    for i, c in enumerate([(248, 81, 73), (210, 153, 34), (63, 185, 80)]):
        d.ellipse([18 + i * 22, 12, 30 + i * 22, 24], fill=c)
    d.text((WIDTH // 2, 17), "mocktape — zsh", font=font, fill=DIM, anchor="mm")

    y = 46
    visible = rows[-ROWS:]
    first_idx = len(rows) - len(visible)
    for idx, segs in enumerate(visible):
        x = PAD
        for text, color, bold in segs:
            f = font_bold if bold else font
            d.text((x, y), text, font=f, fill=color)
            x += d.textlength(text, font=f)
        if show_cursor and cursor_line_idx is not None and idx + first_idx == cursor_line_idx:
            cx = PAD + (cursor_col or 0)
            d.rectangle([cx, y + 1, cx + 8, y + LINE_H - 4], fill=TEXT)
        y += LINE_H
    return img.convert("RGB").quantize(palette=PALETTE, dither=Image.Dither.NONE)


def scene_frames():
    rows = []
    for scene in SCENES:
        # typing the command
        full = scene["cmd"]
        for n in range(2, len(full) + 1, 2):
            rows = rows + []  # buffer unchanged
            typing_rows = rows + [[("$ ", GREEN, True), (full[:n], TEXT, True)]]
            yield render_frame(typing_rows, cursor_line_idx=len(typing_rows) - 1, cursor_col=None if n >= len(full) else None, show_cursor=True), 45
        rows.append([("$ ", GREEN, True), (full, TEXT, True)])
        if scene.get("cmd2"):
            rows.append([(scene["cmd2"], TEXT, False)])
        yield render_frame(rows, show_cursor=False), 140

        # output lines, two at a time
        out = scene["out"]
        for i in range(0, len(out), 2):
            rows = rows + out[i : i + 2]
            yield render_frame(rows, show_cursor=False), 150
        yield render_frame(rows, show_cursor=True), 850
        yield render_frame(rows, show_cursor=False), 260
    # final idle blink
    yield render_frame(rows, show_cursor=True), 800
    yield render_frame(rows, show_cursor=False), 500


def main():
    frames, durations = [], []
    for frame, dur in scene_frames():
        frames.append(frame)
        durations.append(dur)
    out_path = os.path.join(os.path.dirname(__file__), "..", "docs", "assets", "terminal.gif")
    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    # preview frames for inspection
    for idx in [0, len(frames) // 3, 2 * len(frames) // 3, len(frames) - 2]:
        frames[idx].convert("RGB").save(os.path.join(os.environ["TEMP"], f"gif-preview-{idx}.png"))
    print(f"frames: {len(frames)}, duration: {sum(durations) / 1000:.1f}s, size: {os.path.getsize(out_path) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
