"""Container-only compiler. No host mounts, shell commands or network access."""
import base64
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

SOURCE_LIMIT = 1_200_000
LOG_LIMIT = 16_000
LUA_PACKAGES = {"luacode", "luatexbase", "luatexja", "luatexja-fontspec", "luabidi", "luaotfload"}
FONT_CACHE_SEED = Path("/opt/latex-font-cache")
UNICODE_PACKAGES = {"fontspec", "unicode-math", "polyglossia", "xltxtra", "xunicode"}


def select_engine(source):
    # Consume escaped characters first so \% survives, while comments after \\ are removed.
    active = re.sub(r"\\[^\n]|%[^\n]*", lambda match: "" if match[0].startswith("%") else match[0], source)
    active = re.sub(r"\\begin\{(verbatim\*?|lstlisting)\}.*?\\end\{\1\}", "", active, flags=re.S)
    loads = re.findall(r"\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\]\s*)?\{([^}]+)\}", active)
    packages = {name.strip() for _, names in loads for name in names.split(",")}
    babel_options = [options for options, names in loads if "babel" in {name.strip() for name in names.split(",")}]
    babel_options += re.findall(r"\\PassOptionsToPackage\s*\{([^}]+)\}\s*\{\s*babel\s*\}", active)
    babel_options += re.findall(r"\\documentclass\s*\[([^\]]*)\]", active)
    if (LUA_PACKAGES.intersection(packages)
            or re.search(r"\\(?:directlua|latelua|luaexec)\b", active)
            or any(re.search(r"(?:^|,)\s*bidi\s*=\s*\{?\s*basic(?:-r)?\s*\}?\s*(?:,|$)", options) for options in babel_options)):
        return "lualatex"
    if UNICODE_PACKAGES.intersection(packages):
        return "xelatex"
    if re.search(r"\\(?:setmainfont|setsansfont|setmonofont|newfontfamily|newfontface|fontspec|defaultfontfeatures)\b", active):
        return "xelatex"
    return "pdflatex"


def needs_unicode_engine(log):
    # Some classes load fontspec indirectly, so inspecting the source alone is insufficient.
    message = " ".join(log.lower().split())
    return ("fontspec" in message and "requires either xetex or" in message) or (
        "unicode-math" in message and "cannot be run with pdflatex" in message
    )


def needs_lua_engine(log):
    message = " ".join(log.lower().replace("(babel)", "").split())
    return ("babel" in message and "bidi method" in message and "available only in luatex" in message)



def compilation_hint(log):
    message = " ".join(log.split())
    if re.search(r"Command\s+\\spanishdate\s+already defined", message):
        return ("[Weave] Babel está redefiniendo español. Revisa si el idioma ya se importó "
                "con provide=* o con otra llamada a \\babelprovide[import]{spanish}. "
                "Importa español una sola vez; si solo cambias onchar en un idioma ya "
                "importado, usa \\babelprovide[onchar=ids fonts]{spanish} sin import. "
                "El compilador no modificó tu documento.\n")
    if re.search(r"File `(?:siunitx|circuitikz|pgfplots|steinmetz|physics)\.sty' not found", message):
        return ("[Weave] La imagen local del compilador LaTeX está desactualizada y no incluye "
                "los paquetes científicos/de circuitos recientes. Reconstruye la imagen desde "
                "backend/ con: docker build -t weave-latex:1 ./latex-compiler\n")
    return ""

def prepare_lua_cache():
    # Copy a trusted seed into this disposable container's writable /work tmpfs.
    # Each request has its own cache; the image remains read-only.
    target = Path(".tex-cache")
    if not target.exists():
        if FONT_CACHE_SEED.is_dir():
            shutil.copytree(FONT_CACHE_SEED, target)
        else:
            target.mkdir(mode=0o700)



def engine_arguments(engine):
    # LuaHBTeX does not support the Web2C first-line switch used by pdfTeX/XeTeX.
    args = [engine, "-no-shell-escape"]
    if engine == "lualatex":
        args.append("-fmt=lualatex")
    else:
        args.append("-no-parse-first-line")
    return args + ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "main.tex"]

def run_pass(engine, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(engine, 20)
    with Path("console.log").open("wb") as output:
        result = subprocess.run(
            engine_arguments(engine),
            stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
            timeout=min(10, remaining), check=False,
        )
    with Path("console.log").open("rb") as output:
        output.seek(max(0, Path("console.log").stat().st_size - LOG_LIMIT))
        log = output.read().decode("utf-8", errors="replace")
    return result.returncode, log


def compile_source(source):
    if len(source) > SOURCE_LIMIT:
        return {"success": False, "log": "Fuente demasiado grande."}
    Path("main.tex").write_bytes(source)
    engine = select_engine(source.decode("utf-8", errors="replace"))
    deadline = time.monotonic() + 20  # Includes a possible engine fallback; Docker allows 25s.
    log = ""
    transitions = []
    lua_cache_ready = False

    def report(message):
        transition = f" (seleccionado tras detectar {'; '.join(transitions)})" if transitions else ""
        header = f"[Weave] Motor: {engine}{transition}.\n" + compilation_hint(message)
        return header + message.encode("utf-8")[-(LOG_LIMIT - len(header.encode('utf-8'))):].decode("utf-8", errors="ignore")

    try:
        passes = 0
        while passes < 2:  # Resolve labels, references and table of contents.
            if engine == "lualatex" and not lua_cache_ready:
                prepare_lua_cache()
                lua_cache_ready = True
            code, log = run_pass(engine, deadline)
            if code:
                next_engine = None
                if engine != "lualatex" and needs_lua_engine(log):
                    next_engine = "lualatex"
                    transitions.append("Babel que requiere LuaTeX")
                elif engine == "pdflatex" and needs_unicode_engine(log):
                    next_engine = "xelatex"
                    transitions.append("fontspec/unicode-math")
                if next_engine:
                    engine = next_engine
                    passes = 0
                    for name in ("main.aux", "main.toc", "main.out", "main.lof", "main.lot", "main.pdf"):
                        Path(name).unlink(missing_ok=True)
                    continue
                return {"success": False, "log": report(log)}
            passes += 1
    except subprocess.TimeoutExpired:
        return {"success": False, "log": report("La compilación superó el tiempo permitido.\n" + log)}
    except FileNotFoundError:
        return {"success": False, "log": report(f"El motor {engine} no está instalado. Reconstruye la imagen weave-latex:1 con el Dockerfile actualizado.")}

    pdf = Path("main.pdf")
    if not pdf.exists() or pdf.stat().st_size > 16 * 1024 * 1024:
        return {"success": False, "log": report("No se generó un PDF o supera 16 MiB.\n" + log)}
    return {"success": True, "pdf": base64.b64encode(pdf.read_bytes()).decode("ascii"), "log": report(log)}


def compile_document():
    return compile_source(sys.stdin.buffer.read(SOURCE_LIMIT + 1))


def main():
    try:
        result = compile_document()
    except Exception:
        result = {"success": False, "log": "No se pudo compilar el documento."}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
