# 09 — Documentos LaTeX y compilación aislada

[Volver al índice](README.md)

## Preparación

Desde `backend/`, construir la imagen local (repetir después de actualizar el Dockerfile o compile.py):

```sh
docker build -t weave-latex:1 ./latex-compiler
npm run start:dev
```

El usuario del proceso Nest necesita acceso al daemon Docker. No exponer el socket a los
clientes ni montarlo dentro del contenedor compilador. Se puede usar un daemon rootless
configurado para ese usuario. `LATEX_DOCKER_IMAGE` cambia la imagen (por defecto `weave-latex:1`).
La ejecución usa `--pull=never`: no descarga imágenes ni instala paquetes al compilar.

El [Dockerfile](../latex-compiler/Dockerfile) instala pdfLaTeX, XeLaTeX, LuaLaTeX y paquetes TeX Live desde Debian:
latex-base, latex-recommended, latex-extra, pictures, science, xetex, luatex, lang-spanish y fonts-recommended. Incluye los
paquetes del formulario de Física II y circuitos eléctricos: inputenc, babel español, amsmath, amssymb, geometry,
multicol, booktabs, array, circuitikz, tikz, pgfplots y siunitx (`\usepackage[siunitx]{circuitikz}`). Para actualizar paquetes, reconstruir y verificar la imagen.

## Selección automática del motor y fontspec

`compile.py` da prioridad a **LuaLaTeX** cuando Babel usa `bidi=basic` o `bidi=basic-r`
(incluidas opciones globales y `\PassOptionsToPackage`), o el documento usa paquetes/comandos
propios de LuaTeX. En ausencia de estos requisitos, selecciona **XeLaTeX** si encuentra `fontspec`, `unicode-math`, `polyglossia`,
`xltxtra`, `xunicode` o comandos como `\setmainfont`, `\setsansfont` y `\newfontfamily`.
Los documentos tradicionales siguen utilizando **pdfLaTeX**. Los comentarios y ejemplos
verbatim no determinan el motor. Si una clase carga fontspec indirectamente y pdfLaTeX
informa que requiere XeTeX/LuaTeX, se eliminan sus auxiliares y se vuelve a compilar con
XeLaTeX. Si Babel informa que su método bidi solo está disponible en LuaTeX, se reintenta
con LuaLaTeX. Las transiciones son únicamente pdfLaTeX → XeLaTeX → LuaLaTeX (o directamente
a LuaLaTeX), dentro del mismo presupuesto de tiempo. No se reintentan errores de sintaxis
ordinarios ni se permite alternar motores indefinidamente.

El registro empieza con `[Weave] Motor: lualatex.`, `xelatex` o `pdflatex`. No hace falta cambiar el
contrato HTTP ni modificar o guardar nuevamente el documento para seleccionar el motor.
Las imágenes anteriores pueden carecer de LuaLaTeX: reiniciar Nest no instala motores; hay que reconstruir
`weave-latex:1` con el comando anterior (o la etiqueta configurada en `LATEX_DOCKER_IMAGE`).
Las solicitudes siguientes usan la imagen reconstruida porque cada compilación crea un contenedor.

La imagen incluye Latin Modern, TeX Gyre, Liberation y DejaVu, y prepara la caché de fontconfig
durante el build. Ejemplo compatible:

```tex
\documentclass{article}
\usepackage{fontspec}
\setmainfont{TeX Gyre Termes}
\begin{document}
Corriente eléctrica: á, é, í, ó, ú, ñ.
\end{document}
```

Las fuentes deben existir **dentro del contenedor**, aunque estén instaladas en el equipo
del usuario. Para añadir otras, extender la imagen y reconstruirla; no se instalan fuentes
ni paquetes desde el documento. Cambiar de motor no sustituye automáticamente fuentes ausentes.
LuaLaTeX soporta también fontspec, pero se selecciona con prioridad cuando el documento lo
requiere, por ejemplo:

```tex
\usepackage{fontspec}
\usepackage[spanish,bidi=basic]{babel}
```

El build ejecuta `luaotfload-tool --update` y compila [lua-warmup.tex](../latex-compiler/lua-warmup.tex),
un ejemplo de confianza que comprueba fontspec + Babel bidi=basic. Esto prepara el índice y
las fuentes comunes en `/opt/latex-font-cache`. Cada solicitud Lua copia esa semilla a
`/work/.tex-cache`, configurada en `TEXMFCACHE`: puede escribir sus búsquedas sin alterar la
imagen de solo lectura ni compartir datos con otra solicitud. La copia utiliza el mismo tmpfs
y presupuesto de ejecución existentes; no se agrega un volumen del host ni se amplían límites.

## Errores de Babel: idioma ya importado

`Command \spanishdate already defined` indica una redefinición de español; no se corrige
cambiando otra vez el motor. En la versión de Babel de esta imagen, importar mediante
`provide=*` y después `\babelprovide[import,...]{spanish}` puede intentar definir de nuevo
las fechas del idioma. Para esa configuración, conservar una sola importación:

```tex
\usepackage[spanish,bidi=basic,provide=*]{babel}
\babelprovide[onchar=ids fonts]{spanish}
```

La segunda línea modifica `onchar` sin repetir `import`. Alternativamente, si el idioma no
se carga mediante opciones ni llamadas anteriores, importarlo explícitamente una sola vez:

```tex
\usepackage[bidi=basic]{babel}
\babelprovide[import,main,onchar=ids fonts]{spanish}
```

Elegir un esquema para cada idioma, conservando las configuraciones de otras lenguas.
El wrapper añade una orientación al registro cuando reconoce `\spanishdate`, pero mantiene
el error original y no reescribe la fuente ni desactiva la comprobación de redefiniciones.
El ejemplo de precalentamiento y la prueba Docker incluyen el primer esquema.

## Contrato

`POST /api/latex/compile`, protegido por `JwtAuthGuard`:

```json
{ "source": "\\documentclass{article}\n...", "mode": "document" }
```

- `source`: cadena no vacía, hasta 300 000 caracteres; parser HTTP de 2 MiB.
- `mode`: `document` o `fragment`, opcional (por defecto `document`).
- Éxito: `{success:true, pdf:"base64...", log:"..."}`.
- Error de TeX: `{success:false, log:"..."}`. El frontend mantiene el código y muestra el registro.
- 400: entrada inválida; 401: sin sesión; 408: límite de tiempo; 429: capacidad ocupada;
  503: Docker, imagen o protocolo del compilador no disponibles.

Se aceptan fuentes en la solicitud, sin leer documentos ajenos ni archivos de uploads.
La compilación no guarda ni modifica la nota. El código puro se persiste mediante la API
habitual de notas, con verificación de propietario, en Mongo:
`docType: 'latex', docData: {version:1, source:string}`. La hidratación y el borrado omiten
el almacenamiento físico de documentos especializados para este tipo.

El modo fragmento agrega un preámbulo (incluyendo `\usepackage[siunitx]{circuitikz}` salvo que el fragmento ya lo cargue) y el entorno document si no hay documentclass, elevando las directivas iniciales de preámbulo antes de `\begin{document}` cuando existen.
Ambos modos incorporan `\providecommand{\hr}{...}` mediante `\AtBeginDocument` y cargan automáticamente `\usetikzlibrary{babel}` antes de `\begin{document}` cuando conviven `tikz`/`circuitikz` y `babel` (evitando conflictos con los caracteres activos `<` y `>` de la notación `<valor\unidad>` de `siunitx`). En documentos completos se agrega en la misma primera línea para
preservar la numeración del registro. En fragmentos estándar los números incluyen seis líneas de
preámbulo. No se cambia la fuente guardada o descargada como `.tex`.

## Ejecución y aislamiento

[LatexService](../src/modules/latex/latex.service.ts) limita una compilación por usuario y
dos globales por proceso Nest; no mantiene una cola ilimitada. Siempre libera capacidad,
también en errores. En despliegues con réplicas, estos límites se aplican por instancia:
una cola distribuida sería necesaria para un límite global del clúster.

Cada solicitud ejecuta un contenedor desechable, con fuente por stdin (nunca argumentos
de shell). El contenedor tiene usuario no privilegiado, red deshabilitada, raíz de solo
lectura, capabilities eliminadas y `no-new-privileges`. Solo `/work` y `/tmp` son tmpfs,
sin montajes del host, credenciales ni socket Docker. Límites: 512 MiB de memoria, una CPU,
32 procesos, 64 MiB de trabajo, 16 MiB temporal y 32 MiB por archivo.

[compile.py](../latex-compiler/compile.py) ejecuta dos pasadas del motor seleccionado, cada una con
timeout de hasta diez segundos y un presupuesto compartido de veinte segundos (incluido el
reintentos automáticos y copia de caché de LuaLaTeX), `-no-shell-escape`, `-halt-on-error` y `-file-line-error`. pdfLaTeX y XeLaTeX
reciben `-no-parse-first-line`; LuaLaTeX no admite ese interruptor y usa el formato explícito
`-fmt=lualatex`. `openin_any=p` y `openout_any=p` restringen acceso TeX a archivos.
El tiempo total del cliente Docker se limita a 25 segundos; si excede el límite se mata
el cliente y se elimina por nombre el contenedor. La salida JSON está acotada a 24 MiB,
el PDF a 16 MiB y el registro a los últimos 16 000 bytes. No se registran fuentes en Nest.

No ejecutar TeX directamente en el host como alternativa cuando Docker falla. El código TeX
del usuario es un programa; la frontera de aislamiento es el contenedor y sus límites.
No hay instalación dinámica de paquetes, fuentes externas, BibTeX/Biber ni archivos adjuntos.
La imagen no proporciona una sandbox por proyecto persistente: cada compilación comienza vacía.

## Pruebas

```sh
python3 -B -m unittest discover -s latex-compiler -p 'test_*.py' -v
npm test -- --runInBand
npm run build
# Después de construir la imagen y comprobar acceso a Docker:
LATEX_INTEGRATION=1 npm test -- --runInBand --testPathPatterns=latex
```

Las pruebas normales verifican validación, concurrencia, preparación de fuentes,
argumentos de aislamiento, timeout/limpieza y persistencia. Las pruebas Python simulan los procesos para verificar selección de motor, reintento, límites,
argumentos y registros, sin ejecutar TeX en el host. Las pruebas optativas utilizan
el contenedor real tanto con español, electrostática, multicols y booktabs (pdfLaTeX), como
con fontspec y fuentes OpenType (XeLaTeX), y con fontspec + Babel bidi=basic (LuaLaTeX), y exigen un PDF válido. Se omite cuando no se declara `LATEX_INTEGRATION=1`.

## Referencias del motor

- [Guía oficial de TeX Live](https://www.tug.org/texlive/doc/texlive-en/texlive-en.html).
- [Seguridad y configuración de ejecución de TeX](https://tug.org/texinfohtml/web2c.html).
- [Babel: elección de motor para bidi](https://latex3.github.io/babel/guides/which-method-for-which-language.html).
- [Cachés de luaotfload](https://github.com/latex3/luaotfload/blob/main/doc/luaotfload.conf.rst).
- [fontspec: motores y fuentes](https://latex3.github.io/fontspec/).
- [Paquete multicol](https://ctan.org/pkg/multicol) y [booktabs](https://ctan.org/pkg/booktabs).
- [Editor Angular](../../frontend/guia-desarrollador/13-LATEX-AVANZADO.md).
